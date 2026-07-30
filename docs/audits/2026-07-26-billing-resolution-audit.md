# Billing Owner-Resolution Forensic Audit

- **Date:** 2026-07-26
- **Type:** Read-only forensic audit. No source file was modified, no SQL
  executed, no commits made. This report is the only file created.
- **Question:** When a manager inside an org-owned lab clicks the Upgrade CTA,
  does the server resolve the existing org billing account, or does it create a
  second lab-scoped account and a second Stripe subscription?
- **Verdict:** **FINANCIAL.** Duplicate billing. Details in the Verdict section.

## Method and scope

Files read in full: `app/api/stripe/checkout/route.ts`,
`app/api/stripe/portal/route.ts`, `app/api/stripe/webhook/route.ts`,
`lib/create-checkout.ts`, `lib/billing-portal.ts`, `lib/mfa-api-auth.ts`, plus
the relevant regions of `database-scripts/schema-2026-07-19.sql`,
`lib/inventory-utils.ts` (`resolveCurrentUserLabId`),
`docs/custom-access-token-hook.sql`, `app/dashboard/page.tsx`,
`components/dashboard/billing-panel.tsx`, `components/dashboard/sidebar.tsx`,
`app/org-admin/page.tsx`, and `app/super-admin/page.tsx`.

Every claim below is anchored to quoted code. Where a claim is an inference
about runtime behaviour, it is labelled as such.

## Part 1 — Checkout owner resolution

### 1.1 Auth and role gate

Identity is established by **bearer token**, not by a cookie session. The token
is verified server-side against Supabase Auth via the service-role admin client.

`app/api/stripe/checkout/route.ts:49-55`

```ts
    const auth = await authenticateBearerRequest(
      request.headers.get("Authorization"),
    )
    if (!auth.ok) return auth.response

    const { user } = auth
    const admin = createAdminClient()
```

`lib/mfa-api-auth.ts:37-49`

```ts
  const accessToken = authHeader.replace("Bearer ", "")
  const admin = createAdminClient()
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken)

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    }
  }
```

The **role is read from a `profiles` query, not from the JWT** — a deliberate
and correct choice, since it cannot go stale the way a JWT claim can.

`app/api/stripe/checkout/route.ts:58-79`

```ts
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, lab_id, org_id, is_active")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      console.error(
        "[stripe/checkout] Profile load failed:",
        profileError?.message ?? "missing profile",
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (profile.is_active === false) {
      return failureResponse("actor_inactive", 403, "Forbidden.")
    }

    const role = profile.role as string
    if (role !== "manager" && role !== "org_admin") {
      return failureResponse("forbidden", 403, "Forbidden.")
    }
```

Permitted roles: `manager` and `org_admin` only. Technicians and super_admin get
403 `forbidden`. Deactivated callers get 403 `actor_inactive`. This gate is
sound.

### 1.2 Owner resolution, line by line

The route decides org-vs-standalone **purely from the caller's role**. Nothing
else is consulted.

`app/api/stripe/checkout/route.ts:81-94`

```ts
    let ownerFilter: { lab_id: string } | { org_id: string }
    if (role === "manager") {
      if (!profile.lab_id) {
        console.error("[stripe/checkout] Manager missing lab_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { lab_id: profile.lab_id as string }
    } else {
      if (!profile.org_id) {
        console.error("[stripe/checkout] Org admin missing org_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { org_id: profile.org_id as string }
    }
```

Answering the three explicit questions:

- **Does it read `labs.org_id` at any point?** There is exactly one query
  against `labs` in the entire route, and it is a *count* on the org path, keyed
  on `profile.org_id` — it is never used to discover whether the caller's own
  lab belongs to an org:

  `app/api/stripe/checkout/route.ts:153-160`

  ```ts
    if (role === "org_admin" && "org_id" in ownerFilter) {
      const orgId = ownerFilter.org_id
      const { count, error: countError } = await admin
        .from("labs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_archived", false)
  ```

  So: the route **never reads `labs.org_id` for the caller's lab**. Org
  membership of a lab is structurally unobservable on the manager path.

- **If `org_id` is non-null, does it branch to an org-scoped path?** No. There
  is no such branch, because the value is never fetched. Note also that
  `profile.org_id` is selected at line 60 but is used *only* in the `org_admin`
  branch; for a manager it is ignored entirely — and per the project's own
  records, org-lab members frequently carry `profiles.org_id = NULL` anyway, so
  even consulting it would not be a fix.

- **Or does it key everything on `profiles.lab_id`?** Yes. For `role ===
  "manager"`, the owner is `{ lab_id: profile.lab_id }` unconditionally.

### 1.3 The get-or-create lookup

`app/api/stripe/checkout/route.ts:96-107`

```ts
    let billingAccount: BillingAccountRow | null = null

    const { data: existing, error: selectError } = await admin
      .from("billing_accounts")
      .select("id, lab_id, org_id, billing_status")
      .match(ownerFilter)
      .maybeSingle()

    if (selectError) {
      console.error("[stripe/checkout] billing_accounts select failed:", selectError.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
```

For a manager, `.match(ownerFilter)` is exactly `.eq("lab_id",
profile.lab_id)`. It filters on `lab_id` alone.

**Answer: it MISSES the row.** An org-keyed `billing_accounts` row has `lab_id
IS NULL` and `org_id` set — guaranteed by the table's own XOR constraint (quoted
in 2.1). A SQL equality predicate `lab_id = '<uuid>'` is never true for a NULL
column value; it evaluates to NULL, and the row is not returned. This is not a
race, a caching artefact, or a policy issue — it is structural. The lookup can
never find an org-keyed row from the manager path, regardless of the row's
`billing_status`.

Unlike the client surfaces, `selectError` *is* checked here, so this is a clean
"no row found", not a swallowed error.

### 1.4 The create branch

`app/api/stripe/checkout/route.ts:111-142`

```ts
    } else {
      const insertRow =
        "lab_id" in ownerFilter
          ? { lab_id: ownerFilter.lab_id, billing_status: "trialing" }
          : { org_id: ownerFilter.org_id, billing_status: "trialing" }

      const { data: created, error: insertError } = await admin
        .from("billing_accounts")
        .insert(insertRow)
        .select("id, lab_id, org_id, billing_status")
        .single()

      if (insertError || !created) {
        // Concurrent create: unique owner constraint — re-select.
        const { data: raced, error: raceError } = await admin
          .from("billing_accounts")
          .select("id, lab_id, org_id, billing_status")
          .match(ownerFilter)
          .maybeSingle()

        if (raceError || !raced) {
          console.error(
            "[stripe/checkout] billing_accounts insert failed:",
            insertError?.message ?? raceError?.message,
          )
          return NextResponse.json({ error: "Internal server error" }, { status: 500 })
        }
        billingAccount = raced as BillingAccountRow
      } else {
        billingAccount = created as BillingAccountRow
      }
    }
```

**Yes — it inserts a new row with `lab_id` set** and `billing_status =
'trialing'`, for a lab already covered by the org's active account.

On the Stripe customer question, the precise answer is: the route does **not**
call `stripe.customers.create` explicitly. It passes `customer_email` instead,
which causes Stripe to create a brand-new Customer object when the Checkout
Session completes:

`app/api/stripe/checkout/route.ts:209-220`

```ts
    const stripe = new Stripe(secretKey)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity }],
      client_reference_id: billingAccount.id,
      subscription_data: {
        metadata: { billing_account_id: billingAccount.id },
      },
      customer_email: email,
      success_url: successUrl,
      cancel_url: cancelUrl,
    })
```

There is no `customer:` parameter anywhere in the call, so an existing
`stripe_customer_id` is never reused even when one is known. The financial
outcome is identical to an explicit `customers.create`: a second Stripe Customer
and a second Subscription covering a lab the org already pays for. The webhook
then writes that new customer id onto the new row
(`app/api/stripe/webhook/route.ts:184-192`, quoted in 2.2).

### 1.5 Pre-flight guards

There is exactly one guard, and it inspects only the row resolved in 1.3/1.4:

`app/api/stripe/checkout/route.ts:144-150`

```ts
    if (billingAccount.billing_status === "active") {
      return failureResponse(
        "already_subscribed",
        409,
        "This account already has an active subscription.",
      )
    }
```

**This guard cannot fire in the org-lab manager scenario.** The row it examines
is the one just inserted at line 117-121 with a hardcoded `billing_status:
"trialing"`. The org's `active` row was never loaded, so its status is never
seen.

Stated plainly, as requested: **there is no check anywhere in this route for
whether an active subscription already covers this caller's lab or org through a
different `billing_accounts` row.** No query joins `labs` to `billing_accounts`;
no query examines coverage; no query looks for a second row. The only guard is
per-row and the row is fresh.

Also worth recording: the guard blocks *only* `active`. A caller whose resolved
account is `past_due` or `suspended` is permitted to run checkout again — see
finding F-3.

### 1.6 Quantity

`app/api/stripe/checkout/route.ts:152-174`

```ts
    let quantity = 1
    if (role === "org_admin" && "org_id" in ownerFilter) {
      const orgId = ownerFilter.org_id
      const { count, error: countError } = await admin
        .from("labs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_archived", false)

      if (countError) {
        console.error("[stripe/checkout] lab count failed:", countError.message)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }

      quantity = count ?? 0
      if (quantity === 0) {
        return failureResponse(
          "no_active_labs",
          409,
          "No active labs to subscribe.",
        )
      }
    }
```

Confirmed on both counts:

- The org path counts non-archived labs (`.eq("org_id", orgId)` plus
  `.eq("is_archived", false)`) and refuses with 409 `no_active_labs` at zero.
- The standalone path does not literally "hardcode 1" — it *initialises*
  `quantity = 1` at line 152 and the org branch is the only thing that can
  change it. The branch is gated on `role === "org_admin"`, so **the manager
  path always sends quantity 1**, including a manager whose lab sits inside an
  org. The org's own quantity-2 subscription is unaffected and unaware.

## Part 2 — Would anything catch it

### 2.1 Database — DOES NOT CATCH

`database-scripts/schema-2026-07-19.sql:547-559`

```sql
CREATE TABLE IF NOT EXISTS "public"."billing_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "lab_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "billing_status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_accounts_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['trialing'::"text", 'active'::"text", 'past_due'::"text", 'suspended'::"text"]))),
    CONSTRAINT "billing_owner_exactly_one" CHECK ((("org_id" IS NULL) <> ("lab_id" IS NULL)))
);
```

`database-scripts/schema-2026-07-19.sql:968-972`

```sql
CREATE UNIQUE INDEX "billing_accounts_lab_unique" ON "public"."billing_accounts" USING "btree" ("lab_id") WHERE ("lab_id" IS NOT NULL);

CREATE UNIQUE INDEX "billing_accounts_org_unique" ON "public"."billing_accounts" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);
```

**Answer: no. No constraint or index is violated.**

- `billing_owner_exactly_one` is satisfied: the new row has `lab_id` set and
  `org_id` NULL, so `(NULL IS NULL) <> (FALSE)` holds.
- `billing_accounts_lab_unique` is satisfied: no prior row exists with that
  `lab_id` — that was the whole premise of the miss in 1.3.
- `billing_accounts_org_unique` is untouched: the new row's `org_id` is NULL and
  the index is partial (`WHERE org_id IS NOT NULL`), so the org's existing row
  is not a conflict partner.
- The unique constraints on `stripe_customer_id` and
  `stripe_subscription_id` (lines 863-869) are satisfied because Stripe minted
  brand-new ids.

The structural reason is worth stating: `billing_accounts` has no relationship
to `labs.org_id`. `billing_accounts_lab_id_fkey` and
`billing_accounts_org_id_fkey` (lines 1044-1050) are independent `ON DELETE
RESTRICT` references. Nothing in the schema expresses "a lab may not have its
own account if its org has one." The invariant exists only in the application's
intent, and the application does not enforce it either.

### 2.2 Webhook duplicate-subscription guard — DOES NOT CATCH

`app/api/stripe/webhook/route.ts:150-199`

```ts
  if (event.type === "checkout.session.completed") {
    const session = object as Stripe.Checkout.Session
    const incomingSub = asId(session.subscription)
    const customerId = asId(session.customer)

    const { data: row, error: readError } = await admin
      .from("billing_accounts")
      .select("id, stripe_subscription_id")
      .eq("id", accountId)
      .maybeSingle()

    if (readError || !row) {
      console.error(
        `[stripe/webhook] UNMATCHED ${event.id} (checkout row missing)`,
      )
      return
    }

    const existingSub =
      typeof row.stripe_subscription_id === "string"
        ? row.stripe_subscription_id
        : null

    if (
      existingSub &&
      incomingSub &&
      existingSub !== incomingSub
    ) {
      console.error(
        `[stripe/webhook] DUPLICATE SUBSCRIPTION account=${accountId} existing=${existingSub} incoming=${incomingSub}`,
      )
      return
    }

    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: incomingSub,
        billing_status: "active",
        updated_at: now,
      })
      .eq("id", accountId)
```

Scope determination, precisely: the guard **compares within a single
`billing_accounts` row**. The row is selected by `.eq("id", accountId)`, where
`accountId` came from `session.client_reference_id`:

`app/api/stripe/webhook/route.ts:87-92`

```ts
  if (event.type === "checkout.session.completed") {
    const session = object as unknown as Stripe.Checkout.Session
    return typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : null
```

and `client_reference_id` was set by checkout to `billingAccount.id` — the id of
the row it just created. There is no query anywhere in the webhook file that
looks across rows for overlapping coverage; the only cross-row query is a lookup
by `stripe_subscription_id` for invoice events (lines 108-112), which is an
identity lookup, not a coverage check.

**If checkout created a second row, would the guard fire?** No. It would see a
fresh row whose `stripe_subscription_id` is NULL, so `existingSub` is `null`, so
the condition `existingSub && incomingSub && existingSub !== incomingSub`
short-circuits to false at the first operand — and the update at line 184
proceeds, writing the second customer id, the second subscription id, and
`billing_status: "active"`. The guard writes happily, exactly as the task
hypothesised. It is a guard against *overwriting* a known subscription on a
known row, not a guard against *duplicate coverage*.

Two further layers deserve the same verdict, because they are the only places a
human would plausibly notice:

**Super-admin Billing Overview — DOES NOT CATCH.** The overview builds lab rows
only for labs with no org:

`app/super-admin/page.tsx:447-464`

```ts
    for (const lab of labs.filter((l) => l.org_id === null)) {
      const account = billingAccounts.find((a) => a.lab_id === lab.id)
      const status = deriveStatus(account, lab.trial_ends_at)
      const dateIso =
        status === "active"
          ? account?.current_period_end ?? null
          : lab.trial_ends_at
      const labCount = lab.is_archived ? 0 : 1
      rows.push({
        key: `lab:${lab.id}`,
        name: lab.name,
        type: "Lab",
        labCount,
        status,
        dateIso,
        monthlyUsd: status === "active" ? labCount * 200 : null,
      })
    }
```

A lab-keyed account belonging to an *org* lab matches neither loop: the org loop
keys on `a.org_id === org.id` (line 430) and this row's `org_id` is NULL; the
lab loop excludes the lab itself via `l.org_id === null`. The duplicate row is
fetched (the query at line 195-197 is unfiltered) and then silently dropped
during row assembly. Its dollars are likewise absent from `monthlyUsd`, which is
derived from lab counts rather than from Stripe. The sole internal oversight
surface is blind to precisely this class of error.

**The manager's own UI — DOES NOT CATCH; it actively conceals.** Once the
duplicate row exists with `lab_id` set, the RLS manager branch *does* match it:

`database-scripts/schema-2026-07-19.sql:1297`

```sql
CREATE POLICY "billing_accounts_select_scoped" ON "public"."billing_accounts" FOR SELECT TO "authenticated" USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'manager'::"text") AND ("lab_id" = "public"."get_my_lab_id"())) OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'technician'::"text") AND ("lab_id" = "public"."get_my_lab_id"())) OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("org_id" = "public"."get_my_org_id"()))));
```

So after the duplicate purchase the manager's panel flips from Trial to "Active ·
$200/lab/month" and the sidebar to "Standard plan". The visible symptom that
would prompt a support ticket disappears at the moment the second subscription
starts billing. The defect erases its own evidence.

Note the same policy is itself part of the defect: the manager and technician
branches match on `lab_id` only, so a corrected *client* query still could not
read the org row. See F-6.

### 2.3 The write gate — DOES NOT CATCH, and becomes nondeterministic

`database-scripts/schema-2026-07-19.sql:179-195`

```sql
CREATE OR REPLACE FUNCTION "public"."lab_billing_allows_writes"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE
    WHEN (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin' THEN true
    ELSE coalesce((
      SELECT ba.billing_status <> 'suspended'
      FROM public.profiles p
      LEFT JOIN public.labs l ON l.id = p.lab_id
      LEFT JOIN public.billing_accounts ba
        ON ba.lab_id = p.lab_id OR ba.org_id = l.org_id
      WHERE p.id = auth.uid()
      LIMIT 1
    ), true)
  END;
$$;
```

Reading the actual body, the answer to "does it aggregate, take the first row,
or error on multiple rows" is: **it takes an arbitrary first row.**

- It does **not** aggregate. There is no `bool_and`, no `min`, no `every`.
- It does **not** error on multiple rows. `LIMIT 1` is what prevents the
  "more than one row returned by a subquery" error that a bare scalar subquery
  would raise. The `LIMIT 1` is doing real work here, and it is masking the
  ambiguity rather than resolving it.
- There is **no `ORDER BY`**. With two rows satisfying the disjunctive join
  condition (`ba.lab_id = p.lab_id` matches the duplicate; `ba.org_id =
  l.org_id` matches the org account), which row survives `LIMIT 1` is whatever
  the planner emits first. That is a function of join strategy, physical row
  order, and statistics — none of it stable across time, VACUUM, or plan
  changes.

Consequences, both directions:

- Org account goes `suspended` for non-payment while the duplicate lab row is
  still `active` → the gate may return `true` and permit writes. **Suspension
  evasion**, nondeterministically.
- Duplicate lab row goes `suspended` while the org keeps paying → the gate may
  return `false` and block writes for a fully paid-up org lab. **Spurious
  read-only**, nondeterministically.

Before the duplicate exists, the function is correct for org labs — the
`ba.org_id = l.org_id` branch resolves properly, as the task states. It is the
duplicate row created by checkout that turns a correct gate into a coin flip.
The gate therefore does not catch the duplicate; the duplicate corrupts the
gate.

## Part 3 — Portal, same question

### 3.1 Owner resolution in the portal route

Byte-for-byte the same role-keyed logic as checkout, with no consultation of
`labs.org_id`:

`app/api/stripe/portal/route.ts:82-95`

```ts
    let ownerFilter: { lab_id: string } | { org_id: string }
    if (role === "manager") {
      if (!profile.lab_id) {
        console.error("[stripe/portal] Manager missing lab_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { lab_id: profile.lab_id as string }
    } else {
      if (!profile.org_id) {
        console.error("[stripe/portal] Org admin missing org_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { org_id: profile.org_id as string }
    }
```

`app/api/stripe/portal/route.ts:97-116`

```ts
    // Do NOT create — portal requires an existing Stripe customer.
    const { data: existing, error: selectError } = await admin
      .from("billing_accounts")
      .select("id, lab_id, org_id, billing_status, stripe_customer_id")
      .match(ownerFilter)
      .maybeSingle()

    if (selectError) {
      console.error("[stripe/portal] billing_accounts select failed:", selectError.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const billingAccount = existing as BillingAccountRow | null
    if (!billingAccount?.stripe_customer_id) {
      return failureResponse(
        "no_subscription",
        409,
        "No subscription found for this account.",
      )
    }
```

There is no query against `labs` at all in this file. `org_id` is selected from
`billing_accounts` at line 100 but never used for resolution — only the
role-derived `ownerFilter` matters. Same structural miss as 1.3.

### 3.2 Manager inside an org lab, org account SUSPENDED

Literal walk of the path:

1. Bearer auth succeeds; profile loads; `is_active` is true; `role === "manager"`
   passes the role gate (lines 50-80).
2. `ownerFilter = { lab_id: profile.lab_id }` (line 88).
3. `.match({ lab_id })` returns **no row** — the org's suspended account has
   `lab_id IS NULL` (line 98-102). `selectError` is null; this is a clean miss,
   so the 500 branch is not taken.
4. `billingAccount` is `null`, so `!billingAccount?.stripe_customer_id` is true
   (line 110).
5. **Outcome: HTTP 409 with `error_code: "no_subscription"`.** No portal session
   is created.

The client renders that as, verbatim:

`lib/billing-portal.ts:55-56`

```ts
    case "no_subscription":
      return "No subscription found. Upgrade first to manage billing."
```

So the literal outcome is a 409 and the message *"No subscription found. Upgrade
first to manage billing."* — told to a manager whose organisation is a paying
customer in arrears.

In practice they will rarely even see that message, because the panel does not
offer them the portal button in the first place. Their client read also misses
the org row, so `billingStatus` defaults to `"trialing"`:

`components/dashboard/billing-panel.tsx:235-240`

```ts
  const showCheckout = !activating && billingStatus === "trialing"
  const showPortal =
    !activating &&
    (billingStatus === "active" ||
      billingStatus === "past_due" ||
      billingStatus === "suspended")
```

With `billingStatus === "trialing"`, `showPortal` is false and `showCheckout` is
true. The only control on screen is Upgrade — the button that creates the
duplicate subscription.

### 3.3 Against Architecture Decision #5

Decision #5 states suspension is read-only and never lockout, and that the
manager's billing page must always stay reachable so a lapsed customer can pay.

**That guarantee does not currently hold for org customers.** For a manager
inside an org lab whose org account is suspended:

- The Stripe Billing Portal is unreachable — 409 `no_subscription` (3.2).
- The "Reactivate subscription" CTA is never rendered, because the status the
  client computes is `trialing`, not `suspended`
  (`components/dashboard/billing-panel.tsx:242-247`).
- The lab-wide suspension banner driven by the 30s poll is also not shown, for
  the same reason — the poll's read misses the org row
  (`app/dashboard/page.tsx:319-339`, quoted in F-9).
- The one action offered is Upgrade, which does not settle the outstanding
  balance on the org's subscription. It opens a *second* subscription while the
  first stays in arrears.

Meanwhile the writes *are* blocked, because `lab_billing_allows_writes()`
resolves the org account correctly through `ba.org_id = l.org_id`. So the
enforcement half of Decision #5 works and the remedy half does not: an org lab
becomes read-only with no correct route to paying, which is the precise failure
mode Decision #5 was written to prevent.

The guarantee does hold for the **org_admin**, who resolves through `{ org_id }`
and reaches the portal normally. The gap is specific to lab managers inside
orgs.

## Part 4 — org_admin vs manager

The two roles take **different paths, and only the manager path is defective.**

Both routes branch on role *before* touching `lab_id`, and each branch guards
its own required field:

- **Checkout, org_admin:** `ownerFilter = { org_id: profile.org_id }` (line 93),
  guarded by `if (!profile.org_id)` → 500 (line 89). A null `lab_id` is never
  read on this path, so it cannot throw or misresolve. Quantity is computed from
  the org's non-archived lab count (lines 153-174). This path is correct.
- **Checkout, manager:** `ownerFilter = { lab_id: profile.lab_id }` (line 87),
  guarded by `if (!profile.lab_id)` → 500 (line 83). Correct for a standalone
  lab, structurally wrong for an org lab (Part 1).
- **Portal:** identical split, identical guards (lines 82-95). org_admin
  correct; manager wrong for org labs.

No path assumes a non-null `lab_id` for an org_admin — both routes guard it, and
the org_admin branch never dereferences it. So there is no crash or
cross-tenant misresolution from the null-`lab_id` shape. The client mirrors this
correctly too: `/org-admin` passes an explicit `orgId`
(`app/org-admin/page.tsx:788`, `<BillingPanel mode="org_admin" orgId={orgId} />`)
and the panel's org branch filters on `.eq("org_id", orgId)`
(`components/dashboard/billing-panel.tsx:145-161`).

Two notes on the guards themselves:

- Returning **500** for a profile that is merely missing `lab_id`/`org_id`
  misclassifies a data-shape problem as a server fault, and emits no
  `error_code`, so the user sees the generic "Could not start checkout." See
  F-12.
- The manager guard's real weakness is not the null case but the non-null case:
  a present `lab_id` is accepted as proof of standalone ownership, which it is
  not.

One asymmetry worth recording for the fix: `profiles.org_id` cannot be used to
repair the manager path. Per the project's own deactivation-RPC findings,
org-lab technicians and managers commonly have `profiles.org_id = NULL`, and the
JWT simply copies that column:

`docs/custom-access-token-hook.sql:26-30`

```sql
  IF user_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_org_id));
  ELSE
    claims := jsonb_set(claims, '{org_id}', 'null');
  END IF;
```

So `get_my_org_id()` is also NULL for those users. The only reliable source of a
lab's org is `labs.org_id`, which is exactly what the write gate uses and what
both routes and all three client surfaces omit.

## Part 5 — Scenario trace

**Setup.** Test Org (`org_id = 5b15d0ec-…`) has an active org-keyed
`billing_accounts` row: `stripe_customer_id = cus_UunuORzTfzNIJr`, one
subscription, quantity 2, `$400/month`. A manager belongs to Lab A, one of the
org's two labs: `profiles.role = 'manager'`, `profiles.lab_id = <A>`,
`labs.org_id = 5b15d0ec-…`.

**Step 1 — dashboard shows Trial.** The panel's manager branch reads by
`lab_id`, misses the org row, and defaults:

`components/dashboard/billing-panel.tsx:111-128`

```ts
        const [{ data: account }, { data: lab }] = await Promise.all([
          supabase
            .from("billing_accounts")
            .select("billing_status, current_period_end")
            .eq("lab_id", labId)
            .maybeSingle(),
          supabase
            .from("labs")
            .select("trial_ends_at")
            .eq("id", labId)
            .maybeSingle(),
        ])

        setBillingStatus(
          typeof account?.billing_status === "string"
            ? account.billing_status
            : "trialing",
        )
```

`labId` here is `profiles.lab_id`, never the lab's org:

`lib/inventory-utils.ts:1086-1088`

```ts
  // super_admin has no tenant context and must not be scoped to a lab
  if (profile?.role === "super_admin") return null
  return profile?.lab_id ?? null
```

`billingStatus = "trialing"` → `showCheckout` true, `showPortal` false
(`billing-panel.tsx:235-240`). Upgrade is rendered.

**Step 2 — manager clicks Upgrade.** `handleCheckout` →
`createCheckoutSession()` → `POST /api/stripe/checkout` with the manager's
bearer token (`lib/create-checkout.ts:18-24`).

**Step 3 — server resolves the wrong owner.** Role is `manager`, so
`ownerFilter = { lab_id: <A> }` (`checkout/route.ts:87`). Test Org's active row
is never considered.

**Step 4 — lookup misses.** `.eq("lab_id", <A>)` against a table whose only
relevant row has `lab_id IS NULL` returns nothing
(`checkout/route.ts:98-102`).

**Step 5 — second account created.** Insert of `{ lab_id: <A>, billing_status:
"trialing" }` succeeds; no constraint objects (2.1). New row id `<B>`
(`checkout/route.ts:112-121`).

**Step 6 — the guard does not fire.** `billingAccount.billing_status` is
`"trialing"`, not `"active"` (`checkout/route.ts:144`). No coverage check exists
(1.5).

**Step 7 — quantity 1.** The org branch requires `role === "org_admin"`, so
`quantity` stays at its initial `1` (`checkout/route.ts:152-153`).

**Step 8 — Checkout Session.** `line_items: [{ price: priceId, quantity: 1 }]`,
`client_reference_id: <B>`, `subscription_data.metadata.billing_account_id =
<B>`, `customer_email` = the manager's email and no `customer:` parameter, so
Stripe mints a new Customer (`checkout/route.ts:210-220`). Manager pays with the
test card.

**Step 9 — webhook activates the duplicate.** `checkout.session.completed`
resolves `accountId = <B>` from `client_reference_id`
(`webhook/route.ts:87-92`); the row at `<B>` has a NULL
`stripe_subscription_id`, so the duplicate guard short-circuits false
(`webhook/route.ts:173-182`); the update writes the new customer id, the new
subscription id, and `billing_status: "active"` (`webhook/route.ts:184-192`).
`invoice.paid` then stamps `current_period_end`
(`webhook/route.ts:203-220`).

### End state

**In `billing_accounts` — two rows covering overlapping scope:**

- Row 1: `org_id = 5b15d0ec-…`, `lab_id` NULL, `cus_UunuORzTfzNIJr`, one
  subscription at quantity 2, `active`.
- Row 2 (`<B>`): `lab_id = <A>`, `org_id` NULL, a **new** `cus_…`, a **new**
  subscription at quantity 1, `active`.

Both rows satisfy `billing_owner_exactly_one` and both partial unique indexes.

**In Stripe — two customers and two subscriptions:**

- `cus_UunuORzTfzNIJr` → subscription, quantity 2 → **$400/month**.
- new `cus_…` → subscription, quantity 1 → **$200/month**.

**What the org is charged: $600/month for 2 labs, against a correct price of
$400/month. Monthly impact: +$200.** If the second lab's manager repeats it
(nothing prevents this — a different lab id, so no unique conflict), the total
becomes **$800/month for 2 labs, +$400/month over correct**, i.e. exactly double
the contracted price. The overcharge recurs every billing period until someone
cancels in the Stripe dashboard.

**What the app reports internally: $400/month.** The super-admin Billing
Overview drops row 2 entirely, because Lab A has a non-null `org_id` and is
excluded from the standalone-lab loop (`app/super-admin/page.tsx:447`). The
extra $200 appears in no Buddy-side surface.

**What the write gate does:** two rows now satisfy the disjunctive join in
`lab_billing_allows_writes()`, and `LIMIT 1` without `ORDER BY` picks one
arbitrarily (2.3). While both are `active` the returned boolean is `true` either
way, so nothing is visibly wrong — until one of them is suspended, at which
point write access becomes nondeterministic.

**What the manager sees:** their panel now reads row 2 successfully (the RLS
manager branch matches `lab_id = <A>`) and displays "Active ·
$200/lab/month"; the sidebar reads "Standard plan". The wrong-UI symptom
resolves itself. Nothing on any Buddy screen indicates that the org is now
paying twice for Lab A. Detection requires opening the Stripe dashboard and
noticing two subscriptions, or a customer reading their card statement.

## Part 6 — Other defects found

Ranked by severity. Each is independent of the primary finding unless noted.

### High

**F-1 — Webhook receipts the event before applying state, then swallows every
write failure and returns 200. A lost update is permanent.**

The idempotency receipt is written *first*:

`app/api/stripe/webhook/route.ts:321-340`

```ts
    const { data, error } = await admin
      .from("processed_stripe_events")
      .upsert(
        {
          event_id: event.id,
          event_type: event.type,
          payload: event,
        },
        { onConflict: "event_id", ignoreDuplicates: true },
      )
      .select()

    if (error) {
      console.error("[stripe/webhook] processed_stripe_events upsert failed:", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ received: true, duplicate: true })
    }
```

Then `applyBillingEvent` runs, and every one of its five branches logs failures
and returns void — for example:

`app/api/stripe/webhook/route.ts:203-220`

```ts
  if (event.type === "invoice.paid") {
    const invoice = object as Stripe.Invoice
    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        billing_status: "active",
        current_period_end: getInvoicePeriodEnd(invoice),
        updated_at: now,
      })
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] invoice.paid update failed:",
        updateError.message,
      )
    }
    return
  }
```

`applyBillingEvent` is awaited at line 357 but returns `Promise<void>` and its
caller returns `{ received: true }` unconditionally. So a transient Supabase
error on `invoice.paid` or `customer.subscription.deleted` yields HTTP 200,
Stripe never retries, and because the event id is already in
`processed_stripe_events` any manual replay short-circuits at line 338 as a
duplicate. The state change is lost permanently, with only a Vercel log line as
evidence. A missed `customer.subscription.deleted` means a cancelled customer is
never suspended; a missed `invoice.payment_failed` means a delinquent customer
never shows `past_due`. There is no `applied_at` column or equivalent to
distinguish "receipted" from "applied".

**F-2 — `lab_billing_allows_writes()` is nondeterministic whenever two accounts
match one user.** Full analysis in 2.3. Recorded here as a standalone defect
because the `LIMIT 1`-without-`ORDER BY` shape is wrong on its own terms: a
security-relevant boolean should never depend on planner choice. The correct
shape is an aggregate over all matching rows (fail closed if any covering
account is suspended), not an arbitrary single row.

**F-3 — Checkout permits a second subscription on an account that is `past_due`
or `suspended`.** The pre-flight guard blocks only `active`
(`checkout/route.ts:144`). The client never offers checkout in those states
(`billing-panel.tsx:235`), but the route is the security boundary and is
directly callable by any manager or org_admin with a bearer token, within the
10/hr limit. Traced outcome for a suspended standalone lab: a new subscription
is created; `checkout.session.completed` arrives with `incomingSub !==
existingSub`, so the duplicate guard *does* fire this time and returns early
(`webhook/route.ts:173-182`) — meaning the newly-paid subscription is never
recorded. The row keeps pointing at the dead subscription id. The subsequent
`invoice.paid` resolves via the metadata fallback
(`webhook/route.ts:124-125`) and flips `billing_status` to `active`, so the
customer regains access, but `stripe_subscription_id` remains stale forever.
Every future lookup by subscription id misses (`webhook/route.ts:108-112`), and
the app's record of what to cancel points at the wrong object. Net: a paid,
orphaned, unmanaged subscription.

**F-4 — Checkout never reuses a known `stripe_customer_id`.** There is no
`customer:` parameter in the session create; `customer_email` is passed instead
(`checkout/route.ts:210-220`), so Stripe mints a fresh Customer on every
successful checkout. Combined with F-3, a second checkout on an existing account
creates a second Customer, and the webhook then **overwrites** the row's
`stripe_customer_id` (`webhook/route.ts:184-192`), orphaning the previous
customer — which retains any active subscription and keeps billing, now
unreachable from the app since the portal route reads only the current column
value (`portal/route.ts:142`). Note also that `customer_email` is the individual
manager's address, not a tenant address, so Stripe-side customers are keyed to
whichever employee happened to click Upgrade.

### Medium

**F-5 — The super-admin Billing Overview cannot represent a lab-keyed account
for an org lab, and its revenue figures are derived rather than reconciled.**
`app/super-admin/page.tsx:447` excludes org labs from the lab loop, so such a
row is fetched and silently dropped. `monthlyUsd` is computed as `labCount *
200` from Buddy's own tables, never from Stripe, so the overview cannot detect
either over-billing or under-billing by construction. There is no
reconciliation surface anywhere in the app.

**F-6 — `billing_accounts_select_scoped` has the same lab-only defect at the RLS
layer, so no client-side fix can work alone.** The manager and technician
branches match on `lab_id = get_my_lab_id()` only
(`schema-2026-07-19.sql:1297`). An org lab's manager cannot read the org-keyed
row even with a corrected query. The `org_admin` branch is no help either, since
it is gated on `user_role = 'org_admin'`. And `get_my_org_id()` cannot substitute
for `labs.org_id`, because the hook copies `profiles.org_id`
(`docs/custom-access-token-hook.sql:17-30`) and org-lab members commonly have
that column NULL. Any real fix must widen this policy using a `labs` subquery.

**F-7 — Subscription lifecycle events resolve only via metadata; a subscription
without `billing_account_id` metadata can never suspend an account.**

`app/api/stripe/webhook/route.ts:94-101`

```ts
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = object as unknown as Stripe.Subscription
    const fromMeta = sub.metadata?.billing_account_id
    return typeof fromMeta === "string" && fromMeta.length > 0 ? fromMeta : null
```

Invoice events have a two-path resolution (subscription-id lookup, then
metadata), but subscription events have only the metadata path — even though
`stripe_subscription_id` is unique and indexed and would be the more reliable
key. Any subscription created or recreated from the Stripe Dashboard, or
migrated, lacks that metadata; its cancellation logs `UNMATCHED` and returns 200
(lines 353-356) and the account is never suspended. Given the documented
requirement that the retry schedule must end in *cancel* for suspension to work
at all, this is the single event the system most depends on.

**F-8 — The insert-failure path treats every error as a lost race.**
`checkout/route.ts:123-137` re-selects on *any* `insertError` without inspecting
`insertError.code`. A `billing_accounts_billing_status_check` violation, an FK
`RESTRICT` failure, or a permission error all produce the same "insert failed"
log line and the same 500, and a genuine misconfiguration is indistinguishable
from concurrency. The re-select itself is correct and the partial unique indexes
do make the race safe — the defect is diagnostic, not correctness.

**F-9 — All three client surfaces discard the query error object, so a failed
read is indistinguishable from "no subscription" and renders trial UI.** This is
the mechanism by which the primary defect is silent, and it is a defect in its
own right: a permission change, a column revoke, or a network failure would
produce the same false trial state on a paying lab.

`app/dashboard/page.tsx:319-339`

```ts
  const refreshLabBillingBanner = useCallback(async (labId: string) => {
    const [{ data: account }, { data: lab }] = await Promise.all([
      supabase
        .from("billing_accounts")
        .select("billing_status")
        .eq("lab_id", labId)
        .maybeSingle(),
      supabase
        .from("labs")
        .select("trial_ends_at")
        .eq("id", labId)
        .maybeSingle(),
    ])

    setLabBillingStatus(
      typeof account?.billing_status === "string" ? account.billing_status : "trialing",
    )
    setLabTrialEndsAt(
      typeof lab?.trial_ends_at === "string" ? lab.trial_ends_at : null,
    )
  }, [])
```

`components/dashboard/sidebar.tsx:62-80`

```ts
      const [{ data: account }, { data: lab }] = await Promise.all([
        supabase
          .from("billing_accounts")
          .select("billing_status, current_period_end")
          .eq("lab_id", labId)
          .maybeSingle(),
        supabase
          .from("labs")
          .select("trial_ends_at")
          .eq("id", labId)
          .maybeSingle(),
      ])

      if (cancelled) return

      const status =
        typeof account?.billing_status === "string"
          ? account.billing_status
          : "trialing"
```

In all three (including `billing-panel.tsx:111-128`, quoted in Part 5) the
`error` member is not even destructured. The fallback is the *permissive*
state — `trialing`, which shows an Upgrade CTA — rather than a neutral "unknown"
state. Note the project's own hard-won lesson from the column-revoke incident
("a UI branching on a revoked column reads undefined and silently takes the
wrong branch"); the same shape is still present here.

### Low

**F-10 — `billing_accounts` still grants table-level write privileges to
`authenticated`, despite the documented "service-role writes only".**

`database-scripts/schema-2026-07-19.sql:1779-1781`

```sql
GRANT ALL ON TABLE "public"."billing_accounts" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."billing_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_accounts" TO "service_role";
```

Client writes are blocked today only by the *absence* of permissive
INSERT/UPDATE/DELETE policies, not by the grant layer. The SELECT discipline was
applied carefully (table SELECT revoked, seven columns re-granted at lines
1785-1809) but the write grants were never revoked, so the invariant rests on a
single layer. Any future permissive `FOR ALL` policy — the exact mistake the
billing notes already warn about for restrictive policies — would silently open
client writes to billing state. The `GRANT ALL … TO anon` on line 1779 is
repo-wide baseline (every public table has it; RLS grants `anon` nothing), so it
is noted for completeness rather than as a billing-specific issue.

**F-11 — A dead, broken `SECURITY DEFINER` function is granted to `anon` and
`authenticated`.**

`database-scripts/schema-2026-07-19.sql:169-176`

```sql
CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT is_super_admin FROM public.profiles WHERE id = auth.uid();
$$;
```

`profiles` has no `is_super_admin` column (`schema-2026-07-19.sql:771-784`), so
the function raises `42703` if ever called. It has no `SET search_path` (unlike
`lab_billing_allows_writes`), and EXECUTE is granted to `anon`, `authenticated`,
and `service_role` (lines 1732-1734). No policy references it today, so this is
latent, not live — but it is a `SECURITY DEFINER` function with no search_path
guard sitting in the schema waiting to be wired in. It should be dropped.

**F-12 — Data-shape problems on the caller's profile return 500 with no
`error_code`.** `checkout/route.ts:83-93` and `portal/route.ts:84-94` return a
bare 500 when a manager has no `lab_id` or an org_admin no `org_id`. The client
maps the absent `error_code` to the generic default
(`lib/create-checkout.ts:34`, `lib/billing-portal.ts:60`), so the user is told
"Could not start checkout" for a provisioning error that support could otherwise
identify immediately from the response.

**F-13 — Unrecognised `Origin` headers are silently rewritten rather than
rejected.** Both routes fall back to the canonical domain
(`checkout/route.ts:189-198`, `portal/route.ts:124-133`). This is not
exploitable — the set is a fixed allowlist and the fallback is Buddy's own
domain, so no attacker-controlled redirect is possible — but a genuinely
misconfigured deploy origin fails silently by sending users to production URLs
instead of surfacing the misconfiguration.

### Checked and found sound

Recorded so a future pass does not re-litigate these:

- Rate limiting is present on both routes at 10/hr with correctly prefixed keys
  (`stripe-checkout:${ip}`, `stripe-portal:${ip}`) and runs before auth, using
  the `x-real-ip`-first pattern (`checkout/route.ts:28-46`).
- The webhook correctly reads the raw body before verification and treats
  signature verification as its sole auth (`webhook/route.ts:300-314`).
- Stripe is lazily constructed inside every handler, never at module scope.
- No client-supplied value influences owner resolution anywhere: there is no
  request-body parse in either route, and both derive everything from the
  verified token plus a server-side `profiles` read. The threading of both
  `client_reference_id` and `subscription_data.metadata` is genuinely
  load-bearing given out-of-order delivery, and the invoice metadata fallback
  works as documented.
- The get/create race is adequately handled: the partial unique indexes make a
  concurrent insert fail, and the re-select recovers the winner
  (`checkout/route.ts:123-138`). Only the error classification is weak (F-8).

## Verdict

**Financial, not cosmetic.** The divergence is not confined to the UI: the
checkout route commits the identical error at the server layer, and nothing
downstream catches it. A manager inside an org lab resolves the billing owner
from their role alone (`checkout/route.ts:81-94`), looks the account up by
`lab_id` alone (`98-102`), structurally misses the org-keyed row whose `lab_id`
is NULL by constraint (`schema:558`), inserts a second lab-keyed account
(`112-121`), and passes the only pre-flight guard because that guard reads the
row it just created with a hardcoded `trialing` status (`144-150`). No database
constraint objects (2.1); the webhook's duplicate guard compares only within the
single row named by `client_reference_id` and sees a null subscription id, so it
writes happily (2.2); the write gate does not detect the duplicate but is itself
corrupted by it into a planner-dependent coin flip (2.3); and the super-admin
Billing Overview cannot even display the offending row
(`super-admin/page.tsx:447`). The concrete result for Test Org is a second
Stripe customer and a second subscription at quantity 1 — **$600/month billed
for two labs against a correct $400/month, +$200/month per manager who clicks,
recurring**, invisible in every Buddy-side surface, and self-concealing because
the manager's panel flips to "Active" the moment the duplicate row exists.
Separately, Architecture Decision #5 does not currently hold for org customers:
a suspended org lab's manager is blocked from writes but gets 409
`no_subscription` from the portal and is offered Upgrade instead of Reactivate
(3.2, 3.3).

**Minimum set of files that must change**, with the resolution logic each needs.
Deployment order matters and runs database-first, because the RLS widening is
backward-compatible while the client change is not:

1. **`database-scripts/` (new script, plus a regenerated schema dump).** Two
   changes. (a) Widen `billing_accounts_select_scoped` so the manager and
   technician branches also match org-keyed rows via the lab's org — necessarily
   a subquery over `labs` (`org_id IN (SELECT org_id FROM labs WHERE id =
   get_my_lab_id())`), because `get_my_org_id()` is NULL for org-lab members.
   Without this, no client fix can read the correct row. (b) Make
   `lab_billing_allows_writes()` deterministic: aggregate over *all* matching
   accounts and fail closed if any covering account is suspended, replacing
   `LIMIT 1` with `bool_and(ba.billing_status <> 'suspended')`.
2. **A new shared server helper (e.g. `lib/resolve-billing-owner.ts`).** One
   function, used by both routes so they cannot diverge again: given the
   authenticated profile, return the owner filter. For `org_admin`, key on
   `profiles.org_id` as today. For `manager`, read `labs.org_id` for
   `profiles.lab_id` first — if non-null the owner is `{ org_id }`, and only if
   NULL may it be `{ lab_id }`.
3. **`app/api/stripe/checkout/route.ts`.** Use the helper for owner resolution.
   Derive quantity from the *resolved owner*, not from the caller's role, so an
   org-resolved purchase counts non-archived org labs. Add a real coverage
   pre-flight: refuse when any account covering this lab — lab-keyed or
   org-keyed — is already `active`. Pass `customer:` when a
   `stripe_customer_id` is already known, and tighten the guard to reject
   re-checkout for `past_due`/`suspended` in favour of the portal (F-3, F-4).
4. **`app/api/stripe/portal/route.ts`.** Use the same helper, so an org lab's
   manager reaches the org's Billing Portal and Decision #5 is restored.
5. **`app/dashboard/page.tsx`, `components/dashboard/billing-panel.tsx`,
   `components/dashboard/sidebar.tsx`.** Resolve via the lab's org when
   `labs.org_id` is non-null, and stop collapsing a query error into
   `"trialing"` — check `error` and render an explicit unknown state rather than
   a live Upgrade CTA (F-9). Effective only after change 1(a).

Also required before an org customer onboards, though outside the minimum
correctness set: F-1 (webhook receipt-before-apply losing state permanently) and
F-7 (subscription cancellations that never suspend). Both silently break billing
state in ways no surface reports.

No files were modified. Awaiting go-ahead before any fix.
