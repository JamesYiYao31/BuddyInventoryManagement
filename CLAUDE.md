# Buddy Inventory Management — Claude Context File

## Recent Sessions

### Session: July 26–31, 2026 (latest) — Billing Owner-Resolution + Webhook Durability (Phases A, B1, C, D)
- **Headline:** Closed a FINANCIAL defect (org-lab manager Upgrade → second
  `billing_accounts` row + second Stripe subscription) and hardened the
  webhook so transient write failures can no longer lose billing state
  permanently. Phases A (DB), B1 (server resolver), C (customer surfaces),
  and D (webhook durability / F-1 + F-7) deployed and live-verified.
  Quantity sync and super-admin overview remain open.
- **Context:** Forensic audit
  `docs/audits/2026-07-26-billing-resolution-audit.md` (read-only; do not
  restate). Root cause: client surfaces AND both Stripe routes resolved
  ownership by `lab_id` only. Org-owned `billing_accounts` rows carry
  `lab_id NULL` by CONSTRAINT `billing_owner_exactly_one`, so those lookups
  never matched.
- **Commits (code):** `6ff8059` (A+B1+C surfaces + Intl renewal fix),
  `765eee1` (D webhook durability + `formatRenewalDate` extract).

- **Settled business model (canonical):**
  1. Standalone lab pays for itself; its manager may purchase and manage.
  2. An org pays ONE subscription covering all its labs.
  3. Managers and technicians inside an org lab SEE the plan but may NEVER
     purchase or manage billing. Only `org_admin` may.

- **Phase A (deployed, verified):**
  - New `get_my_lab_org_id()` — STABLE SECURITY DEFINER, `search_path ''`,
    reads `labs.org_id` via the JWT `lab_id` claim (reads JWT directly;
    does not call `get_my_lab_id()`, which has no `search_path` of its own).
  - `billing_accounts_select_scoped` widened: manager/technician may read
    their lab's row OR their lab's org row.
  - `lab_billing_allows_writes()` now `bool_and` over ALL covering rows
    (was `LIMIT 1` with no `ORDER BY` — nondeterministic if duplicates
    existed). No rows still means allowed (brand-new labs must keep working).
  - `REVOKE ALL` from `anon`; `REVOKE INSERT/UPDATE/DELETE` from
    `authenticated` on `billing_accounts`. Both roles previously held
    table-wide write grants on every column including Stripe IDs —
    unreachable only because no write policy existed. Same defect class as
    the closed technician self-promote hole. `REFERENCES` grants remain
    (harmless; no `CREATE TABLE` privilege).

- **Phase B1 (deployed, verified):**
  - New `lib/resolve-billing-owner.ts` — single source of truth.
    Discriminated union: `{kind:"lab"}` | `{kind:"org"}` | `{kind:"denied"}`.
    Lowercase codes: `org_managed_billing`, `role_not_permitted`,
    `profile_incomplete`.
  - Fail-closed: every Supabase read error-checked; failed read and empty
    result both deny. An unreadable lab is never treated as standalone.
  - Wired into `app/api/stripe/checkout/route.ts` and `portal/route.ts`.
    Denials return 403, not 500 (audit F-12).
  - Optional `client` param for test injection; lazy import of the admin
    client so `node --test` never loads Next.js. Verified against a real
    Vercel build, not just `tsc`.
  - `lib/resolve-billing-owner.test.ts` — 12 cases (suite was 18/18 at B1
    close; now 30/30 with C/D helpers — see Current state).

- **Phase C (deployed, verified live):**
  - Three customer surfaces (`app/dashboard/page.tsx`,
    `components/dashboard/billing-panel.tsx`,
    `components/dashboard/sidebar.tsx`) no longer filter `billing_accounts`
    by `lab_id` for lab staff — they select and let RLS scope.
  - Dashboard banner + billing-panel use four explicit load states:
    `loading` / `resolved` / `none` / `unknown`. `unknown` (read error)
    renders "Plan status unavailable" and NEVER trial wording or purchase
    CTAs. Sidebar `LabLicenseCard` is fail-closed the same way on read
    error ("Plan status unavailable") but uses a display-string `line`,
    not the four-state enum.
  - Purchase controls hidden for org-lab staff; org membership read from
    `labs.org_id` (NOT `profiles.org_id` or JWT claim, which are routinely
    NULL for org-lab staff). Org-managed copy shown on the billing panel
    instead.
  - Denial codes mapped in `lib/create-checkout.ts` and
    `lib/billing-portal.ts`.
  - Renewal dates labeled with timezone. Root cause of the missing date
    was an Intl misuse: `dateStyle` + `timeZoneName` cannot be combined;
    the throw was caught into null and every renewal line silently
    vanished for ALL users, not only org labs. Fixed in `6ff8059`
    (inline). Later extracted to `lib/format-renewal-date.ts` with tests
    in `765eee1`; catch now `console.warn`s before returning null. Both
    panel and sidebar import the shared helper — no local copies remain.
  - Live verification: Lab1 manager (org lab) sees Active · $200/lab/month
    · Renews Aug 19/20 (TZ-labeled) · org-managed copy · NO purchase
    controls. Oakwood unchanged.

- **Phase D (deployed, verified live):**
  - `processed_stripe_events` gained nullable `applied_at` (timestamptz),
    backfilled from `received_at`. NOTE: the table's receipt timestamp
    column is `received_at`, not `created_at`.
  - Receipt-before-apply inverted (audit F-1): claim the event with
    `applied_at` NULL via select-then-insert (not upsert) → apply → stamp
    `applied_at`. Duplicate-skip only when `applied_at IS NOT NULL`; an
    unstamped row means a prior attempt died mid-flight and is re-applied.
    Failed apply → HTTP 500 → Stripe retries. Previously a transient write
    failure returned 200, Stripe never retried, and manual replay
    short-circuited as duplicate — the state change was lost permanently.
  - `applyBillingEvent` returns `{ ok: true } | { ok: false; reason }`
    (not void); the caller branches on it. Write failures leave
    `applied_at` NULL and return 500. Terminal non-failures (unhandled
    event type, unmatched account, missing checkout row, DUPLICATE
    SUBSCRIPTION) return 200 WITH `applied_at` stamped — retrying them
    would be wrong.
  - Subscription lifecycle events resolve by `stripe_subscription_id`
    first, metadata second (audit F-7). Pure decision in
    `lib/stripe-subscription-account-resolution.ts`
    (`decideSubscriptionBillingAccount`). Lookup errors are retryable
    500s, not unmatched.
  - Logging (verified on disk): UNMATCHED subscription, missing checkout
    row, and DUPLICATE SUBSCRIPTION all use `console.error` with Stripe
    ids attached (`event.id`; subscription unmatched also logs
    `type=` + `subscription=`; DUPLICATE logs existing/incoming sub ids).
  - Live verification (2026-07-31, production): cleared `applied_at` on the
    2026-07-19 `invoice.paid` event, resent from Stripe dashboard → 200,
    re-applied, restamped, billing state unchanged. Resent an untouched
    event → 200, `applied_at` unchanged. Both directions proven.

- **Live verification B1 (production, 2026-07-31):**
  Manager seeded in Lab1 (under Test Org). Clicked Upgrade → 403, no
  checkout session, `billing_accounts` count unchanged at 2. Log:
  `code=org_managed_billing`, lab `c0762265-…`. Under the old code this
  click would have created a third row and a second Stripe subscription:
  Test Org billed $600/mo for 2 labs instead of $400.

- **SCHEMA CAPTURE (current):**
  Regenerated 2026-07-31 via `pg_dump --schema=public --schema-only` of
  production. Authoritative file:
  `database-scripts/schema-2026-07-31.sql` (includes Phase A
  `get_my_lab_org_id` / grant/RLS changes and `processed_stripe_events.applied_at`).
  Prior `schema-2026-07-19.sql` retired. Regenerate after any future manual
  SQL change — do NOT hand-edit.
  **Dump networking (banked 2026-07-31):** the direct host
  `db.<ref>.supabase.co` resolves **IPv6-only** from this machine. Docker
  Desktop cannot reach that address (`Network is unreachable` on the AAAA),
  so `docker run … pg_dump` against the direct URL fails. Workaround that
  worked: a short-lived host-side TCP relay (Node `net` listen on
  `127.0.0.1:15432` → IPv6 DB), then
  `docker run --add-host=host.docker.internal:host-gateway` with
  `postgresql://…@host.docker.internal:15432/postgres?sslmode=require`,
  writing the file via a volume mount (`-v …/database-scripts:/out`) so
  PowerShell does not UTF-16 the output. Host-native `pg_dump` (if
  installed) can use the direct URL without a relay. Do not rediscover this
  the hard way next regenerate.

- **Closed questions (do not reinvestigate):**
  - Expiry columns (`active_lots`, `coa_records`, `inventory_lots`,
    `requests` expiry fields) are type `date`, not `timestamptz` — no
    timezone shift is possible on expiry dates. Only
    `billing_accounts.updated_at` and `mfa_recovery_elevations.expires_at`
    (among the audited set) are `timestamptz` for this concern.
  - profiles RLS = ENABLED — re-verified production 2026-07-31; prior note
    remains correct.

- **Key lessons (this session):**
  - `Intl.DateTimeFormat`: `dateStyle`/`timeStyle` cannot be combined with
    `timeZoneName` (or other component options) — it throws at runtime and
    `tsc` does not catch it. Use separate formatters.
  - `processed_stripe_events.received_at` is the receipt column; there is
    no `created_at` on that table.
  - Replaying an OLD `invoice.paid` would set `current_period_end`
    BACKWARDS — the handler takes the date from whatever invoice it is
    handed. Known limitation, no forward-only guard yet. Only ever replay
    the most recent invoice event per account.
  - Silent-empty remains the recurring failure mode (see Security Rules).
  - Schema dumps via Docker: direct Supabase DB host is IPv6-only here —
    see SCHEMA CAPTURE networking note (host relay or host-native pg_dump).

- **Remaining phases (current plan):**
  - **B2** — open. Pre-flight `already_subscribed` guard is self-defeating
    (reads the row checkout just inserted with hardcoded `trialing`, so it
    can never fire). Stripe customer is re-created per purchase instead of
    reused. Unreachable from the UI after B1, but still open.
  - **E** — open — **NEXT UP.** Super-admin billing overview excludes org
    labs entirely, so no Buddy surface would show an org billing problem.
    This week's defects were invisible from inside the product.
  - **F** — open. Quantity computed once at checkout; org lab-count changes
    never adjust the bill. Prorate-vs-next-renewal decision pending.
  - **Parked:** standalone paying lab later joins an org; forward-only
    guard on `current_period_end`; billing alerting/emails (Vercel cron) —
    the webhook now fails loudly to Stripe but nothing notifies James.
  - **2026-08-19:** both sandbox subscriptions renew — first-ever
    production run of the renewal path. Check Stripe webhook deliveries
    and Vercel logs that day.

- **Files (A + B1 + C + D):** `lib/resolve-billing-owner.ts`,
  `lib/resolve-billing-owner.test.ts`, `app/api/stripe/checkout/route.ts`,
  `app/api/stripe/portal/route.ts`, `app/dashboard/page.tsx`,
  `components/dashboard/billing-panel.tsx`,
  `components/dashboard/sidebar.tsx`, `lib/create-checkout.ts`,
  `lib/billing-portal.ts`, `lib/format-renewal-date.ts`,
  `lib/format-renewal-date.test.ts`, `app/api/stripe/webhook/route.ts`,
  `lib/stripe-subscription-account-resolution.ts`,
  `lib/stripe-subscription-account-resolution.test.ts`,
  `database-scripts/schema-2026-07-31.sql`. Phase A +
  `applied_at` are captured in that dump.

- **Current state:** A + B1 + C + D live and verified. Org-lab Upgrade
  path blocked server-side; customer surfaces RLS-scoped; webhook
  claim/apply/`applied_at` durable. `tsc --noEmit` exit 0; `npm test`
  30/30. Next: E (super-admin billing overview), then F / B2. Watch
  2026-08-19 renewal.
- **Correction (same day, 2026-07-31):** An early draft of the Key Technical /
  Security rules claimed Stripe routes gate role from the JWT while
  `resolveBillingOwner` re-reads `profiles` — presented as a deliberate
  cross-check. That was FALSE (both read `profiles.role` via the admin
  client) and was removed/replaced the same day. See corrected rule under
  Key Technical Rules / Security Rules.

### Session: July 17–24, 2026 — Week 3: Stripe Billing Integration
- **Headline:** Complete billing system in Stripe sandbox/test mode — from zero
  to enforced read-only. Checkout, webhook state mapping, Billing Portal,
  customer + super-admin billing surfaces, lab-wide banners, and 21 restrictive
  write policies keyed on `lab_billing_allows_writes()`. Both paying sandbox
  tenants (Oakwood + Test Org) active and production-verified.
- **Context:** Continuation after July 16 closed Batches 1–2. Week 3 (Stripe)
  deferred in that session; this session builds the full billing stack.
- **Commit note:** HEAD at close `e866b76`. Range `4ca2576..e866b76` — 8 code
  commits (`02121e2`, `ec3de11`, `1c1648b`, `ebaf9fa`, `37e15e6`, `1448eef`,
  `7e9c5ac`, `e866b76`). `de72452` within that range is the prior session's
  docs commit, not part of this work.

- **Phase 1 — Stripe sandbox + product:**
  Sandbox account under "Buddy LLC" (name changed this session from Buddy
  Technologies LLC; WY LLC still unformed). Seat-based recurring product,
  USD 200.00/lab/month, price ID `price_1TuXlqJVUm1zwdXYUpBnoxYa`. Env vars
  added to Vercel + `.env.local`: `STRIPE_SECRET_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID`,
  `STRIPE_WEBHOOK_SECRET`. Cloudflare Email Routing added:
  support@yourbuddyapp.com → personal inbox (receive-only; outbound stays on
  Resend).

- **Phase 2 — Schema (see SCHEMA CAPTURE):**
  - **`billing_accounts`:** id, org_id (FK RESTRICT, nullable), lab_id
    (FK RESTRICT, nullable), stripe_customer_id (unique),
    stripe_subscription_id (unique), billing_status CHECK IN
    (`trialing`|`active`|`past_due`|`suspended`) default `trialing`,
    current_period_end, created_at, updated_at.
    CONSTRAINT `billing_owner_exactly_one` CHECK
    `((org_id IS NULL) <> (lab_id IS NULL))`. Partial unique indexes on
    org_id and lab_id.
  - **`processed_stripe_events`:** event_id PK (Stripe `evt_` id), event_type,
    received_at, payload jsonb. Webhook idempotency.
  - **RLS at this phase:** `billing_accounts_select_scoped` (super_admin all /
    manager own lab / org_admin own org),
    `billing_accounts_require_active_user` (restrictive, mirrors deactivation
    pattern), `stripe_events_select_super`. No INSERT/UPDATE/DELETE
    policies for authenticated — writes are service-role only.

- **Phase 3 — Webhook log-only first** (`app/api/stripe/webhook/route.ts`):
  Raw-body read, signature verification as sole auth, idempotent upsert into
  `processed_stripe_events`, no state writes. Verified in production before
  any enforcement logic existed (deliberate deployment ordering).

- **Phase 4A — Checkout + customer billing surfaces**
  (`app/api/stripe/checkout/route.ts`):
  Rate limited (10/hr), bearer auth, manager/org_admin
  only, server-resolved billing owner (never client-supplied), get-or-create
  `billing_accounts` row, quantity = 1 for standalone lab or non-archived lab
  count for org. Checkout session with `client_reference_id` =
  `billing_accounts.id` AND `subscription_data.metadata.billing_account_id`
  (both threads, deliberately). Origin allowlist pinned. Customer billing
  surfaces built for manager (`/dashboard` Billing tab) and org_admin
  (`/org-admin`) — none existed before; all prior billing UI was super-admin
  only.

- **Phase 4B — Webhook state mapping (first delivery only):**
  - `checkout.session.completed` → store customer + subscription IDs, status
    `active` (guarded: refuses to overwrite a different existing subscription
    ID, logs DUPLICATE SUBSCRIPTION)
  - `invoice.paid` → `active` + `current_period_end`
  - `invoice.payment_failed` → `past_due`
  - `customer.subscription.updated` → period end; `active`/`past_due` mapped,
    other statuses leave `billing_status` unchanged
  - `customer.subscription.deleted` → `suspended`
  - Unresolvable account → logs `UNMATCHED <event_id>`, returns 200 (never
    500; payload already receipted).

- **Billing visibility (post-4B):**
  Unified `LabLicenseCard` for manager + technician, and a truth-driven
  super-admin Billing Overview table (per-org and per-standalone-lab rows,
  status, labs, $/month, sorted by urgency) replacing the hardcoded
  "Enterprise Plan" fiction and the `organizations.plan`-derived KPI cards.
  Technician branch added to `billing_accounts_select_scoped` (technician /
  own lab), paired with the `billing_accounts` column revoke: SELECT revoked
  table-level from authenticated, re-granted on `(id, org_id, lab_id,
  billing_status, current_period_end, created_at, updated_at)` only.
  Technicians read status; Stripe IDs became server-only for every client role.

- **Phase 5 — Enforcement:**
  - **`lab_billing_allows_writes()`** — STABLE SECURITY DEFINER, super_admin
    always true, resolves account via profiles → labs → billing_accounts
    (matching `ba.lab_id = p.lab_id OR ba.org_id = l.org_id`), returns
    `billing_status <> 'suspended'`, coalesce default TRUE (no billing row =
    allowed).
  - **21 restrictive policies:** 7 tables (`items`, `inventory_lots`,
    `active_lots`, `requests`, `coa_records`, `lot_validation_records`,
    `lab_settings`) × 3 cmds (INSERT with-check, UPDATE using+with-check,
    DELETE using).
  - **DELIBERATELY EXCLUDED:** `activity_logs` (ALCOA+ — audit trail never
    stops) and `feedback` (suspended labs must retain a support channel).
  - **`app/api/stripe/portal/route.ts`** — creates a Stripe Billing Portal
    session only. Cancel-at-period-end, update payment method, invoice
    history, and quantity-editing-disabled are **Stripe Dashboard portal
    configuration**, not app code (do not hunt the route for those behaviors).

  - Status-driven CTAs, lab-wide banner at top of `<main>` on `/dashboard`
    visible to all lab roles, `billing_status` added to the 30s poll (drives
    banner without refresh; never signs anyone out for billing state).

- **Architecture decisions (settled this session):**
  1. Per-lab quantity pricing: ONE Stripe subscription per paying tenant with
     quantity = lab count. Never one subscription per lab.
  2. Single `billing_accounts` table pointing at either an org or a standalone
     lab, never both. Chosen over duplicate columns on organizations + labs.
  3. Billing state is ORTHOGONAL to `profiles.is_active`. Never conflated:
     billing suspension does not touch `is_active`, does not fight the
     last-manager guard, and keeps `security_logs` semantics clean.
     Composition is AND at the gate.
  4. Trial stays in-app (`labs.trial_ends_at`). No Stripe object exists during
     trial; no card required. Stripe enters only at conversion.
  5. Suspended = READ-ONLY, never lockout. Data is never deleted for
     non-payment, and the manager's billing page always stays reachable —
     otherwise a lapsed customer could never pay.
  6. Trial expiry has NO grace (the 90-day trial was the grace). Payment
     failure for an existing customer gets 7 days `past_due` with full access.
  7. Stripe IDs are server-only at the column-grant level; the client branches
     on `billing_status` alone.

- **Lessons (hard-won; each cost real debugging time):**
  - Stripe does not follow redirects. The webhook URL must be the exact
    primary domain: `https://www.yourbuddyapp.com/...`. The apex 308-redirects
    and every delivery fails.
  - A 500 from the webhook can mean EITHER Stripe env var is bad, not just
    `STRIPE_WEBHOOK_SECRET` — the Stripe client constructor throws on a
    malformed secret key before any signature logic runs.
  - Browser GET on the webhook URL failing is expected (POST-only route), NOT
    evidence of a missing route. A missing route returns 404.
  - Stripe events arrive OUT OF ORDER: `invoice.paid` preceded
    `checkout.session.completed` by 164ms on first activation, so the
    subscription ID was not yet stored. The invoice metadata fallback path is
    load-bearing, not defensive.
  - Module-scope `new Stripe()` breaks the Vercel build (collect-page-data
    runs without env vars). Lazy-init inside the handler — see `ec3de11`. Now
    house style.
  - Revoking a column grant silently breaks client-side selects for EVERY role
    including super_admin, since super_admin also authenticates as
    `authenticated`. A UI branching on a revoked column reads undefined and
    silently takes the wrong branch (billing panel showed "Trialing" for an
    active account).
  - RESTRICTIVE policies for billing MUST be per-command
    (INSERT/UPDATE/DELETE), never `FOR ALL`. `FOR ALL` blocks reads too,
    turning read-only into lockout — the opposite of the design.
  - Stripe's failed-payment retry schedule must end in CANCEL, not "mark
    unpaid", or `customer.subscription.deleted` never fires and nothing is
    ever suspended.
  - Cancel-at-period-end correctly leaves `billing_status = active` until the
    period actually ends. Not a bug.

- **FULL PRODUCTION REGRESSION — 15-item (billing sealed):**
  Passed on production, both tenants active: all lab writes
  (item/lot/usage/COA/validation/request/delete/lab settings/feedback)
  succeed for manager and technician; `activity_logs` continues recording;
  technician self-promotion still returns 403 (July 15 fix holds under the
  new policies); deactivation eviction and banners correct; `security_logs`
  scoping per role unchanged. Suspension verified live on Oakwood: reads
  survive, all writes blocked for both roles, red banner within 30s without
  refresh, manager's Billing tab and Reactivate CTA reachable throughout.
  Restored to active cleanly. Technician column-grant split proven by
  exploit: 403 on `stripe_customer_id`, 200 on `billing_status` with a real
  technician JWT.

- **Production state at close:**
  Two paying tenants (sandbox): Oakwood Lab (standalone, lab_id
  `447da352-fadf-4c54-83b7-7019cc4bf714`, `cus_UundkJjI5myS0k`) and Test Org
  (org_id `5b15d0ec-06c8-4eed-92c9-762bcfbb4c60`, `cus_UunuORzTfzNIJr`,
  quantity 2), both active, renewing 2026-08-19. Stripe remains in
  SANDBOX/TEST mode — activation requires a US address (the WY registered
  agent), so it is blocked on LLC formation.

- **SCHEMA CAPTURE (drift resolved at the time; later superseded):**
  The Week 3 schema was executed manually in the Supabase SQL editor and existed
  only in production. It was first captured as
  `database-scripts/schema-2026-07-19.sql` (via `npx supabase db dump`), covering
  tables, RLS policies, functions, and grants — including `billing_accounts`,
  `processed_stripe_events`, the 21 billing restrictive policies,
  `lab_billing_allows_writes()`, and the `billing_accounts` column
  revoke/re-grant. That file also captured the `coa_records` and
  `lot_validation_records` permissive policies that had never appeared in any
  repo SQL file, and superseded `supabase-copy.sql` (still DEPRECATED).
  **Current source of record:** `database-scripts/schema-2026-07-31.sql`
  (Phase A + `applied_at`; 07-19 retired). Regenerate after any future manual
  SQL change — do NOT hand-edit.

- **Deferred / next:**
  - **UNTESTED PATH:** the `ba.org_id = l.org_id` branch of
    `lab_billing_allows_writes()` has never been exercised by a real user,
    because no user exists inside any Test Org lab. An org customer's
    suspension may silently fail to block writes. Test before the first org
    customer onboards.
  - App-sent billing emails (trial ending in 7 days; lab suspended) — own
    small phase; needs Vercel cron for the trial warning. Stripe's own
    failed-payment emails ARE ENABLED and cover only the payment-failure case.
  - `organizations.plan` retirement: KPI cards no longer use it, but
    `/super-admin/orgs/[id]` and `/super-admin/labs/[id]` still read it for
    badges and the +30/+90 trial-extend buttons.
  - Oakwood's `labs.trial_ends_at` (2026-08-04) is now vestigial for a paying
    lab; decide whether trial columns retire once `billing_accounts` is
    authoritative.
  - Live-mode switch checklist: new live product + price ID, live keys, new
    webhook endpoint + signing secret, Stripe account activation with the WY
    registered agent address.
  - Table-count drift: Security Layers and SVP-style sections still say "17
    tables"; actual count is 19 with `billing_accounts` and
    `processed_stripe_events`. Compliance docs must be consistent before customer
    onboarding — sweep all four documents, not just CLAUDE.md.

- **Files changed this session (8 code commits, HEAD e866b76):**
  Named in this session's work: `app/api/stripe/webhook/route.ts`,
  `app/api/stripe/checkout/route.ts`, `app/api/stripe/portal/route.ts`,
  `lib/create-checkout.ts`, `lib/billing-portal.ts`,
  `components/dashboard/billing-panel.tsx`, `package.json` /
  `package-lock.json` (Stripe SDK), manager `/dashboard` Billing tab +
  lab-wide banner/30s poll, `/org-admin` billing section, unified
  `LabLicenseCard` (manager + technician), truth-driven super-admin Billing
  Overview. Schema artifact at that close:
  `database-scripts/schema-2026-07-19.sql` (since superseded by
  `schema-2026-07-31.sql`). Full file
  list is the `4ca2576..e866b76` code commit range (8 commits above).

- **Current state:** Week 3 Stripe billing SHIPPED in sandbox and
  production-verified (15-item regression + live suspension on Oakwood).
  Checkout, portal, webhook state mapping, status-driven CTAs, lab-wide
  banner + poll, and write-gate RLS all live. Stripe live-mode blocked on
  LLC formation. Next: remaining Deferred items (org-path suspension branch
  untested; table-count doc sweep; `organizations.plan` retirement; live-mode
  checklist).

### Session: July 16, 2026 — Security-Log Viewer (Batch 2 Phase 2) + Eviction-Message Fix — BOTH BATCHES CLOSED
- **Headline:** Batch 2 Phase 2 (security-log viewer, 3 surfaces) built and
  verified; deactivation eviction-message bug fixed; full production
  regression 10/10. Batches 1 (hygiene) and 2 (MFA events, privilege-
  escalation fix, role governance, viewer) are now FORMALLY COMPLETE and
  verified as a coherent system on production.
- **Context:** Continuation of the July 15 session (pre-Stripe audit +
  privilege-escalation fix). This session closed the one remaining Batch 2
  item (the viewer) plus one bug found during its testing. Week 3 (Stripe)
  deferred until user chose to finish both batches first.

- **Batch 2 Phase 2 — SECURITY-LOG VIEWER (SHIPPED, production-verified):**
  Read-only viewer over security_logs, mirroring the activity-log pattern,
  with full filtering (search, event-type multi-select, user, date range).
  - **Placement (three surfaces):** super_admin → global "Security Log"
    SECTION on the /super-admin main page (all rows incl lab_id NULL);
    org_admin → SECTION on the /org-admin single-page layout (org-scoped);
    manager → manager-only SIDEBAR TAB on the dashboard (Validation gating
    pattern, hidden from technicians). Manager tab uses the right-panel
    filter LAYOUT group (["inventory","lotinuse","requests","activitylog",
    "securitylog"]), NOT the solo Validation mount — Validation has no
    filters, the viewer does.
  - **Org_admin RLS read-gap FIXED** (database-scripts/security-logs-viewer-rls.sql):
    the old security_logs_select_scoped shared a manager/org_admin branch
    checking lab_id = get_my_lab_id(). Org_admin JWT lab_id is NULL, so
    NULL = NULL → unknown → they matched NOTHING (not even own events).
    New policy splits the branch: manager → lab_id = get_my_lab_id();
    org_admin → lab_id IN (SELECT id FROM labs WHERE org_id = get_my_org_id()).
    Org_admin does NOT see lab_id NULL rows (those stay super_admin-only,
    per existing rule). super_admin branch unchanged. Restrictive
    require_active_user policy untouched (deactivated users read nothing).
  - **Fetch divergence from activity-log (CRITICAL):**
    fetchSecurityLogsFromSupabase deliberately does NOT call
    resolveCurrentUserLabId() and does NOT early-return on null lab_id —
    super_admin has null lab_id and must receive ALL rows. It relies purely
    on RLS to scope; no .eq("lab_id"). (The activity-log fetch's null-lab
    early-return would have shown super_admin an EMPTY log.)
  - **Shared components:** security-log-table.tsx (date-grouped timeline +
    print, columns Time/User/Event/Outcome/Details/IP, +Lab when showLab),
    security-log-filters.tsx, security-log-panel.tsx (self-contained
    org/super viewer). SECURITY_EVENT_TYPES label map (snake_case → Title
    Case) + SecurityLogEntry type live in lib/inventory-utils.ts next to
    the fetch. formatActivityLogTimestamp reused (lab TZ on dashboard, UTC
    on super/org).
  - **Per-role scoping VERIFIED on production:** the invariant holds —
    super_admin sees ALL rows; manager sees only their lab's rows; the
    difference between the two equals the null-lab (super_admin-only) row
    count exactly. Technician sees ZERO and has NO tab.

- **Deactivation eviction-message BUG FIXED** (app/dashboard/page.tsx +
  app/org-admin/page.tsx):
  - **Bug:** a user deactivated mid-session while IDLE was correctly evicted
    but saw "logged in from another device" (session-replaced message)
    instead of the deactivation banner. Cause: the deactivation RPC deletes
    the active_sessions row; verifyActiveSessionForUser returns "replaced"
    for BOTH a missing row (deactivation) and a token mismatch (real device
    replacement) — it cannot distinguish them. The 30s poll caught the
    missing row before the mount-only checkSessionAndRole gate, so idle
    users got the wrong message.
  - **Fix:** both 30s poll loops now add is_active to their existing profile
    SELECT and, BEFORE verifyActiveSessionForUser, check
    `if (profile?.is_active === false) → deactivatedSignOut(router, userId)`.
    Explicit === false (not falsy) so a transient undefined read can't
    false-evict. Genuine device replacement (user still is_active=true, row
    exists with different token) still falls through to "replaced" →
    sessionReplacedSignOut → amber message. lib/active-session.ts UNCHANGED
    (verify stays "ok"|"replaced"). deactivatedSignOut still writes NO
    security event (forced-signout exclusion preserved).
  - **VERIFIED on production:** idle deactivation → RED "account deactivated"
    banner; second-device login → AMBER "logged in from another device".
    Both messages now correct.

- **FULL PRODUCTION REGRESSION — 10/10 (both batches sealed):**
  (1) technician self-escalation → 403 (July 15 fix holds); (2) viewer
  per-role scoping invariant correct; (3) idle deactivation → red banner;
  (4) device replacement → amber; (5) mid-session deactivation cuts data
  access via RLS instantly; (6) registration produces technician; (7) Edit
  Role works, role_changed logged with ACTOR attribution; (8) last-manager
  demotion amber warning fires; (9) all 9 security_logs event types
  populated (mfa_factor_replaced confirmed after a clean regenerate);
  (10) normal users unaffected (dashboards load, bell no eternal spinner).

- **Parked notes / known properties (so future sessions don't misread as bugs):**
  - **Eviction TIMING is by-design, NOT a lag bug:** RLS cuts a deactivated
    user's DATA access INSTANTLY (queries return empty on flag flip); the
    SESSION eviction (bounce to /login) rides the 30s poll, so an idle user
    may sit on an empty screen up to 30s before eviction. This is the
    Decision-2 tradeoff (reuse the existing poll, no new push mechanism).
    Only a bug if they could still READ DATA for 30s — they cannot.
  - **IP column display:** renders raw values; ::1 appears for
    localhost/dev-origin events (IPv6 localhost), real IPs for production
    events. Cosmetic only — could render "—" for null and label ::1 as
    "localhost". Not a bug; low priority.
  - **mfa_factor_replaced** now populated (was empty until a clean regenerate;
    earlier abandon-and-resume regenerations logged as enrolled because the
    ?mode=replace flag doesn't survive the abandon path — see July 15 notes).

- **Files changed this session (two commits, HEAD 4ca2576):**
  Viewer — Phase 2a RLS + Phase 2b UI landed together in ONE commit
  (a5ad19a): database-scripts/security-logs-viewer-rls.sql,
  lib/inventory-utils.ts, components/dashboard/security-log-table.tsx,
  components/dashboard/security-log-filters.tsx,
  components/dashboard/security-log-panel.tsx,
  components/dashboard/sidebar.tsx, app/dashboard/page.tsx,
  app/super-admin/page.tsx, app/org-admin/page.tsx.
  Eviction fix (4ca2576): app/dashboard/page.tsx, app/org-admin/page.tsx
  (same two files also touched by the viewer commit).

- **Current state:** BOTH BATCHES COMPLETE, production-verified. Batch 1
  (hygiene, tsc=0) and Batch 2 (MFA events, privilege-escalation fix, role
  governance + set_user_role RPC, security-log viewer + org_admin RLS fix,
  eviction-message fix) all shipped. tsc at ZERO. security_logs captures the
  full access-control lifecycle across 9 event types. Only cosmetic parked
  items remain (IP display). Week 3 (Stripe) is the next major work.
  Pre-Stripe architecture questions (from July 15): webhook auth
  (signature-verified, not bearer), how billing state composes with
  is_active, org-level billing against zero-org production.

### Session: July 15, 2026 — Pre-Stripe Audit + MFA/Role Security Events + LIVE PRIVILEGE-ESCALATION FIX
- **Headline:** A full pre-Stripe integrity audit surfaced a CONFIRMED live
  privilege-escalation vulnerability — a technician could promote themselves
  to manager via a direct client-side profiles.update({role}) write (RLS
  permitted it; no column constraint). Verified exploitable against production
  (REST PATCH as technician returned 200, self-promoted to manager), then
  CLOSED and re-verified (same attack now returns 403). This was caught the
  week before Stripe — exactly what the pre-integration audit was for.
- **Context:** This session followed the Week 2 user-deactivation build
  (Phases A–F, shipped and verified — see prior session records). Sequence
  here: (1) pre-Stripe audit, (2) hygiene fix pass, (3) MFA security events
  (Batch 2 Phase 1a), (4) role-change governance + the escalation fix (Batch 2
  Phase 1b). Batch 2 Phase 2 (security-log viewer UI) deferred — feature
  completeness, not security; better built after Stripe adds its own
  security-relevant events.
- **Commit note:** These passes span four commits — e25cc01 (deactivation
  Phases E–F closeout, bundled with the audit's rate-limit/doc fixes),
  2444b9c (hygiene), 7902bc4 (Phase 1a), 1894d5e (Phase 1b), plus
  be916f4 (follow-up syncing role-column-lockdown.sql to its deployed form).
  Fix pass 1 was not a standalone commit — it shared e25cc01 with E–F.

- **Pre-Stripe integrity audit (read-only, Cursor + live SQL) — GO verdict:**
  Zero HIGH findings in the deactivation stack itself (all Part 2 checks green;
  prosrc of set_user_active_status verified IDENTICAL to repo, byte-for-byte in
  substance). Four MEDIUM + three LOW, all documentation/hygiene, all fixed:
  - Rate-limit key collision: enroll, user-email, feedback-notify keyed on bare
    IP (shared Upstash bucket per IP). Fixed — all limited routes now prefixed
    (mfa-enroll:, user-email:, feedback-notify:).
  - `/api/security-log` (shipped July 10) was undocumented. Now documented as
    route; canonical API route count corrected to **8** everywhere (then 1a/1b
    added enroll-complete + set-role → **10**).
  - CLAUDE.md profiles schema block updated with the three deactivation columns
    + both CHECK names; SVP references bumped to v1.2; profiles table count
    confirmed 17 throughout.
  - `supabase-copy.sql` finally stamped DEPRECATED (long-deferred item closed
    via the deprecate path).
  - REQ-011 added to traceability matrix; deactivation line added to
    pre-customer checklist.
  - Two stray "16 tables" refs (pre-customer-checklist, traceability-matrix)
    corrected to 17.

- **Hygiene fix pass — tsc --noEmit at ZERO for the first time in project history:**
  - Fixed the three long-standing pre-existing TS errors (orgs/[id] invite
    PromiseLike, use-bell-alerts role union + PromiseLike + array-
    embed cast). Widened useBellAlerts's role union so header's role prop
    type-checks — header.tsx itself was untouched. The bell-alerts embed fix
    is Array.isArray-aware (approved runtime change: array case goes from
    silently-broken to correct).
  - Two react/no-unescaped-entities lint hits escaped (login + labs copy).
  - Enroll route auth consolidated onto authenticateBearerRequest (verified
    zero behavioral difference before consolidating).
  - Edit Role / Revoke Invite overlays retrofitted with the modal conventions
    (Enter/ESC/Android-back).

- **Batch 2 Phase 1a — MFA security events (SHIPPED, verified):**
  - security_logs event/outcome constraints extended (both layers) with
    `mfa_factor_enrolled`, `mfa_factor_replaced`, `role_changed` (role_changed
    reserved here, written in 1b).
  - New route `POST /api/mfa/enroll-complete` (10/hr, mfa-enroll-complete:${ip}):
    server-side fact-check that a VERIFIED totp factor actually exists before
    logging (409 no_verified_factor otherwise) — event attests to real server
    state; only the enrolled-vs-replaced label trusts a client flag (low-stakes).
  - Verify completes CLIENT-SIDE (supabase.auth.mfa.challengeAndVerify in
    lib/mfa.ts), NOT in /api/mfa/enroll — hence the separate completion route.
    completeEnrollmentLog is fire-and-forget (never blocks/delays enrollment UX
    or the recovery-code step).
  - Regenerate pushes /mfa-setup?mode=replace. Verified live: mfa_factor_replaced
    and mfa_factor_enrolled rows landed, self-attributed; 409 guard confirmed
    for the factorless case.

- **Batch 2 Phase 1b — role-change governance + PRIVILEGE-ESCALATION FIX
  (SHIPPED, verified):**
  - **The hole:** profiles_update_own_or_super WITH CHECK was
    (id = auth.uid() OR super_admin) with NO role constraint. An active
    technician could UPDATE their own row's role to manager. RLS restrictive
    policy (Phase B) blocks deactivated users but checks is_active, not role —
    active users sailed through. Confirmed exploitable (200 → self-promoted).
  - **The fix — column-level privilege, not policy logic (stronger; no
    expression to misconfigure):** The live handle_new_user trigger already
    assigns role from signup meta for ALL four roles (incl. org_admin), so
    client-side role writes in registration were redundant. Removed `role` from
    all four registration profiles.update calls (signup options.data still feeds
    the trigger). Then:
      REVOKE UPDATE ON public.profiles FROM authenticated, anon;
      GRANT UPDATE (full_name, lab_id, org_id) ON public.profiles TO authenticated;
    NOTE — a plain `REVOKE UPDATE (role)` is a NO-OP: Supabase grants
    table-level UPDATE, which implicitly covers every column; a column-level
    REVOKE cannot remove a table-level grant. Must revoke the table grant and
    re-grant only the permitted columns. role, is_active, and the deactivation
    columns are deliberately NOT re-granted (all RPC-only now).
  - **set_user_role RPC + POST /api/users/set-role** (mirrors set-active
    exactly): actor-from-token, hierarchy check, FOR UPDATE last-manager
    DEMOTION guard (manager→technician that would leave a lab adminless is
    blocked; super_admin actor exempt for restructure/offboarding), atomic
    role update (NO session kill — JWT role stale until re-login, UI says so),
    role_changed audit-after-action with true ACTOR attribution + old→new in
    details. Four Edit Role surfaces rewired to lib/set-user-role.ts helper;
    last-manager demote disabled on dashboard + org-admin, amber warning on
    super-admin labs/orgs (same viewer-role split as deactivation Phase E).
  - **Verified live:** escalation snippet 200 → 403 (hole closed with the
    attack itself); registration still produces technician correctly;
    role_changed rows land with actor attribution + transition; last-manager
    amber warning fires.

- **DEPLOYMENT-ORDER LESSON (matters for Stripe):** When two changes are
  interdependent, order inside the pair is set by which side fails safe.
  Here: new-client (stops writing role) + old-DB works fine; old-client +
  new-DB (REVOKE applied) breaks registration. So CLIENT DEPLOYS FIRST, then
  the DB lockdown. Cursor's initial deploy note had this backwards ("run SQL
  then deploy in same release") — corrected to app-code-first. Same principle
  will apply to Stripe webhook auth vs enforcement ordering.

- **Parked notes / known properties (added this session):**
  - `role-column-lockdown.sql` in the repo must contain the table-revoke +
    column-regrant form, NOT the ineffective REVOKE UPDATE (role). Repo file
    synced to production via a follow-up Cursor edit (drift-prevention, per the
    July 10 production-is-authoritative rule).
  - MFA regenerate deletes the OLD factor before the NEW one is verified — a
    user who abandons mid-regenerate is left factorless, and a manager then
    hits the MFA gate on next login. Pre-existing behavior; documented, not
    fixed this batch.
  - active_sessions poll (verifyActiveSessionForUser) fails OPEN on query error
    (returns "ok") — deliberate availability choice; transient DB errors never
    evict. Documented, not changed.
  - Offboarding practice: rotate the lab tech_key when deactivating staff —
    deactivation blocks the account but not re-registration with a remembered
    key.
  - A completed enrollment after an abandoned regenerate logs mfa_factor_enrolled
    (the mode=replace flag doesn't survive the abandon-and-resume path).
    Acceptable — both events mean "a factor became active."

- **Deferred (unchanged / newly noted):**
  - Batch 2 Phase 2: security-log VIEWER UI (manager/org_admin/super_admin tab,
    hidden from technicians). Discovery done. **RLS gap to fix in that phase:**
    security_logs_select_scoped gives org_admin effectively NO read access
    (their JWT lab_id is null; policy checks lab_id = get_my_lab_id()). Needs an
    org-scoped read branch (via the org's lab IDs) before the org-admin viewer
    works. Managers + super_admin read fine as-is. New sidebar tab pattern
    mirrors the Validation manager-only tab + activity-log fetch/filter/date-group.
  - Still deferred from before: 2FA disable events (N/A — no disable exists),
    role-change events now SHIPPED, enroll route already consolidated this
    session. supabase-copy.sql now DEPRECATED (closed).

- **Files changed this session (across all four passes):**
  Audit fixes (in e25cc01, alongside E–F): app/api/mfa/enroll/route.ts,
  app/api/super-admin/user-email/route.ts, app/api/feedback-notify/route.ts,
  docs/api-documentation.md, CLAUDE.md, docs/software-validation-plan.md,
  database-scripts/security-logs.sql, database-scripts/supabase-copy.sql,
  docs/traceability-matrix.md, docs/pre-customer-checklist.md.
  Hygiene pass: app/super-admin/orgs/[id]/page.tsx,
  app/super-admin/labs/[id]/page.tsx, hooks/use-bell-alerts.ts,
  app/login/page.tsx (lint escape), app/api/mfa/enroll/route.ts.
  Phase 1a: database-scripts/security-events-extension.sql,
  database-scripts/security-logs.sql,
  app/api/mfa/enroll-complete/route.ts, lib/mfa.ts,
  components/dashboard/profile-settings-dialog.tsx, app/mfa-setup/page.tsx,
  app/welcome/page.tsx.
  Phase 1b: database-scripts/role-column-lockdown.sql,
  database-scripts/set-user-role-rpc.sql, app/api/users/set-role/route.ts,
  lib/set-user-role.ts, lib/inventory-utils.ts, app/org-admin/page.tsx,
  app/super-admin/labs/[id]/page.tsx, app/super-admin/orgs/[id]/page.tsx,
  components/dashboard/lab-settings-tab.tsx, app/register-lab/page.tsx,
  app/login/page.tsx (registration role-drop).

- **Current state:** All Batch 2 security work complete and production-verified.
  tsc at ZERO. Both role gaps closed (self-escalation + unguarded demotion),
  role_changed + MFA events live, pre-Stripe audit GO. Only the security-log
  viewer (Phase 2) remains from Batch 2 — deferred. Week 3 opens on Stripe.

### Session: July 13–14, 2026 — Week 2: User Deactivation Phases A–E Shipped
- **User deactivation shipped end-to-end (Phases A–E) + docs closeout (Phase F).**
  Deactivation is the decided user-lifecycle model (reversible, no FK-cascade
  risk); hard deletion / tenant offboarding remain separate future workflows.
- **Phase A — schema (`database-scripts/user-deactivation.sql`, executed in
  Supabase):** `profiles.is_active` (boolean NOT NULL DEFAULT true) +
  `deactivated_at` + `deactivated_by` (text snapshot, not FK);
  state-coherence CHECK (`profiles_deactivation_state_chk` — half-set states
  unrepresentable); super_admin immunity CHECK
  (`profiles_super_admin_always_active_chk` — super_admin structurally
  non-deactivatable at the DB layer; API checks are just friendly errors);
  `public.user_is_active()` (SQL, STABLE, SECURITY DEFINER, empty search_path,
  fail-closed to false). `security_logs` event_type + pairing constraints
  extended with `user_deactivated` / `user_reactivated` (success-only pairs).
- **Phase B — restrictive RLS (`database-scripts/user-deactivation-rls.sql`):**
  13 `AS RESTRICTIVE FOR ALL TO authenticated` policies using
  `(SELECT public.user_is_active())` (initplan — one profiles PK lookup per
  statement) so a deactivated user's data access dies instantly, even
  mid-session on a valid token. Restrictive ANDs with permissive — lab scoping
  unchanged. **Deliberate exclusions:** `profiles` (deactivated user must read
  own row for a legible gate message), `active_sessions` (eviction/poll
  semantics unchanged; Phase D deletes the row explicitly),
  `mfa_recovery_codes` + `mfa_recovery_elevations` (auth flows untouched).
- **Phase C — login + gate enforcement:** `is_active` added to exactly six
  profiles SELECTs (login, dashboard checkSessionAndRole, super-admin ×3,
  org-admin). Login denies before MFA challenge/routing with inline error;
  gates deny via new `deactivatedSignOut(router, userId)` in
  `lib/active-session.ts` → `/login?reason=account_deactivated` (red banner,
  distinct from amber session_replaced). Gate denials write NO security event —
  forced/system signouts are a documented security_logs exclusion.
- **Phase D — RPC + API route:** `set_user_active_status(actor, target,
  active)` (plpgsql SECURITY DEFINER, jsonb error codes, **service_role-only
  EXECUTE** — every call must flow through the API route so auth + rate limit +
  audit are guaranteed). Hierarchy: super_admin → any; org_admin → own org
  (checks BOTH target.org_id AND labs.org_id since org-lab technicians have
  profiles.org_id NULL); manager → own-lab manager/technician targets
  (self-deactivation legal when the guard passes). **Last-admin guard is
  race-proof via FOR UPDATE row locks; super_admin actor is EXEMPT (deliberate
  offboarding override).** Deactivation deletes the target's active_sessions
  row in the same transaction (30s poll evicts live sessions).
  `POST /api/users/set-active`: 20/hr Upstash with PREFIXED key
  `set-active:${ip}` (MFA-route convention; user-email's bare-IP key is the
  known pre-existing exception); failures return `error` + additive
  `error_code`; success-only (audit-after-action) `user_deactivated` /
  `user_reactivated` security_logs writes, actor-attributed, lab_id = target's.
- **Phase E — UI on four surfaces:** dashboard Team Management
  (lab-settings-tab), /org-admin members, /super-admin/labs/[id] members,
  /super-admin/orgs/[id] Members tab. "Deactivated" badge (deactivated_at in
  tooltip), confirm modal per modal conventions (textarea-guarded Enter,
  ESC, pushState/popstate Android back), reactivate = direct action (no
  modal). Shared bearer helper `lib/set-user-active.ts`. No control ever
  renders on a super_admin row (explicit guards + fetchLabProfiles filter).
  Client-side last-admin disable (manager targets) on dashboard + /org-admin.
- **Phase E fix — super-admin last-manager handling:** the client-side disable
  was initially applied on /super-admin/labs/[id] too, but the RPC exempts
  super_admin actors from the guard. Fixed: on the super-admin lab page the
  Deactivate button is always enabled and the confirm modal instead shows an
  amber WARNING ("This is the lab's last active manager…"). Viewer-role
  distinction commented in code: manager/org_admin actors are genuinely
  blocked by the guard, so dashboard + /org-admin keep the disabled state
  (org_admin escalation to super_admin is the decided MVP flow).
- **Phase F — docs closeout:** api-documentation.md route #7
  (users/set-active, full section + TOC + 429 summary); SVP bumped to v1.2
  (table count 16→17 for security_logs, revision row added); CLAUDE.md table
  counts 16→17 and 8F route count updated.
- **Key learnings / parked notes:**
  - Offboarding practice (parked): rotate the lab `tech_key` when
    deactivating staff — deactivation blocks the ACCOUNT, not re-registration
    with a remembered key.
  - Known property (documented, not changed): the active_sessions 30s poll
    fails OPEN on query error (`verifyActiveSessionForUser` returns "ok") — a
    deliberate availability choice.
- **Still deferred (unchanged):** 2FA enable/replace and role-change
  security-log events; security_logs viewer UI.
- **Files changed:** `database-scripts/user-deactivation.sql`,
  `database-scripts/user-deactivation-rls.sql`,
  `database-scripts/user-deactivation-rpc.sql`,
  `app/api/users/set-active/route.ts`, `lib/active-session.ts`,
  `lib/set-user-active.ts`, `lib/inventory-utils.ts`, `app/login/page.tsx`,
  `app/dashboard/page.tsx`, `app/org-admin/page.tsx`,
  `app/super-admin/page.tsx`, `app/super-admin/labs/[id]/page.tsx`,
  `app/super-admin/orgs/[id]/page.tsx`,
  `components/dashboard/lab-settings-tab.tsx`, `docs/api-documentation.md`,
  `docs/software-validation-plan.md`, `CLAUDE.md`.

### Session: July 11, 2026 — API Doc Cleanup + SVP Controlled-Document Fields
- **docs/api-documentation.md cleanup pass COMPLETE** (doc-only; no route code
  touched). Closes the June 16 deferred api-doc findings:
  - Documented 6th route `GET /api/super-admin/user-email` (super_admin-only,
    returns PII email, 20/hr Upstash; rate limit before auth).
  - Rate-limit ordering corrected: Upstash runs BEFORE auth on limited routes
    (429 can precede 401). recovery-elevation-status remains unlimited by design.
  - feedback-notify side effects now include submitter email (intentional,
    for reply).
  - Redeem section: explicit sentence that super_admin/org_admin redemptions
    write to `security_logs` with `lab_id = NULL` (July 10).
  - §3b architecture note retitled to present-tense DB-row model; historical
    "cleanup applied" changelog bullets removed.
- **June 16 §3b finding — accuracy note for the record:** By execution time
  the deferred claim that "two internal strings still carry old aal2/hook
  wording" was already partially stale (those strings were gone; only a
  changelog-style leftovers note remained). FIX 2 removed that remaining
  changelog content and left present-tense architecture docs only. Closes
  the loop on the June 16 deferred item accurately.
- **docs/software-validation-plan.md:** §9 Author set to James Cheong;
  revision table completed (v1.0 June 2026 initial; v1.1 June 16, 2026
  accuracy corrections). Version number not bumped (controlled-document
  fields only).
- **Files changed:** `docs/api-documentation.md`,
  `docs/software-validation-plan.md`, `CLAUDE.md`.

### Session: July 10, 2026 — Tenant Wipe EXECUTED (four test tenants)
- **Wipe executed and verified in production:** TestLab
  (beea89ce-abc4-4e9a-b6ab-210253a40641), TestLab123
  (1c78c34a-609c-406c-8645-f79116c00ecc), TestLabinOrg
  (98cfff3c-77eb-48df-8cc3-e2379cd0c820), and TestOrg
  (3fb26e5e-5ac4-44e7-8c8d-6ec42e74593c) deleted. Post-wipe query confirms
  Oakwood Lab is the only remaining lab; organizations table is empty.
  This is the documented tenant-wipe exception to audit-log immutability
  (activity_logs rows for these labs removed via CASCADE, per rule).
- **Method (template for future real-customer offboarding, ToS §3.3/§5.3):**
  1. Live FK introspection via pg_constraint FIRST (never trust repo SQL or
     docs for ON DELETE behavior — introspection corrected two doc-derived
     assumptions).
  2. Read-only dry-run: resolve names → UUIDs, snapshot attached users,
     safety checks, per-table row-count preview.
  3. Destructive script with UUID literals (no name lookups at destruction
     time), allow-list guards (RAISE EXCEPTION on any UUID/name mismatch),
     re-check of dry-run assumptions at execution time, per-step row-count
     assertions, single transaction (any failure = full rollback).
- **Dry-run findings:** zero profiles referenced any target tenant (June
  archival had already stripped users); zero operational rows in all
  lab-scoped tables; only 3 lab_settings rows (auto-created), cascaded away.
  Zero coa_records → no storage purge needed for this wipe.
- **Live FK findings (schema facts, now verified — matter for offboarding):**
  - `profiles.org_id → organizations` is ON DELETE **RESTRICT** — creates a
    circular block with `organizations.created_by` (NO ACTION) if an org's
    creator belongs to it. Break by deleting target profile rows BEFORE the
    org. Deliberate production guard: an org with attached users cannot be
    deleted. Do not change.
  - `labs.owner_id → auth.users` is ON DELETE **SET NULL** — deleting a user
    who owns a non-target lab silently nulls that lab's owner. Offboarding
    runbook must check owner_id references before any user delete.
  - `lab_invites` cascades with its lab AND its org; only
    created_by/revoked_by (NO ACTION) block user deletes.
  - `requests.item_id` NO ACTION confirmed live — harmless in whole-lab
    deletes (same-statement cascade), blocks item-level deletes only.
  - `coa_records` + `lot_validation_records`: CASCADE on both lab_id and
    lot_id (previously unverified).
  - Full delete order used: labs → profiles (n/a this time) → org →
    auth.users (n/a this time). security_logs rows survive via SET NULL.
- **Storage rule (recorded for offboarding):** Supabase Storage objects are
  NOT relational — DB row deletion never removes bucket files. Purge must go
  through Storage API/dashboard (`storage.from(bucket).remove()`), never SQL
  on storage.objects (orphans billed files). Separate non-transactional step.
- **Post-wipe state:** Oakwood is a standalone lab (org_id NULL). Nothing in
  production exercises the org layer anymore.
- **Orphan check PASSED:** zero auth.users rows without a profiles row —
  no dangling accounts from prior test cleanups. Database fully clean
  post-wipe.
- **Post-wipe verification (July 11 — all three passed):**
  - Oakwood Lab intact and fully operational — login, inventory,
    activity log, members all confirmed working post-wipe
  - security_logs lab_id FK ON DELETE SET NULL behaviorally verified:
    rollback-transaction test in Supabase SQL editor (throwaway lab +
    security row → lab deleted → row survived with lab_id = NULL →
    intentional rollback, zero data persisted). Method: DO block with
    verdict embedded in the terminating exception message, since the
    Supabase editor suppresses RAISE NOTICE output. The 5 pre-existing
    null-lab rows are all super_admin test events from July 10; the wipe
    itself had no security rows to nullify (test-tenant users predated
    the table).
  - Orphan check re-run for all four wiped tenant UUIDs across child
    tables: zero rows returned.
- **Deferred at session close (non-blocking):**
  - Demo strategy: leaning toward a dedicated seeded demo lab separate
    from Oakwood — decision + seeding deferred. If adopted, update the
    8I line that frames Oakwood as the demo lab.
  - Optional code sweep: only to confirm storage path conventions for
    the future offboarding runbook; nothing current depends on it.
- **No code changes this session** — SQL-editor only. Files changed: CLAUDE.md.

### Session: July 10, 2026 — Security Logs Parts A–E + Domain Cutover Verification
- **Domain cutover complete and verified:** remaining `buddy-lab-tracker.vercel.app`
  references replaced with `yourbuddyapp.com` in active docs; production
  verification confirmed.
- **Security logs (Parts A–E) shipped end-to-end:** `security_logs` migration,
  server write helper, client login/logout route wiring, recovery
  generate/redeem server-side logging, and documentation closeout all completed,
  committed, pushed, and production-verified.
- **Super_admin/org_admin audit gap closed and verified in production:** recovery
  events now persist with `lab_id = NULL` rows in `security_logs` (no silent
  drop for non-lab-scoped roles).
- **Identity and attribution hardening:** shared
  `resolveSecurityLogIdentity()` now resolves role via profile → JWT
  `user_role` claim → lowest-privilege fallback and appends
  ` [role unverified — attribution fallback]` to row details when fallback is used.
- **Dead code removal + attribution consistency:** deleted
  `lib/log-mfa-activity-server.ts` (zero remaining imports) and extracted shared
  initials logic to `lib/user-initials.ts` for both activity and security logs.
- **Files changed this session:** `.gitignore`, `CLAUDE.md`,
  `docs/api-documentation.md`, `database-scripts/security-logs.sql`,
  `lib/log-security-event-server.ts`, `lib/security-log.ts`,
  `lib/user-initials.ts`, `lib/inventory-utils.ts`,
  `app/api/security-log/route.ts`,
  `app/api/mfa/recovery-codes/generate/route.ts`,
  `app/api/mfa/recovery-codes/redeem/route.ts`,
  `app/login/page.tsx`, `components/dashboard/header.tsx`,
  `app/dashboard/page.tsx`, `app/org-admin/page.tsx`,
  `app/super-admin/page.tsx`, `lib/active-session.ts`,
  `docs/pre-customer-checklist.md`.

### Session: July 9, 2026 — API Doc Enroll Rate-Limit Cleanup
- **api-documentation.md:** Removed stale dev-era parentheticals on mfa/enroll rate
  limit (route header line 88 and §429 summary line 346). Code has been 10/hr since
  the July 7 session (`app/api/mfa/enroll/route.ts`); doc now matches live route.
  Resolves the last remaining enroll-limit doc drift flagged during the July 7
  Fable re-check (code was already correct; only the doc parentheticals were stale).
- **Files changed this session:** docs/api-documentation.md

### Session: July 7, 2026 — Full Documentation Accuracy Sweep + Security & Compliance Audit
- **Headline:** Full documentation accuracy sweep (all findings from dual Claude
  Code audit resolved) followed by a complete security and compliance audit
  pass. Eleven actionable findings fixed across CLAUDE.md, four docs, six API
  routes, three auth pages, and three UI components. No critical issues found.
- **Documentation fixes (Claude Code audit — 10 findings, all resolved):**
  - S-1: SVP "skeleton" label corrected to BIM-SVP-001 v1.1 — COMPLETE
  - M-1: False "never returns 401" claim corrected in both CLAUDE.md and
    docs/api-documentation.md — authenticated callers get 200 (fail-closed),
    unauthenticated get 401
  - C-1: Two conflicting hook re-apply checklists unified into one canonical
    3-item numbered list in both sections, pointing to the SQL file as source
    of record
  - C-2: Rate limit security rule annotated with exception for
    recovery-elevation-status (no limiter by design) and user-email (20/hr
    added July 2026)
  - C-3: 8F section corrected to "5 of 6 routes" in both the session entry and
    the phase checklist section; formatting cleaned up
  - C-4: 8D section no longer mentions Jest/Vitest — correctly describes
    expanding the existing node --test harness
  - C-5: Audit action count updated to "10+" with MFA recovery events noted,
    pending security log split
  - C-6: Stale line-number references removed from the profiles RLS note
  - M-2: Hook lockout guardrail correctly states the hook reads profiles
    only; labs GRANT noted as defensive/unused
  - M-4: ToS/Privacy source correctly described as local machine, not repo
  - S-2: 8G section consistently says v1.1
  - S-3: aal2 cleanup note accurately worded
- **Security and compliance fixes (Fable extended-thinking audit — 7 findings + 3 follow-up):**
  - High — Fixed: Technician registration `profiles.update()` was writing
    `email: em` to a column that no longer exists. Verified in Supabase (6
    columns confirmed, no email). Removed `email: em` — only `role`,
    `lab_id`, `full_name` now written.
  - Medium — Fixed: `returnTo` open redirect — `isSafeReturnTo()` validation
    added to mfa-setup/page.tsx and mfa-challenge/page.tsx;
    `encodeURIComponent()` added in lib/mfa-gate.ts
  - Medium — Fixed: XFF rate-limit key spoofing — all 5 API routes now use
    x-real-ip first, falling back to leftmost XFF value only
  - Medium — Fixed: Audit timestamps rendered in lab timezone
    (Intl.DateTimeFormat with labTimezone) via new
    `formatActivityLogTimestamp()` helper in lib/inventory-utils.ts; group
    headers in activity-log-table.tsx also fixed
  - Medium — Documented: Non-atomic audit writes added to SVP
    known-limitations table as L-009 (Medium risk, accepted, server-side
    co-location planned)
  - Medium — Deferred: super_admin recovery-code redemptions produce no
    audit record (`logMfaRecoveryActivity()` exits early when lab_id is
    null). Requires a non-lab-scoped security_logs table.
  - Low — Fixed: Enroll rate limit reverted from 100/hr to 10/hr; TODO
    comment removed
  - Low — Fixed: `isSafeReturnTo` extracted to lib/safe-redirect.ts (shared
    util, no duplication); backslash variant guard added (/\evil.com)
  - Low — Fixed: Invalid IANA timezone string now guarded with try/catch +
    UTC fallback in formatActivityLogTimestamp() and formatGroupDateHeader
  - Low — Fixed: Two compliance timestamps in validation-tab.tsx
    (submittedAt ~line 496, validationArchivedAt ~line 633) now render in
    lab timezone via formatActivityLogTimestamp()
  - Informational — Deferred: Enroll route still inlines bearer auth instead
    of using shared authenticateBearerRequest() (F-5, carried)
  - M-3 (security — rate limit on PII endpoint):
    super-admin/user-email/route.ts — Upstash 20/hr sliding window added,
    runs before auth, uses the x-real-ip pattern consistent with all other
    routes
- Two full Claude Code re-audits run. Second pass confirmed all 7 primary
  fixes clean. Third pass (follow-up) confirmed all 10 fixes clean with no
  regressions introduced.
- **Files changed this session:** CLAUDE.md, docs/api-documentation.md,
  docs/software-validation-plan.md, app/login/page.tsx,
  app/mfa-setup/page.tsx, app/mfa-challenge/page.tsx, lib/mfa-gate.ts,
  lib/safe-redirect.ts (new), lib/inventory-utils.ts,
  app/api/mfa/enroll/route.ts, app/api/mfa/recovery-codes/redeem/route.ts,
  app/api/mfa/recovery-codes/generate/route.ts,
  app/api/feedback-notify/route.ts,
  app/api/super-admin/user-email/route.ts,
  components/dashboard/activity-log-table.tsx,
  components/dashboard/validation-tab.tsx
- **Parked for future passes (not this session):**
  - security_logs viewer UI — deferred; RLS Option B already supports
    manager/org_admin lab-scoped reads when built
  - ✅ **DONE July 11, 2026:** api-documentation.md cleanup pass (6th route,
    rate-limit ordering, §3b leftovers note → present-tense architecture,
    feedback email, privileged-role security_logs sentence)
  - validation-tab.tsx → wire labSettings as prop from
    app/dashboard/page.tsx instead of internal fetchLabSettings() fetch (low
    priority, not a bug)
  - Enroll route auth consolidation onto authenticateBearerRequest() (F-5)
  - Pre-existing TypeScript errors in
    app/super-admin/orgs/[id]/page.tsx, components/dashboard/header.tsx,
    hooks/use-bell-alerts.ts — not touched, still open

### Session: June 16, 2026 — Doc-Accuracy Corrections: SVP v1.1, Table Count 14→16, RLS Re-verify
- **SVP corrected to v1.1** (`docs/software-validation-plan.md`). Automated-test
  disclosure fixed: the doc had claimed NO automated tests exist — FALSE. A limited
  Node built-in test suite exists (`npm test` → `node --test lib/*.test.ts`), currently
  covering only earliest-expiry logic (`getEarliestExpiry` in `lib/expiry-utils.ts`;
  test file `lib/expiry-utils.test.ts` — renamed from `inventory-utils.test.ts` to
  match what it tests — 6 cases, run via `node --test lib/*.test.ts`). §5.2 and §7
  L-001 reworded: the gap is BREADTH of coverage, not absence; Phase 8D expands the
  existing Node-test harness (do NOT describe 8D as "Jest/Vitest from scratch").
- **Table count corrected 14 → 16** in SVP §6.4 and CLAUDE.md Security Layers. The old
  "14" omitted `mfa_recovery_codes` and `mfa_recovery_elevations`.
- **RLS-on-all-16 RE-VERIFIED in Supabase** (James ran
  `SELECT count(*) FILTER (WHERE rowsecurity), count(*) FROM pg_tables WHERE schemaname='public'`
  → 16/16). "RLS enabled on all 16 tables" is now a verified claim, not an assumption.
- **A separate Claude Code doc audit also flagged `api-documentation.md` issues —
  DEFERRED to a future api-doc cleanup pass (NOT fixed this session):**
  - Undocumented 6th route `app/api/super-admin/user-email/route.ts` (GET, super_admin
    only, returns a user's PII email) — the doc claims it covers "all five routes."
  - Stale §3b "AAL2 leftovers" note: claims two internal strings still carry old
    aal2/hook wording, but commit 3198381 already cleaned both — the code is clean.
  - Rate-limiting runs BEFORE auth in every route, so a 429 can precede a 401 — the
    doc's "401 before rate limiting is applied" claim is backwards.
  - feedback-notify email also includes the submitter's email address (doc omits it).
  - super_admin / org_admin recovery-code redemptions produce no audit
    record — logMfaRecoveryActivity() exits early when lab_id is null.
    Fix requires a non-lab-scoped security_logs table (planned). Deferred
    until security log split is implemented. Flagged by security audit
    July 2026.
  - ✅ **RESOLVED July 11, 2026** (api-doc cleanup pass — see latest session).
    Note on the §3b item: by execution time the "two internal strings still
    carry old wording" claim was already partially stale (strings gone; only
    a changelog-style leftovers note remained). That remaining note was
    converted to present-tense architecture docs. Privileged-role recovery
    audit gap closed earlier via `security_logs` (July 10).

### Session: June 16, 2026 (later) — 8G Software Validation Plan WRITTEN
- **8G COMPLETE — last Phase 8 doc done.** `docs/software-validation-plan.md`
  written in full (BIM-SVP-001 v1.0). Phase 8 documentation set is now closed.
- **profiles RLS = ENABLED — VERIFIED LIVE** via
  `SELECT relname, relrowsecurity FROM pg_class WHERE relname='profiles'` →
  `true` (June 16, 2026). This SETTLES a contradiction: some context notes
  claimed profiles RLS "must remain disabled" — that is STALE/WRONG.
  profiles RLS = ENABLED, verified live June 16 2026 — do NOT disable.
- SVP accuracy pass also tightened two things vs first draft: (1) DB-layer
  isolation uses get_my_lab_id() (JWT only, queries no table); the app helper
  resolveCurrentUserLabId() reads profiles as a secondary layer — RLS is the
  authoritative enforcement. (2) Privileged-route gates are CLIENT-SIDE
  page-level checks (no middleware.ts), not server-side route gating.
- 9.8/10 security score intentionally left out of the SVP.

### STANDING REMINDERS (carried)
- ✅ **DONE — Pushed 4 commits from June 16 8F session** (f7c5b8b, 44b8a8d, 3198381,
  + CLAUDE.md amend 7af0151). `main` is in sync with `origin/main` (verified this session).
- ✅ **DONE — Recovery codes regenerated and re-saved (June 16, 2026).**

### Session: June 16, 2026 — 8F API Docs + JSDoc, Recovery-Elevation Audit, aal2 Dead-Code Cleanup
- **8F (API Documentation) COMPLETE.** `docs/api-documentation.md` covers 5 of 6
  routes (feedback-notify, mfa/enroll, recovery-codes/generate,
  recovery-codes/redeem, recovery-elevation-status); super-admin/user-email
  route deferred — tracked in api-doc cleanup pass; JSDoc added on the three most
  auditor-scrutinized
  functions in `lib/inventory-utils.ts` (`parseSmartBarcode()`, `logActivity()`,
  `resolveCurrentUserLabId()`).
- **Doc-accuracy corrections vs. earlier drafts:** two SEPARATE recovery-codes
  routes (generate + redeem), redeem rate limit is **20/hr** (generate 10/hr);
  generate requires a verified TOTP factor first and returns `{ codes, batchId }`;
  recovery-elevation-status returns `{ elevated: boolean }` — always 200 for an
  authenticated caller (fail-closed to `{ elevated: false }`, no 500); missing or
  invalid bearer token → 401; no `expiresAt` field.
- **`resolveCurrentUserLabId()` JSDoc fix:** the function QUERIES the `profiles`
  table for role + lab_id — it does NOT read `lab_id` from the JWT. JSDoc now states
  that, and points at the JWT-side DB equivalent `get_my_lab_id()` used by RLS.
- **Recovery-elevation audit (read-only) — model confirmed SOUND.** Recovery-code
  login authorizes via a row in `mfa_recovery_elevations` (60-min TTL), live-checked
  by both gates through `/api/mfa/recovery-elevation-status`. The session STAYS at
  aal1 — it never reaches aal2. Native aal2 comes ONLY from genuine TOTP. The
  `custom_access_token_hook` never touches `aal` (sets only lab_id/org_id/user_role).
  No code path depends on the hook setting aal2. The documented gate fail-open
  behavior on AAL-API error is UNCHANGED.
- **aal2 dead-code cleanup in `app/api/mfa/recovery-codes/redeem/route.ts`**
  (cosmetic — zero behavior change, verified: ESLint clean, no new tsc errors):
  renamed helper `grantPendingAal2Elevation` → `grantRecoveryElevation`; rewrote the
  false top-of-file comment (claimed the hook sets `aal=aal2` + client must
  `refreshSession()`) to describe the DB-row model; removed the inert
  `refreshSession: true` field from the success response (no caller ever read it —
  verified across `lib/mfa.ts` + `/mfa-challenge`); fixed the misleading 500 error
  string to `"Recovery elevation could not be recorded (missing session_id)."` Two
  internal strings (one inline comment + the `logMfaRecoveryActivity()` detail text on
  the elevation-failure branch) were initially deferred from this cosmetic pass; they
  were cleaned up in follow-up commit 3198381 (see last bullet).
- **Checklist label correction:** 8C (Traceability Matrix) was actually DONE June 2
  as `docs/traceability-matrix.md` — it was mislabeled "Pending." Marked ✅ this
  session. 8F also flipped to ✅.
- **Follow-up commit 3198381** finished the redeem-route cleanup: corrected the two
  remaining stale strings (the inline comment and the audit-log detail text on the
  elevation-failure branch — both now describe the DB-row model, not a hook dependency),
  and removed two stray untracked scratch files (root `api-documentation.md` duplicate
  and `jsdoc-blocks.md`). The redeem route now contains no incorrect aal2/hook-dependency
  wording; remaining aal2 references correctly explain that the hook cannot set it
  and Supabase overwrites it. Both login
  paths (native TOTP and recovery code) verified working end-to-end in dev after all edits.

### Session: June 13, 2026 — Doc 8H: ToS + Privacy Policy DRAFTED + Pages SHIPPED
- **8H is the last remaining go-live blocker; now content-complete.** Two legal
  docs drafted, two public pages built and verified, content pasted/committed.
- **Five 8H decisions LOCKED:**
  1. **Legal entity:** `Buddy Technologies LLC` — a **Wyoming** LLC. Chosen as
     an UMBRELLA entity (not product-named) so the future predictive-health
     product lives under the same entity with zero new paperwork. Product stays
     "Buddy Inventory Management." Name availability confirmed on WY SoS search.
     NOT YET FORMED — placeholder in docs until James files. Two-line swap if
     the registered name ever differs (it won't).
  2. **Governing law:** Wyoming (follows the entity). WY chosen over DE for
     solo non-resident founder: ~$100 filing + ~$60/yr report, no state income
     tax, owner privacy. DE's prestige only matters with VCs (bootstrapping).
  3. **Legal/privacy contact:** support@yourbuddyapp.com (Cloudflare email
     routing to inbox; same address used throughout both docs).
  4. **Uptime posture:** "commercially reasonable efforts," **explicit NO SLA,
     no service credits**, maintenance-window clause. Solo founder on
     Vercel/Supabase can't control third-party downtime → never promise a number.
  5. **Billing language:** GENERIC ("fees/trial as specified at sign-up or order
     form"). Deliberately NOT hard-coding trial/grace terms so Stripe details can
     firm up without amending + re-accepting the ToS.
- **ToS — three load-bearing clauses (the why, for future edits):**
  - **§4 No PHI:** not a HIPAA Business Associate, will NOT sign a BAA; customer
    indemnifies Buddy (§14) if their users upload PHI. Turns the intentional
    no-PHI architecture into contractual armor.
  - **§6.2 Compliance support ≠ guarantee:** markets 21 CFR Part 11 / ALCOA+
    alignment while making the customer's quality system (not the software)
    responsible for their compliance. Protects against the scariest lawsuit
    class in this market (blaming software for a failed inspection).
  - **§13 Liability cap:** no indirect/consequential damages; total liability
    capped at trailing-12-mo fees (or $100 if pre-revenue). Standard B2B SaaS.
    NOTE: this caps the AMOUNT; the LLC is what protects PERSONAL assets — two
    separate walls, both needed.
  - §5 retention uses "AT LEAST" language to mirror 8B stored-commitment design
    (promise a floor, always exceed it → can't violate own policy).
- **Privacy Policy — architecture translated to disclosure:**
  - Subprocessor table = real stack only: Supabase, Vercel, Resend, Upstash,
    Cloudflare, Google Sheets. Stripe listed as PLANNED, not current.
  - §7 discloses the ALCOA+ name-snapshot design UP FRONT: audit entries keep
    user_name/user_initials even after account deletion, framed as audit-trail
    integrity → pre-empts any "right to deletion" conflict.
  - US data residency, no-PHI, no-sale-of-data all stated. Relocation to Asia
    does NOT change the data-residency story (services stay US-based).
- **Pages shipped (commit 4942a29, container — verified; content commit c7a6a02
  pushed to main):** No `middleware.ts` exists in repo — auth gates are page-level
  client checks (`checkSessionAndRole`, `resolveMfaGateRedirect`), so new
  server-component pages CANNOT interfere with auth (the main risk, resolved by
  architecture).
  - `components/legal-page.tsx` — shared 720px prose layout, title +
    `lastUpdated` prop + legal footer.
  - `app/terms/page.tsx`, `app/privacy/page.tsx` — public server components,
    static prerender (○), no auth wiring. Content between
    `{/* === LEGAL CONTENT START/END === */}` markers.
  - `app/login/page.tsx` — Terms · Privacy footer links added.
  - Verified logged-out: `/terms` + `/privacy` reachable, `/login` footer renders,
    login still works, protected routes still gate. Build passes. Production
    verified at yourbuddyapp.com.
- **Content:** drafted in markdown, converted to hand-built JSX (no new deps;
  subprocessor table is a real `<table className="legal-table">`). Pasted
  marker-to-marker into both pages. `lastUpdated` set to publish date and
  bumped ONLY on real text changes (decided AGAINST auto `new Date()` — an
  always-today date is legally meaningless and looks buggy). Full drafts
  retained on local machine (not committed to repo); live content is in
  app/terms/page.tsx and app/privacy/page.tsx.
- **Watch-items on paste:** if build warns `react/no-unescaped-entities`, add
  `/* eslint-disable react/no-unescaped-entities */` per page (or escape with
  `&apos;`); if subprocessor table looks unstyled, add table CSS to
  `legal-page.tsx`.
- **STILL REQUIRED before first PAYING customer (non-blocking, in-place swaps):**
  1. Lawyer review of both docs (jurisdiction fine print — WY specifics,
     liability cap enforceability, state privacy-law nuance). Text is
     swappable without touching routing.
  2. Form the WY LLC, then confirm registered name matches the placeholder.
  3. Fill real Effective/Last-updated dates at publish.

### Payment / Banking Stack Plan (decided June 13, 2026 — for Phase 6+ billing)
- **Architecture:** WY LLC → EIN → US business bank acct (Mercury or Wise
  Business) → **Stripe US** (subscription billing) → payout to US acct → **Wise**
  for cheap MYR/SGD conversion to James personally.
- **Stripe vs Wise are NOT competitors:** Stripe = how customers PAY (recurring
  card billing, trials, dunning, checkout — maps to Phase 6 billing states).
  Wise = where money LIVES / currency conversion (NOT a billing engine).
  Need BOTH, in sequence. Wise/Mercury replaces the BANK, not Stripe.
- **James HAS an SSN** → easy-mode: instant online EIN, standard Stripe
  verification (no passport/8888 workarounds), normal bank onboarding. SSN is
  PERMANENT — never changes/expires on relocation. Tax STATUS may change on
  relocation (citizen/GC = worldwide income, simpler Schedule C, FEIE available;
  visa-origin SSN non-resident = foreign-owned-LLC filings incl Form 5472 return).
  Confirm with cross-border tax preparer AFTER move (~$300-600/yr), not now.
- **Works identically from Malaysia OR Singapore** — Stripe verifies the ENTITY;
  foreign residential address is allowed. Residence only affects the final
  currency hop + personal tax, not the business machinery.
- **Separate business bank account is MANDATORY** (not James's personal acct):
  commingling funds pierces the LLC veil and destroys the liability protection.
  Personal account untouched; pay self via deliberate owner's-draw transfers.
- **Alternatives considered + rejected:** Merchant-of-Record (Paddle/Polar) —
  ~5%+ and shows a third party as seller, bad for B2B vendor-qualification.
  Local entity (SG Pte Ltd / MY Sdn Bhd) — ~10x cost, no benefit to US lab
  customers. PayPal — weak subscriptions, freeze risk. LLC+Stripe+Wise WINS.
- **Annual obligations to calendar:** WY annual report (~$60); US tax filing
  (Form 5472 + pro-forma 1120 if foreign-owned — $25k penalty if missed).

### Carried Into Next Session — DECIDED, ready to build
- ✅ **SHIPPED July 10, 2026 (Parts A–E):** separate `security_logs` access-control
  trail is live (append-only, service-role writes, production-verified including
  super_admin/org_admin `lab_id = NULL` rows).
- **Security-log sub-scope:**
  - ✅ **SHIPPED July 15, 2026:** MFA enroll/replace events
    (`mfa_factor_enrolled` / `mfa_factor_replaced` via `/api/mfa/enroll-complete`)
  - ✅ **SHIPPED July 15, 2026:** role-change events
    (`role_changed` via `/api/users/set-role` + `set_user_role` RPC;
    profiles.role client-immutable via table-revoke + column re-grant)
  - ✅ **SHIPPED July 14, 2026:** deactivate/reactivate events
    (`user_deactivated` / `user_reactivated`, written by
    `/api/users/set-active` on success only)
  - **Still deferred:** security-log VIEWER UI (Batch 2 Phase 2). Discovery
    done July 15 — org_admin needs an org-scoped SELECT branch before that
    surface works; managers + super_admin read fine under existing RLS.
- **TWO separate logs, split by event TYPE (not by actor).** James decided:
  - `activity_logs` (existing) = DATA-INTEGRITY / ALCOA+ trail ONLY. Lab "stuff":
    lot validations, inventory changes, COA actions. Stays clean/focused so an
    FDA inspector reviewing data integrity isn't wading through auth noise. Do
    NOT dilute this table with security events — that preserves the ALCOA+
    guarantee.
  - NEW security/account log = ACCESS-CONTROL trail. "User stuff, not lab stuff":
    2FA enable/replace, recovery code redeem (success + FAILED — screenshot
    evidence this session: 3 failed redeems @10:58 + 1 success @10:54), user
    deactivate/reactivate, role changes, logins. Currently these auth events
    appear in the activity feed; they move to the dedicated log.
  - **Build the new log with the SAME discipline as activity_logs:** append-only,
    immutable, snapshot attribution (user_name + user_initials, NO user_id FK) so
    a future hard-delete can never orphan it. New table (e.g. `security_logs` /
    `account_activity`). Mirror existing pattern for consistency.
- **User lifecycle = DEACTIVATION, not deletion (DECIDED).** Build deactivation
  FIRST; it covers ~90% of the real need (revoke access), is reversible, and
  sidesteps the FK-cascade minefield entirely (row persists → the NO ACTION FK
  constraint on feedback/lab_invites/organizations.created_by becomes irrelevant).
  Design points for next session (NOT yet decided):
  - "Deactivated" = status flag on profile; auth gates (`checkSessionAndRole` /
    `resolveMfaGateRedirect`) must fail a deactivated user → can't log in.
  - Deactivation is itself a SECURITY-LOG event (who deactivated whom, when).
  - **Orphaning rule:** a privileged user (esp. the LAST active org_admin of a
    lab) must NOT be able to self-deactivate/self-remove — would leave a tenant
    with data and no admin. Self-removal for privileged roles needs another
    equal/higher admin to exist, or routes as a request, not an instant action.
  - HARD deletion + full TENANT OFFBOARDING are SEPARATE, LATER features that
    must honor ToS §3.3 (30-day export window) + §5.3 (post-termination
    retention; audit log NOT necessarily wiped — immutability + retention
    minimums apply). These are workflows, not buttons. Defer.
    Offboarding test plan must include a live (non-rollback) SET NULL
    survival test: throwaway lab + user, one login, wipe, confirm the
    security row survives with lab_id nulled.
- ✅ **DEPRECATED July 15, 2026:** `database-scripts/supabase-copy.sql` marked
  HISTORICAL ONLY (header note) — drifted from production; production DB is
  authoritative. Regeneration deferred indefinitely.
- ✅ **Verified July 10, 2026:** recovery-code REDEEM route is rate-limited
  (Upstash, 20/hr sliding window), confirmed in the July 10 audit.

### Session: June 10, 2026 — Super_Admin + Org_Admin Mandatory 2FA ENFORCED
- **Super_admin mandatory 2FA gate COMPLETE and verified in production.**
  James enrolled app-level TOTP, saved recovery codes, verified the
  recovery-code login path end-to-end, THEN enforcement was turned on.
  Never enforce before proving the recovery path works.
- **Discovered + closed prerequisite gap:** super_admin had NO access to
  Profile Settings at all (dialog only mounted on /dashboard, which
  super_admin is blocked from; old Security tab showed "managed via
  Supabase dashboard" note). Mounted ProfileSettingsDialog on /super-admin
  (gear button in header), replaced the note with real controls:
  not enrolled → Enable 2FA; enrolled → Regenerate; NO Disable for
  super_admin (mandatory role, same as managers).
- **Gate architecture:** /super-admin and /org-admin do NOT pass through
  the dashboard's checkSessionAndRole — they have their own auth gates.
  Created shared helper `lib/mfa-gate.ts`:
  `resolveMfaGateRedirect(returnTo)` mirrors dashboard gate steps 2–3:
  not enrolled → `/mfa-setup?returnTo=X`; aal2 → pass; aal1 with valid
  recovery elevation (live DB check) → pass; else `/mfa-challenge?returnTo=X`.
  Wired into all three /super-admin pages (main, labs/[id], orgs/[id])
  AFTER role check, BEFORE `setAuthorized(true)`. Error semantics copied
  from dashboard gate (AAL-check error = fail-open — known, consistent;
  if ever hardened, change BOTH gates together).
- **Discovered + closed SECOND gap (Cursor report):** /org-admin performed
  NO AAL/2FA checks of its own — org_admin 2FA was only enforced by the
  /dashboard gate, so org_admins landing directly on /org-admin were never
  challenged despite "mandatory" policy. Wired the shared helper into
  /org-admin's gate with `returnTo=/org-admin`. Verified with test org_admin.
- **returnTo plumbing:** /mfa-setup honors returnTo on ALL exit paths via
  centralized `postSetupRedirect()` (already-enrolled guard, codes-gen
  failure, codes Continue). /mfa-challenge honors `?returnTo=`, else decodes
  user_role from JWT: super_admin → /super-admin, else /dashboard.
  ProfileSettingsDialog takes `mfaReturnTo` prop (defaults: /super-admin for
  super_admin, else /dashboard); /org-admin mount passes /org-admin.
- **Profile Settings UX:** enrolled-state 2FA section restructured into two
  distinct cards (`grid-cols-1 sm:grid-cols-2`): LEFT "Recovery Codes"
  (neutral) with Generate New Recovery Codes; RIGHT "Replace Authenticator"
  (amber warning) with Regenerate 2FA. Rationale: the two actions have very
  different blast radius (reissue codes vs destroy verified factor) and
  were misclick-prone stacked together. Technician enrolled state unchanged
  (standalone codes card + disable flow). Dialog widened 560px → 760px.
  ProfileSettingsDialog now mounted on /org-admin too (gear in header).
- **Recovery elevation verified live in prod DB:** redeem writes
  mfa_recovery_elevations row, expires_at = created_at + 60min exactly,
  still_valid flips false after expiry; expired rows linger as inert rows
  (gate checks expires_at live — TTL honored by live check, not deletion).
  60 min = lifetime of the ELEVATION (session trust), not the codes; codes
  never expire, single-use. Recovery login = 60-min emergency window —
  intended use is to fix 2FA (Replace Authenticator) within it.
- **ALCOA+ finding (good news):** activity_logs has NO user_id column at
  all — attribution is stored as user_name + user_initials TEXT SNAPSHOTS.
  User deletion physically cannot affect audit attribution. Verified via
  full FK map: nothing compliance-relevant cascades from auth.users
  (profiles/mfa_factors/recovery_codes/elevations/active_sessions CASCADE =
  correct; labs.owner_id SET NULL; feedback/lab_invites/organizations
  created_by = NO ACTION → must pre-clear referencing rows or user delete
  is BLOCKED with FK violation).
- **Test data cleanup:** 3 test users deleted (TestLab manager, TestLab1234
  manager, JamesonL org_admin) after pre-clearing feedback/lab_invites
  references. Remaining users: James (super_admin) + Oakwood's two.
  Test tenants (TestLab, TestLab123, TestOrg, TestLabinOrg) were ARCHIVED
  here; **wiped July 10, 2026** (see latest session — four UUIDs deleted,
  Oakwood only lab left, organizations empty). Real-customer offboarding
  remains a separate future workflow per ToS §3.3 / §5.3.
- **Recovery codes regenerated** post-testing (gate tests burned several) —
  fresh batch of 10 saved, old sheet discarded. Old downloaded sheets
  become PARTIALLY DEAD after any code use — always regenerate + re-save
  after burning codes in tests.
- Stray console.log removed from /super-admin auth gate (8I item).

### Session: June 7, 2026 — Recovery Codes SHIPPED + Hook Lockout Recovery
- Recovery codes COMPLETE and verified in production (commit 8f13692).
  Generation (enrollment + Security-tab regen), redeem at /mfa-challenge,
  session elevation gate, audit logging. bcryptjs, 10 codes/batch, XXXX-XXXX.
- **Supabase RESERVES the `aal` claim — the access token hook CANNOT set
  aal2.** Confirmed empirically: hook stamped lab_id/user_role fine but aal
  stayed aal1. Custom recovery codes cannot produce native aal2.
- **Working recovery architecture (DB-row gate, NOT aal):**
  1. Service-role redeem route bcrypt-verifies code, marks used, writes a
     TTL'd row to mfa_recovery_elevations (session_id, expires_at = now+60min).
  2. Dashboard gate (checkSessionAndRole): if aal1, calls
     checkRecoveryElevation() → GET /api/mfa/recovery-elevation-status
     (service-role checks valid unexpired row for this session). Passes gate
     if elevated. Checked LIVE so the TTL is honored.
  3. Hook does NOT touch aal or the elevation table.
     redeemMfaRecoveryCode() no longer calls refreshSession/getAssuranceLevel.
  - Chosen over a JWT elevation claim: a token claim can't be revoked
    mid-life and ignores expires_at; live DB check honors the TTL and keeps
    the fragile hook minimal. No RLS policy checks aal2 (verified) — data
    security is lab_id/user_role + RLS, both correct on recovery login.
  - **June 16, 2026 audit confirmed this is the LIVE model** (session stays aal1;
    hook never sets aal2). The stale "aal2-via-hook" leftovers in the redeem route
    were cleaned up that session — see the June 16 session entry at the top.
- **HOOK LOCKOUT root cause + permanent guardrail:** hook runs as
  supabase_auth_admin (rolbypassrls = FALSE). It reads only profiles (the
  GRANT SELECT on labs is applied defensively but the current hook body does
  not query labs). It needs BOTH (a) GRANT SELECT on every table it reads,
  AND (b) an RLS policy
  permitting supabase_auth_admin (existing "Allow auth admin to read
  profiles" USING true). Missing GRANT → "permission denied" → TOTAL
  LOCKOUT. Missing/blocking policy → reads return EMPTY (no error) → corrupt
  claims (lab_id null, role defaults 'technician') → get_my_lab_id() null →
  labs 406 → onboarding bounce. Silent and nasty: login "works" but mints
  broken tokens. Grant + policy ANY new table the hook touches.
- **STALE TOKEN lesson:** after ANY hook change, only a FULLY re-minted
  token reflects it. Cached/localStorage sessions carry old claims =
  phantom bugs. Real test = full sign-out / clear localStorage → fresh
  login → decode token. Burned ~1hr on a stale token this session.
- Auth localStorage key is `buddylab-auth` (custom storageKey, NOT default
  sb-<ref>-auth-token).
- Also fixed: lab_settings column require_coa_approval (no 's') in
  app/welcome/page.tsx (committed separately earlier).
- Full live hook SQL saved to docs/custom-access-token-hook.sql.

### Session: June 2, 2026 (evening) — Break-Glass Runbook + Traceability Matrix
- Created docs/break-glass-runbook.md (4 scenarios: super_admin lockout,
  broken JWT hook, manual profile fix, stuck MFA factor delete)
- Validated runbook diagnostics against live DB: auth.mfa_factors columns
  confirmed; supabase_auth_admin confirmed to have EXECUTE on
  custom_access_token_hook (healthy baseline)
- Corrected Scenario 2 diagnostics (pg_get_functiondef alias for SQL editor
  LIMIT; has_schema_privilege instead of misleading usage_privileges view)
- Created docs/traceability-matrix.md (8C) — REQ-001–REQ-010 mapped to real
  code locations and verification status (all manual; 8D coverage map included)
- Created docs/software-validation-plan.md (8G) — skeleton outline only,
  not yet written
- CONFIRMED: super_admin (James) currently has ZERO app-level MFA factors —
  this is the exact gap the weekend recovery-codes + super_admin TOTP
  enforcement work will close
- Next: recovery codes system (weekend heavy build)

### Session: June 2, 2026 — Phase 8E Closeout + Snyk Triage
- Supabase unpaused after 3-week dormancy, JWT confirmed healthy
- Snyk triaged: resend bumped to 6.12.3 (uuid CVE patched), 3 others
  accepted with documented rationale in npm-audit-exceptions.md
- CLAUDE.md updated: Standard New Table SQL Template + GRANT requirement
  Security Rules bullets
- All Phase 8E work complete and pushed
- Next session priority: Recovery codes system (week 1 lock-in begins)

---

## Who I Am

You are a senior full-stack developer and mentor helping James build
Buddy Inventory Management — a B2B SaaS lab inventory management system.
James has an intermediate Python background but is actively growing his
JavaScript, TypeScript, SQL, and web dev skills. Always explain your
reasoning, not just the solution. Help him understand the "why" behind
every decision, especially around multi-tenancy, auth, and database design.

---

## The Product

Buddy Inventory Management is a lab inventory management tool for cell
therapy and research labs. Part of a broader Buddy brand that will
expand into more products — keep components modular and reusable.

- **Target market:** Small US-based cell therapy and research labs
- **Positioning:** Between enterprise tools (Benchling, LabArchives) and
  lightweight free options (Quartzy)
- **Pricing:** Per-lab flat-rate subscription (not per-seat)
- **Compliance:** Healthcare-adjacent. No PHI stored (intentional).
  Must be audit-ready for 21 CFR Part 11 + ALCOA+.

---

## Tech Stack

- **Framework:** Next.js 16
- **Styling:** Tailwind v4
- **Database & Auth:** Supabase (US region)
- **UI Generation:** v0
- **Editor:** Cursor with Claude Code
- **Deployment:** Vercel (yourbuddyapp.com)
- **Email:** Resend (noreply@yourbuddyapp.com — verified ✅)
- **Domain:** yourbuddyapp.com (Cloudflare DNS, Resend verified)
- **Rate Limiting:** Upstash Redis (US-East-1)
- **Feedback Logging:** Google Sheets via service account

---

## Development Status (Summary)

### Phases 1–5: Complete ✅
Multi-tenant foundation, COA & lot validation workflow, audit trail,
mobile responsiveness, JWT custom claims hook, RLS on all tables,
Vercel security headers, Upstash rate limiting, 2FA on admin accounts,
feedback API + Google Sheets, idle auto-logout, branded email templates,
camera barcode scanning. Production deployment live.

### Phase 6: Organization Layer ✅ (mostly)
Organizations table + org_admin role + org-level invites.
JWT injects org_id alongside lab_id and user_role.
/super-admin and /org-admin dashboards built (provisioning, invites,
role management, billing overview).
Post–July 10 tenant wipe: production has zero organizations; Oakwood is
standalone (org_id NULL). Org layer code remains but is not exercised in prod
until the next org customer is provisioned.
- [ ] Stripe + billing (org-level, 3-month trial, 7-day grace)
- [ ] Marketing website (yourbuddyapp.com)

**Payment / Banking Stack (decided June 13, 2026):**
WY LLC (Buddy Technologies LLC) → EIN → US business bank (Mercury or Wise
Business) → Stripe US subscriptions → payout to US acct → Wise for MYR/SGD
personal conversion. Stripe = billing engine; Wise/Mercury = bank layer — not
competitors. Separate business account mandatory (veil protection). James has
SSN → standard EIN + Stripe onboarding. Works from MY or SG; entity verified,
not residential address. Rejected: MoR (Paddle/Polar), local SG/MY entity,
PayPal. Calendar: WY annual report ~$60/yr; Form 5472 if foreign-owned LLC.
ToS billing language kept generic until Stripe terms firm up (see 8H session).

### Phase 7: Security & UX Hardening ✅
Editable tech key, one active session per user (active_sessions table
+ 30s poll), password strength enforcement, password reset via email,
forgot password on login page, branded SMTP via Resend with verified
domain, dashboard overview cards redesign, multi-badge inventory rows,
header bell notifications (5 categories with role gating), super admin
full feature set (lab/org detail pages, billing, role editing, tech
key reset, invite revoke, trial extend), profiles.created_at backfill,
production test data wiped, single-lab billing tab, idle timeout
adjusted to 10 min (8 min idle + 2 min warning),
two-factor authentication (TOTP) for managers + org admins via Supabase MFA,
optional for technicians, AAL2-gated dashboard access, server-side
enrollment endpoint handles ghost factor cleanup atomically.

### Phase 8: Compliance Readiness (Target: End of June)
Goal: audit-ready for regulated US lab customers before first 10 onboard.
Based on 21 CFR Part 11, ALCOA+, and SDLC validation standards.

#### 8A — Audit Log Immutability ✅
- Append-only RLS policies on activity_logs (NO UPDATE, NO DELETE policies)
- SELECT: lab members scoped to lab_id, super admin sees all
- INSERT: WITH CHECK (lab_id = get_my_lab_id()) — cannot forge cross-lab logs
- JWT-based (auth.jwt() ->> 'user_role') — no profiles subquery
- Satisfies 21 CFR Part 11 §11.10(e) + ALCOA+ "Original"

#### 8B — Audit Log Retention Policy ✅
- audit_log_retention_years column on lab_settings (default 3, CHECK 1-10)
- Read-only Data Retention card on customer Lab Settings tab
- Editable by super admin in /super-admin/labs/[id] Overview tab
- Range validated 1-10 years client-side AND database-side
- Onboarding Step 3 shows informational notice ("3 years default,
  contact support for extended retention")

**IMPORTANT — Retention behavior today:**
The audit_log_retention_years value is a **stored COMMITMENT**, not an
automated deletion schedule. No cron job currently deletes audit_logs
rows. Records are kept INDEFINITELY. Compliance-safe: keeping records
LONGER than promised is always acceptable; under-retaining is not.

Customer-facing answer: "We commit to retaining your audit logs for
at least X years (your configured value). Currently we don't delete
any audit records — they are preserved indefinitely."

- [x] Document retention commitment in ToS / Privacy Policy (Phase 8H — §5 "at least" language)
- [ ] Future: Automated retention cleanup job (NOT URGENT — storage cheap)
      Test extensively before enabling — deletion is irreversible.

#### 8C — Traceability Matrix ✅
Done June 2, 2026 as `docs/traceability-matrix.md` (REQ-001–REQ-010 mapped to code
locations + verification status). Convert to a Google Sheet only when a customer or
auditor actually needs the spreadsheet form — the markdown is the source of record.

Original plan: Create Google Sheet "Buddy Traceability Matrix" with columns:
Requirement | Feature | Code Location | How Verified | Status

Seed requirements:
- REQ-001: Lot tracking scoped to lab (RLS + lab_id)
- REQ-002: COA must precede lot validation (state machine order)
- REQ-003: Unapproved lots blocked from bench (allowlist check)
- REQ-004: All validation actions logged with user + timestamp
- REQ-005: Duplicate lots prevented (unique constraint)
- REQ-006: FEFO soft warning on lot open
- REQ-007: Role-based access (manager vs technician gates)
- REQ-008: One active session per user
- REQ-009: Audit log immutable (append-only RLS)
- REQ-010: COA documents retained 3 years

#### 8D — Automated Testing (High Priority — Pending)
- Expand the existing Node built-in test harness (`node --test`) beyond expiry
  logic — do NOT describe this as setting up Jest/Vitest from scratch; the
  harness already exists (`npm test` → `node --test lib/*.test.ts`)
- Integration tests for validation state machine (all 8 transitions)
- Integration tests for RLS scoping (cross-lab isolation, role gates)
- Unit tests for parseSmartBarcode() edge cases
- Unit tests for threshold fallback logic (item → lab default)
- GitHub Actions CI on push to main

#### 8E — Security Scanning ✅
- Dependabot enabled (alerts + security updates + version updates)
- `.github/dependabot.yml` configured:
  - Weekly schedule, groups minor/patch updates into single PR
  - Ignores major version bumps (manual review only)
  - Ignores `@zxing/*` packages (frozen pending Dynamsoft migration)
- Snyk connected via GitHub integration — auto-PRs for fixable CVEs
- `npm-audit-exceptions.md` documents accepted risks with rationale:
  - glob (High) via eslint-config-next — dev-only, CLI flag not reachable
    at runtime
  - postcss (Moderate) bundled inside Next.js internals — build-time only,
    no user CSS input accepted
- Patched during setup:
  - Next.js DoS (GHSA-q4gf-8mx6-v5v3) → bumped to 16.2.6
  - minimatch ReDoS (GHSA-3ppc-4f35-3m26)
  - Top-level postcss XSS (GHSA-qx2v-qp2m-jg93)
- Dependabot major-version PRs require manual review before merge
  (lucide-react v1, typescript 6, hookform-resolvers 5 closed pending
  deliberate testing)

#### 8F — API Documentation ✅
Done June 16, 2026; cleanup pass July 11, 2026; users/set-active added July 14, 2026; security-log documented July 15, 2026; enroll-complete + set-role added July 15, 2026 (Batch 2).
- `docs/api-documentation.md` documents **10** API routes
  (feedback-notify, mfa/enroll, mfa/enroll-complete, recovery-codes/generate,
  recovery-codes/redeem, recovery-elevation-status, super-admin/user-email,
  users/set-active, users/set-role, security-log):
  purpose, caller, auth, rate limit, request/response.
- JSDoc added on the three most auditor-scrutinized functions in
  `lib/inventory-utils.ts`: parseSmartBarcode(), logActivity(),
  resolveCurrentUserLabId(). The resolveCurrentUserLabId() block was corrected to
  state it queries `profiles` (not the JWT) and cross-references get_my_lab_id().
- Doc reflects the DB-row recovery elevation model and `security_logs` writes
  for redeem (including super_admin/org_admin with `lab_id = NULL`).
  Note: enroll-complete + set-role docs may still need a doc pass if not yet
  folded into api-documentation.md (code + security_logs writes are live).

#### 8G — Software Validation Plan ✅
Done June 16, 2026. `docs/software-validation-plan.md` (BIM-SVP-001 v1.2) —
full document, not a skeleton. Covers: intended use, regulatory classification
(NOT a medical device; supports customer Part 11 compliance but is not itself
FDA-regulated), SDLC (iterative phase-based, solo founder, Cursor + GitHub +
Vercel CI/CD), validation strategy (risk-tiered manual testing; 8D automation
deferred and disclosed as known limitation L-001), 8 known limitations table,
change control process, and a compliance-implementation section (Part 11,
ALCOA+, RLS isolation, auth/session security).
- Accuracy pass corrected an early-draft error: it claimed profiles RLS was
  "disabled." VERIFIED FALSE — profiles RLS is ENABLED (see Security note below).
- Self-assessed 9.8/10 security score deliberately OMITTED from the SVP (a
  self-assigned number has no place in a formal validation doc an auditor reads).
- Doc is the Git master; a dated/signed PDF is exported on demand for QA
  reviews or audits (controlled-document fields already seeded in §9).
- ✅ **July 11, 2026:** Author field + revision table filled (James Cheong;
  v1.0 / v1.1 rows). Version not bumped — controlled-document fields only.
- ✅ **July 13, 2026:** Bumped to v1.2 — table count 16→17 (`security_logs`).

#### 8H — Terms of Service & Privacy Policy ✅ (draft + pages shipped)
- **Entity:** Buddy Technologies LLC (Wyoming) — umbrella LLC, NOT YET FORMED
- **Published at:** `/terms` and `/privacy` (static, no auth); login footer links
- **Source drafts:** Full drafts retained on local machine (not committed to repo);
  live content is in `app/terms/page.tsx` and `app/privacy/page.tsx`
- **Live JSX:** `app/terms/page.tsx`, `app/privacy/page.tsx` (marker blocks)
- **Layout:** `components/legal-page.tsx` — 720px prose, manual `lastUpdated`
- **ToS highlights:** no PHI / no BAA (§4); compliance support ≠ guarantee (§6.2);
  liability cap trailing-12-mo fees (§13); retention "at least" (§5, mirrors 8B);
  no SLA; generic billing language; WY governing law
- **Privacy highlights:** subprocessor table (Supabase, Vercel, Resend, Upstash,
  Cloudflare, Google Sheets; Stripe planned); ALCOA+ name-snapshot disclosure (§7);
  US residency; no PHI; no sale of data
- **Contact:** support@yourbuddyapp.com throughout
- [ ] Lawyer review before first paying customer (in-place text swap, no routing change)
- [ ] Form WY LLC + confirm registered name matches docs
- [ ] Set real Effective/Last-updated dates at publish

#### 8I — Pre-Customer Checklist ✅
- Full checklist authored: docs/pre-customer-checklist.md
- 8 sections (test data hygiene, audit integrity, RLS, build, env,
  auth/2FA, email/domain, customer-facing surfaces) + final sign-off
- Each section phase-tagged to source work (8A/8B/8E/8F/8H/8J etc.)
- Doubles as a go-live readiness gate, not just cleanup
- Oakwood = synthetic-data demo lab, kept for demo continuity
  (deletable any time; excluded from wipe steps by default)
- Verification steps run against PRODUCTION, not localhost
- ✅ **July 10, 2026:** four archived test tenants wiped in production
  (TestLab, TestLab123, TestLabinOrg, TestOrg — UUIDs in latest session).
  Oakwood is the only remaining lab; tenant-wipe method documented there for
  future real-customer offboarding (ToS §3.3/§5.3).

#### 8J — Two-Factor Authentication ✅
- TOTP via Supabase MFA (max 1 factor per user)
- Mandatory for super_admin, managers, and org admins; optional for technicians
- Server-side enrollment endpoint (`/api/mfa/enroll`) handles ghost factor
  cleanup atomically using admin API
- AAL2-gated access for privileged roles: dashboard gate (manager/org_admin),
  `lib/mfa-gate.ts` on /super-admin (×3 pages) and /org-admin
- Recovery codes + DB-row elevation gate (60-min TTL, live check)
- Onboarding Step 4 embeds enrollment for new managers
- `/mfa-setup`, `/mfa-challenge`, dashboard gate, login flow all wired
- React Strict Mode double-mount guarded via `useRef` lock
- Profile Settings → Security tab on /dashboard, /super-admin, /org-admin
  (two-card enrolled layout; enable/disable for technicians; regenerate for
  privileged roles; no disable for super_admin/manager/org_admin)

### Future — Post 10 Customers
- Open self-serve lab registration (drop invite-only model)
- Dynamsoft Barcode Reader migration (replaces ZXing)
- Failed login attempt monitoring (Sentry or Datadog)
- Formal penetration testing
- SOC 2 Type I assessment (for enterprise lab contracts)

---

## Customer Types

Two types coexist in the same database:

**Single Lab** — `org_id = NULL`
```
super_admin → Lab → Manager + Technicians
```

**Organization** — `org_id = <uuid>`
```
super_admin → Organization → Org Admin
                          → Lab A → Manager + Technicians
                          → Lab B → Manager + Technicians
```

Single-lab customers are unaffected by the org layer.

### Role Matrix
| Role | lab_id | org_id | Can access |
|------|--------|--------|-----------|
| super_admin | NULL | NULL | /super-admin only |
| org_admin | NULL | uuid | /org-admin only |
| manager | uuid | nullable | /dashboard |
| technician | uuid | nullable | /dashboard |

### Org Admin Capabilities
Can: see labs/members, generate manager invites (per lab), revoke
invites, promote/demote within their org's labs.
Cannot: remove members, create labs, access inventory data, configure
lab settings.

### Provisioning
- **Single lab:** Create lab → send manager invite → manager signs up
- **Organization:** Create org + labs → send org admin invite → org
  admin signs up → org admin generates manager invites per lab

---

## Multi-Tenancy Architecture

Every query and insert MUST be scoped to the user's `lab_id`. RLS is
the enforcement layer — never rely on app-level filtering alone.

When helping with any database operation, always:
1. Confirm `lab_id` is being passed on inserts
2. Confirm RLS policies are in place
3. Flag any query that could return cross-tenant data

### Key Technical Rules (Never Break)
- Always scope queries to `lab_id` via `resolveCurrentUserLabId()`
- Super admin: `lab_id = NULL` AND `org_id = NULL`
- Org admin: `lab_id = NULL` AND `org_id = <uuid>`
- Bootstrap upsert fallback must NOT be re-added
- `owner_id` on labs set via DB trigger `on_manager_profile_created`
- Invite marked as used BEFORE `signUp()` runs
- RLS enabled on ALL tables — never disable it
- get_my_lab_id() and get_my_org_id() read from JWT only — never query profiles
- Super admin checks use `auth.jwt() ->> 'user_role'` — never a profiles subquery
- Labs RLS policies must never query profiles — JWT claims only
- Billing ownership is resolved ONLY by `resolveBillingOwner()`. Never derive
  it inline from role or `lab_id` in a route or component.
- Org membership for billing must be read from `labs.org_id`.
  `profiles.org_id` and the JWT `org_id` claim are routinely NULL for
  org-lab staff and cannot stand in.
- Stripe route / resolver role reads: application code (checkout/portal
  gates and `resolveBillingOwner`) reads role from `profiles.role` via the
  admin client — single source of truth; a role change takes effect in the
  app immediately. RLS policies read role from `auth.jwt() ->> 'user_role'`,
  so the database keeps applying the OLD role until the user's token
  refreshes. Consequence: after a role change the app sees it instantly,
  RLS does not. This fails safe in both directions (demoted user stopped by
  the app; promoted user stopped by RLS) but is a layer divergence, not a
  designed cross-check — do not treat it as a security control.
  (An earlier note claiming a deliberate JWT-vs-DB cross-check inside the
  app layer was recorded in error on 2026-07-31 and corrected the same day.)
- Table-level grants and RLS policies are two independent locks. A table can
  be safe purely because no policy exists while grants sit wide open. Audit
  both together.

### JWT Claims Architecture
Every JWT contains 3 custom claims injected at login by
`custom_access_token_hook` (Postgres function):
- `lab_id` — null for super_admin and org_admin
- `org_id` — null for super_admin and single-lab users
- `user_role` — 'manager' | 'technician' | 'org_admin' | 'super_admin'

Helpers:
- `get_my_lab_id()` → `SELECT NULLIF(auth.jwt() ->> 'lab_id', '')::uuid`
- `get_my_org_id()` → `SELECT NULLIF(auth.jwt() ->> 'org_id', '')::uuid`
- `get_my_lab_org_id()` → reads `labs.org_id` for the JWT `lab_id` claim
  (STABLE SECURITY DEFINER, empty `search_path`; used by
  `billing_accounts_select_scoped` so org-lab staff can see the org billing
  row). Do not replace with a call to `get_my_lab_id()` inside it —
  `get_my_lab_id()` has no `search_path` of its own.

If a user's role/lab changes, they must log out and back in for new
JWT claims to take effect.

**When recreating custom_access_token_hook with CREATE OR REPLACE:**
After any CREATE OR REPLACE, re-apply all three grants (stripped on replace):
1. GRANT EXECUTE on the function to supabase_auth_admin
2. GRANT SELECT ON profiles to supabase_auth_admin
3. GRANT SELECT ON labs to supabase_auth_admin
Source of record: docs/custom-access-token-hook.sql

---

## Security Architecture

### Current Security Score: 9.8/10
Production-grade for healthcare-adjacent B2B SaaS with no PHI. Audit log
immutability satisfies 21 CFR Part 11. App-level 2FA on privileged
accounts. Automated dependency scanning via Dependabot + Snyk with
documented accepted risks. Remaining 0.2/10 gap requires enterprise
tooling (formal pen testing, SOC 2).

### Verified Facts
- profiles RLS: ENABLED (verified June 16, 2026; re-verified 2026-07-31,
  pg_class.relrowsecurity = true). Public-schema tables: 17 total (16 verified
  June 16, 2026 in Supabase; `security_logs` added with RLS July 10, 2026),
  RLS enabled on all. Never disable. Supersedes any note claiming it should
  be disabled.
- Expiry columns are `date`, not `timestamptz` (`active_lots`, `coa_records`,
  `inventory_lots`, `requests` expiry fields) — no timezone shift on expiry
  dates. Closed 2026-07-31; do not reinvestigate. (Among related billing/MFA
  columns, `billing_accounts.updated_at` and
  `mfa_recovery_elevations.expires_at` are `timestamptz`.)

### Security Layers
| Layer | Implementation |
|-------|---------------|
| Passwords | Supabase Auth bcrypt, min 8 chars, mixed case + digits + symbols |
| Password reset | Email-based flow via /reset-password |
| Session enforcement | One active session per user (30s poll) |
| Database isolation | RLS on all 17 tables (activity_logs append-only) |
| Data scoping | JWT-based get_my_lab_id() + get_my_org_id() |
| Profile security | RLS enabled, email column removed |
| Transport | HTTPS via HSTS |
| Browser attacks | 6 security headers via vercel.json |
| API abuse | Upstash rate limiting (per-route limits; see Security Rules section) |
| Preview URLs | Vercel Authentication enabled |
| Account security | 2FA on Supabase + Vercel admin accounts |
| Webhook | x-webhook-secret header validation |
| Email | Custom SMTP via Resend (noreply@yourbuddyapp.com verified) |
| Security alerts | Password/email change + MFA add/remove notifications |
| Audit log immutability | activity_logs append-only — 21 CFR Part 11 compliant |

### Two-Factor Authentication (2FA / TOTP)

- **Library:** Supabase MFA (built-in TOTP)
- **Max factors per user:** 1 (enforced in Supabase dashboard)
- **Friendly name:** `Buddy Inventory Management`
- **Standard:** RFC 6238 TOTP (works with Google Authenticator, Authy, 1Password, etc.)

#### Role-tiered enforcement
| Role | 2FA | Enforcement |
|------|-----|-------------|
| super_admin | ✅ Mandatory (app-level TOTP) | `/super-admin` gate (`resolveMfaGateRedirect("/super-admin")`) |
| org_admin | ✅ Mandatory | `/dashboard` gate AND `/org-admin` gate (`resolveMfaGateRedirect("/org-admin")`) |
| manager | ✅ Mandatory | Login + dashboard gate |
| technician | ⚪ Optional | Voluntary via Profile Settings |

#### AAL (Authenticator Assurance Level) model
- `aal1` = password verified only
- `aal2` = password + TOTP verified this session
- Privileged roles must reach `aal2` (or hold valid recovery elevation) to
  access their routes: managers/org_admins → `/dashboard`; org_admins also
  → `/org-admin`; super_admin → `/super-admin`
- AAL is encoded in the JWT and read via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`

#### Gate order (NEVER REORDER)
On every dashboard load, in `checkSessionAndRole`:
1. **First:** if role is `manager` and `onboarding_complete = false` → `/welcome`
2. **Second:** if role is `manager`/`org_admin` AND not enrolled in 2FA → `/mfa-setup`
3. **Third:** if role is `manager`/`org_admin` AND enrolled AND AAL is `aal1` → `/mfa-challenge`
4. **Otherwise:** proceed to dashboard

Onboarding MUST run first because `/welcome` Step 4 handles 2FA enrollment internally.

#### Privileged-route MFA gate (`lib/mfa-gate.ts`)
`/super-admin` and `/org-admin` have their own auth gates — they do NOT pass
through `checkSessionAndRole`. Shared helper `resolveMfaGateRedirect(returnTo)`
mirrors dashboard gate steps 2–3:
1. Not enrolled → `/mfa-setup?returnTo=${returnTo}`
2. `aal2` → pass (`null`)
3. `aal1` + valid recovery elevation (live DB check via
   `checkRecoveryElevation()`) → pass
4. Otherwise → `/mfa-challenge?returnTo=${returnTo}`

Wired AFTER role confirmation, BEFORE `setAuthorized(true)` on:
`/super-admin`, `/super-admin/labs/[id]`, `/super-admin/orgs/[id]`, `/org-admin`.
Error semantics match dashboard gate (AAL API error = fail-open; if hardened,
change both gates together).

#### Server-side enrollment endpoint (`/api/mfa/enroll`)
Enrollment runs server-side, NOT directly via the client SDK, because:
- Supabase's `listFactors()` on the client hides unverified factors (SDK design)
- Cleanup of "ghost" unverified factors must use admin API (`admin.auth.admin.mfa.listFactors`)
- Race conditions between cleanup and enroll require sequential server-side calls

Flow:
1. Browser reads access token from Supabase session (stored in localStorage)
2. Browser POSTs to `/api/mfa/enroll` with `Authorization: Bearer <token>`
3. Server validates token via admin client (`admin.auth.getUser(token)`)
4. Server lists all factors for that user (admin API sees verified + unverified)
5. Server deletes any `status = 'unverified'` factors (sequential awaits)
6. Server creates fresh enrollment via user-scoped client
7. Returns `{ qrCodeUrl, secret, factorId }` to browser
8. Browser displays QR + 6-digit input
9. Verification via `supabase.auth.mfa.challengeAndVerify()` (client-side is fine here)

#### Pages
- `/mfa-setup` — enrollment (QR + secret + 6-digit input). Uses `useRef` lock to prevent React Strict Mode double-invocation. Honors `?returnTo=` on all exit paths via `postSetupRedirect()` (already-enrolled guard, codes-gen failure, codes Continue); default `/dashboard`.
- `/mfa-challenge` — login TOTP verification. Honors `?returnTo=`; else JWT role fallback (super_admin → `/super-admin`, else `/dashboard`). Redirects to `/mfa-setup` if not enrolled.
- `/welcome` Step 4 — enrollment inside onboarding. Auto-skips to Step 5 if already enrolled.

#### Rules (Never Break)
- Server-side enroll endpoint is the ONLY way to start enrollment — never call `supabase.auth.mfa.enroll()` directly from client code
- `/api/mfa/enroll` must derive `user_id` from the validated access token, never from request body
- Only `status = 'unverified'` factors may be deleted by the cleanup; verified factors are never touched
- React Strict Mode double-mount must be guarded with `useRef` on `/mfa-setup` (effect creates server-side state)
- Friendly name conflicts are handled by deleting unverified factors before enroll, not by appending timestamps
- Dashboard gate order: onboarding → setup → challenge → dashboard. Never reorder.

### Profile Settings — Security Tab

The Profile Settings dialog (`sm:max-w-[760px]`) has two sub-tabs: Profile
(identity) and Security (account protection). Mounted on `/dashboard` (header),
`/super-admin` (gear button), and `/org-admin` (gear button). Optional
`mfaReturnTo` prop controls post-setup redirect (defaults: `/super-admin` for
super_admin, else `/dashboard`; `/org-admin` mount passes `/org-admin`).

#### 2FA management by role

| Role | UI |
|------|-----|
| super_admin (not enrolled) | Enable 2FA button |
| super_admin / manager / org_admin (enrolled) | Enabled badge + two-card grid: LEFT "Recovery Codes" (neutral, Generate New Recovery Codes) + RIGHT "Replace Authenticator" (amber warning, Regenerate 2FA). No Disable. |
| technician (no 2FA) | Disabled badge + "Enable 2FA" button |
| technician (has 2FA) | Enabled badge + standalone Recovery Codes card + "Disable 2FA" button |

#### Flows

**Enable 2FA (technician / super_admin not enrolled):** Closes dialog → routes
to `/mfa-setup?returnTo=${mfaReturnTo}` → server-side enrollment via
`/api/mfa/enroll` → user scans QR → verify → redirect per `returnTo`.

**Disable 2FA (technician only):** Inline confirmation card → on confirm,
`unenrollTotp()` from `lib/mfa.ts` → UI updates in place, no page reload.

**Regenerate 2FA (super_admin / manager / org_admin):** Amber "Replace
Authenticator" card → inline confirmation → `unenrollTotp()` removes verified
factor → router pushes to `/mfa-setup?returnTo=${mfaReturnTo}` → user scans
NEW QR → verify → redirect per `returnTo`.

**Generate recovery codes (all enrolled roles):** Neutral "Recovery Codes"
card → inline confirmation → `generateMfaRecoveryCodes()` → display batch.
Invalidates previous codes immediately.

#### Regenerate window — expected behavior, NOT a bug

Between `unenrollTotp()` and re-verification on `/mfa-setup`, the manager
briefly has zero 2FA factors. If they close the tab during this window:
- Next login: password verifies (AAL1)
- Dashboard gate sees "manager with no 2FA" → routes to `/mfa-setup`
- User completes enrollment normally — no lockout

This is correct behavior. The gate order handles it cleanly. Do not "fix"
this by trying to keep the old factor until the new one verifies — that
would require two simultaneous factors, which conflicts with the
"max 1 factor per user" Supabase setting.

#### UX patterns
- Inline confirmation cards (not nested dialogs) — avoids screen-reader
  focus-trap ambiguity and z-index issues
- Amber card for Regenerate (warning), red card for Disable (destructive)
- MFA status pre-fetched in the dialog's open `useEffect` so tab switch
  is instant
- Standard modal UX: ESC closes, Android back closes, Enter submits primary
  action on confirmation cards

### RLS Policy Pattern
Lab-scoped tables:
```sql
USING (
  (auth.jwt() ->> 'user_role' = 'super_admin')
  OR (lab_id = get_my_lab_id())
)
```

Labs table (JWT-only, no profiles subquery):
```sql
USING (
  (auth.jwt() ->> 'user_role' = 'super_admin')
  OR (id = get_my_lab_id())
  OR (auth.jwt() ->> 'user_role' = 'org_admin' AND org_id = get_my_org_id())
)
```

### Environment Variables (Never expose client-side)
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_WEBHOOK_SECRET, RESEND_API_KEY,
GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID,
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
should have the NEXT_PUBLIC_ prefix.

---

## Validation & COA Architecture

### Per-item flags
- `requires_coa` — COA upload required before bench use
- `requires_lot_validation` — Lot Validation upload required
- Both, one, or neither can be true per item

### Validation Status Flow (inventory_lots.validation_status)
```
requires_coa only:
  pending_coa → COA upload →
    approved (if require_coa_approval = false)
    pending_approval → manager approves → approved

requires_lot_validation only:
  pending_validation → lot val doc upload → pending_approval →
    manager approves/rejects → approved/rejected

requires both:
  pending_coa → COA upload → pending_validation → lot val upload →
    pending_approval → manager approves/rejects → approved/rejected

archived = manager clicked "Move to History"
```

### Rules (Never Break)
- COA must be submitted BEFORE lot validation (gating document)
- Lot Validation ALWAYS requires manager approval — never auto-approves
- COA auto-approval controlled by `lab_settings.require_coa_approval`
- Statuses BLOCKED from Open to Bench: `pending_coa`,
  `pending_validation`, `pending_approval`, `rejected`
- Open-to-bench uses ALLOWLIST: only `not_required`, `approved`,
  and `archived` can be opened (NEVER use blocklist approach)
- Archiving (Move to History) does NOT block opening to bench —
  archived means docs are filed, not that lot is invalid
- Technicians cannot see Validation & COA tab — manager only

### Who Does What
- **Technician:** uploads COA + lot validation files (in inventory expanded row)
- **Manager:** reviews, sets pass/fail, approves/rejects, moves to history
  (in Validation & COA tab)

### Storage
- Bucket: `coa-documents` (private)
- Path: `{lab_id}/{lot_id}/{timestamp}_{filename}`
- Used for both COA and Lot Validation
- Signed URLs generated lazily on click (1 hour TTL)
- Records retained 3 years from archived date
- Tenant wipe / offboarding: DB CASCADE does not delete bucket files — see
  Tenant Wipe & Offboarding section

---

## Database Schema Reference

### organizations
```
id, name,
plan (text, default 'trial'),  — LEGACY: superseded by billing_accounts.billing_status;
  still read by /super-admin/orgs/[id] and /super-admin/labs/[id]
trial_ends_at (timestamptz, default now() + 90 days),
created_at, created_by (uuid → auth.users)
```
- RLS enabled — super admin full access, org admin sees own org
- plan: 'trial' | 'starter' | 'pro' | 'enterprise' — **LEGACY**; billing truth is
  `billing_accounts.billing_status` (KPI cards no longer use `plan`; two
  super-admin detail pages still read it for badges / +30/+90 trial-extend)
- `created_by` → auth.users ON DELETE **NO ACTION** (blocks user delete until
  org row removed or created_by reassigned)
- `profiles.org_id` → organizations ON DELETE **RESTRICT** (org cannot be
  deleted while profiles still reference it — delete target profiles first)

### labs
```
id, name, tech_key, is_archived, archived_at, created_at, owner_id,
org_id (uuid, nullable → organizations),
trial_starts_at (timestamptz, default now()),
trial_ends_at (timestamptz, default now() + 90 days)
```
- org_id NULL = single-lab customer; uuid = belongs to org
- `org_id` → organizations ON DELETE **RESTRICT** (can't delete org with labs)
- `owner_id` → auth.users ON DELETE **SET NULL** (user delete nulls owner on
  any lab they own — check before offboarding user deletes)
- Trial columns drive single-lab billing tab UI

### inventory_lots
```
id, lab_id, item_id, lot_number, expiry_date, received_date,
storage_location, quantity_type, units, unit_label, count,
count_label, notes, status, validation_status,
validation_archived_at (timestamptz, nullable)
```
- Unique: `(lab_id, item_id, lot_number)`
- validation_status valid values: `not_required`, `pending_coa`,
  `pending_validation`, `pending_approval`, `approved`, `rejected`, `archived`
- Constraints: `check_quantity_not_zero`, `inventory_lots_validation_status_check`

### items
```
id, lab_id, name, vendor, catalog_number, vendor_sku,
default_price,
requires_coa (boolean, default false),
requires_lot_validation (boolean, default false),
expiring_soon_days (integer, nullable),
urgent_days (integer, nullable),
low_stock_threshold (integer, nullable),
working_expiry_days (integer, nullable)
```
- Nullable threshold fields fall back to lab_settings globals
- NULL means "use lab default" — never treat NULL as 0

### active_lots
```
id, lab_id, item_id, lot_number, opened_date,
working_expiry_date, actual_expiry_date,
quantity_left, status
```

### coa_records
```
id, lab_id, lot_id, file_url, file_name, lot_number,
expiry_date, result, uploaded_by, uploaded_at, notes
```
- `lab_id` → labs ON DELETE **CASCADE**; `lot_id` → inventory_lots ON DELETE
  **CASCADE** (verified live July 2026)
- DB cascade does NOT delete Storage bucket objects — purge separately

### lot_validation_records
```
id, lab_id, lot_id, previous_lot_number, result,
file_url, file_name, submitted_by, submitted_at,
approved_by, approved_at, rejection_reason, notes
```
- `lab_id` → labs ON DELETE **CASCADE**; `lot_id` → inventory_lots ON DELETE
  **CASCADE** (verified live July 2026)

### lab_settings
```
lab_id,
urgent_days (integer, default 7),
expiring_soon_days (integer, default 30),
low_stock_threshold (integer, default 5),
lab_timezone (text, default 'America/Chicago'),
tech_dashboard_widget (text, default 'donut'),
require_coa_approval (boolean, default false),
techs_can_edit_thresholds (boolean, default true),
audit_log_retention_years (integer, default 3, CHECK 1-10),
onboarding_complete (boolean, default false)
```
- audit_log_retention_years read-only in customer UI; super admin only

### activity_logs
```
id, lab_id, created_at, user_name, user_initials,
action_type, item_name, lot_number, details
```
- RLS enabled — APPEND-ONLY (no UPDATE, no DELETE policies)
- SELECT: lab-scoped + super admin sees all
- INSERT: lab_id = get_my_lab_id()
- `lab_id` → labs ON DELETE **CASCADE** (tenant wipe removes rows — documented
  exception to immutability; see Tenant Wipe & Offboarding section)
- 21 CFR Part 11 compliant — DB-level immutability

### security_logs
```
id, created_at, user_id (nullable), user_name, user_initials, user_role,
lab_id (nullable), event_type, outcome, details, ip_address
```
- Purpose: append-only ACCESS-CONTROL audit trail, separate from
  `activity_logs` (ALCOA+ data-integrity/lab-operations trail stays pure).
- Schema essentials:
  - `lab_id` is nullable to preserve non-lab-scoped events (super_admin /
    org_admin) and close the historical null-lab drop gap.
  - `lab_id` → labs ON DELETE **SET NULL** (tenant wipe preserves rows;
    lab_id nulled — verified live July 2026)
  - `user_id` is nullable for forensic join convenience and is NOT the primary
    attribution anchor.
  - Attribution snapshots are `user_name` + `user_initials`; initials are
    derived through shared helper `lib/user-initials.ts`.
  - DB constraint enforces valid `event_type` / `outcome` pairings
    (including reserved `('login','failure')` for future failed-login logging).
- RLS (Option B):
  - SELECT: super_admin sees all rows.
  - SELECT: manager/org_admin see own-lab rows only.
  - `lab_id IS NULL` rows are super_admin-only.
  - No UPDATE/DELETE policies (append-only).
  - Writes are service-role only; there is no client INSERT path.
- Write paths:
  - `POST /api/security-log` for client-side login/logout events only
    (bearer-authenticated, 60/hr Upstash limiter).
  - Recovery routes (`/api/mfa/recovery-codes/generate` and `/redeem`) write
    `logSecurityEvent()` directly server-side.
- Identity resolution for security rows:
  - `profiles.role` → JWT `user_role` claim → `technician` fallback.
  - Fallback rows append detail suffix:
    ` [role unverified — attribution fallback]`.
- Deliberate exclusions (intentional scope, not oversight):
  - Forced/system sign-outs (archived-lab gate and missing-profile poll paths)
  - Signup-rollback cleanups
  - `lib/supabase.ts` refresh-failure signout
  - Malformed recovery-code `400` requests
  - Failed logins are future work (DB pairing reserved now)

### requests
```
id, lab_id, item_id (nullable), item_name, vendor, catalog_number,
order_qty, unit_price, total_price, status, notes, date_requested
```
- `lab_id` → labs ON DELETE **CASCADE**
- `item_id` → items ON DELETE **NO ACTION** (blocks item-only deletes; harmless
  in whole-lab delete because lab CASCADE removes requests in same transaction)

### profiles
```
id, lab_id, org_id, full_name,
role ('super_admin' | 'org_admin' | 'manager' | 'technician'),
created_at (timestamptz, default now()),
is_active (boolean NOT NULL DEFAULT true),
deactivated_at (timestamptz, nullable),
deactivated_by (text snapshot of actor name — not an FK)
```
- email column removed — stored in auth.users only
- RLS enabled
- State-coherence CHECK `profiles_deactivation_state_chk`: active rows must
  have both metadata columns NULL; inactive rows must have both set
- Super_admin immunity CHECK `profiles_super_admin_always_active_chk`:
  `role = 'super_admin'` cannot have `is_active = false`
- Never query email from profiles — use `admin.auth.admin.getUserById()`
- `id` → auth.users ON DELETE **CASCADE**
- `lab_id` → labs ON DELETE **SET NULL**
- `org_id` → organizations ON DELETE **RESTRICT** (delete profiles before org)

### lab_invites
```
id, token, lab_name, used, created_at, used_at,
lab_id (uuid, nullable → labs),
org_id (uuid, nullable → organizations),
role (text, default 'manager', CHECK IN ('manager', 'org_admin')),
created_by (uuid → auth.users),
revoked_at (timestamptz, nullable),
revoked_by (uuid, nullable → auth.users)
```
- Unique index: one active invite per lab (used=false AND revoked_at IS NULL)
- org_admin invites: lab_id NULL, org_id uuid
- manager invites: lab_id uuid, org_id nullable
- `lab_id` / `org_id` → CASCADE with parent lab/org delete
- `created_by` / `revoked_by` → auth.users ON DELETE **NO ACTION** (pre-clear
  or delete invites before user delete)

### feedback
```
id, user_id, lab_id, type ('bug' | 'support' | 'feedback'),
title, description, created_at
```
- `lab_id` → labs ON DELETE **CASCADE**
- `user_id` → auth.users ON DELETE **NO ACTION** (pre-clear before user delete)

### active_sessions
```
user_id (uuid PK → auth.users ON DELETE CASCADE),
session_token (uuid, not null),
created_at (timestamptz, default now())
```
- RLS enabled — user_id = auth.uid()
- One row per user (PK), upsert on login
- Voluntary sign out deletes row; replaced sign out preserves new row

### mfa_recovery_codes
```
id (uuid PK),
user_id (uuid → auth.users ON DELETE CASCADE),
code_hash (text, not null) — bcrypt hash of normalized code,
batch_id (uuid) — shared across all codes in one generated batch,
used_at (timestamptz, nullable) — single-use marker; NULL = unused,
created_at (timestamptz, default now())
```
- RLS enabled — written/read by service role only (MFA API routes)
- 10 codes per batch, `XXXX-XXXX` format, ambiguous chars excluded (no 0/O/1/I/L)
- Plaintext returned ONCE at generation; only the bcrypt `code_hash` is stored
- Regenerate is destructive: all prior rows for the user are deleted before insert
- Generated via `/api/mfa/recovery-codes/generate`; consumed via `/redeem`
  (`used_at` set, guarded by `.is("used_at", null)` to prevent double-spend)

### mfa_recovery_elevations
```
id (uuid PK),
user_id (uuid → auth.users ON DELETE CASCADE),
session_id (uuid, not null) — JWT session the elevation is bound to,
expires_at (timestamptz, not null) — created_at + 60 min,
created_at (timestamptz, default now())
```
- RLS enabled — written/read by service role only
- One active row per user: a new redeem deletes any prior row before inserting
- 60-min TTL = lifetime of the recovery ELEVATION (session trust), not the codes
- Gates check live via `expires_at > NOW()` (TTL honored by query, not deletion);
  expired rows linger inert until the next redeem replaces them
- This DB row — NOT an `aal` change — is what authorizes an aal1 recovery session
  (checked by `/api/mfa/recovery-elevation-status`)

### billing_accounts
```
id, org_id (nullable → organizations, ON DELETE RESTRICT),
lab_id (nullable → labs, ON DELETE RESTRICT),
stripe_customer_id (text, unique, nullable),
stripe_subscription_id (text, unique, nullable),
billing_status ('trialing' | 'active' | 'past_due' | 'suspended',
  NOT NULL DEFAULT 'trialing'),
current_period_end (timestamptz, nullable),
created_at, updated_at
```
- Exactly one owner: CONSTRAINT `billing_owner_exactly_one` —
  `((org_id IS NULL) <> (lab_id IS NULL))`; partial unique indexes on org_id
  and lab_id
- Writes are service-role only (webhook / checkout); no authenticated
  INSERT/UPDATE/DELETE policies
- SELECT scoped: super_admin all; manager / technician own lab; org_admin own org
- Column grant: authenticated SELECT only on `(id, org_id, lab_id,
  billing_status, current_period_end, created_at, updated_at)` —
  `stripe_customer_id` / `stripe_subscription_id` are server-only
- Restrictive `billing_accounts_require_active_user` mirrors deactivation
- Write-gate for lab data: `lab_billing_allows_writes()` + 21 restrictive
  policies (7 tables × INSERT/UPDATE/DELETE); excludes `activity_logs` and
  `feedback`. Source of record: `database-scripts/schema-2026-07-31.sql`

### processed_stripe_events
```
event_id (text PK — Stripe evt_ id),
event_type (text NOT NULL),
received_at (timestamptz NOT NULL DEFAULT now()),
applied_at (timestamptz, nullable — NULL = claimed/unapplied; set after
  successful apply or terminal ignore; backfilled from received_at for
  pre-existing rows),
payload (jsonb)
```
- Webhook idempotency / receipt table; service-role writes. Receipt
  timestamp column is `received_at` (there is no `created_at` on this table).
- SELECT: super_admin only (`stripe_events_select_super`)
- Source of record: `database-scripts/schema-2026-07-31.sql`

### Storage bucket: coa-documents (private)
Path: `{lab_id}/{lot_id}/{timestamp}_{filename}`
- **Not relational:** deleting `coa_records` / `lot_validation_records` / labs
  does NOT remove bucket objects. Offboarding purge via Storage API
  (`storage.from('coa-documents').remove([...])`) or dashboard — never SQL on
  `storage.objects`. Separate non-transactional step after DB wipe.

---

## Tenant Wipe & Offboarding

**Scope distinction:** test-tenant wipe (July 10, 2026 — four archived tenants)
is complete. Real-customer offboarding is a future workflow governed by ToS
§3.3 (30-day export) and §5.3 (retention minimums); `security_logs` may
survive even when `activity_logs` CASCADE away.

### Mandatory method (never skip steps)
1. **Live FK introspection** (`pg_constraint`) — source of truth for ON DELETE;
   repo SQL and even CLAUDE.md can drift.
2. **Read-only dry-run:** name → UUID resolution, attached-user snapshot,
   allow-list safety checks, per-table row-count preview.
3. **Destructive script:** UUID literals only at destruction time; allow-list
   guards (`RAISE EXCEPTION` on UUID/name mismatch); re-check dry-run
   assumptions; per-step row-count assertions; **single transaction** (failure
   = full rollback).

### Verified delete order (lab + org tenant)
1. Delete **labs** (CASCADE: inventory, activity_logs, coa_records, etc.)
2. Delete **profiles** tied to target org/labs (required before org — RESTRICT)
3. Delete **organization** (after labs gone — RESTRICT on labs.org_id)
4. Delete **auth.users** (only after NO ACTION refs cleared: feedback,
   lab_invites created_by/revoked_by, organizations.created_by; check
   labs.owner_id SET NULL side effects on non-target labs)

### What survives a lab delete
- **security_logs:** `lab_id` ON DELETE SET NULL — rows persist, lab_id nulled
- **Storage objects:** persist unless explicitly purged (see Storage bucket)

### July 10 test-tenant wipe record
| Name | UUID | Type |
|------|------|------|
| TestLab | beea89ce-abc4-4e9a-b6ab-210253a40641 | lab |
| TestLab123 | 1c78c34a-609c-406c-8645-f79116c00ecc | lab |
| TestLabinOrg | 98cfff3c-77eb-48df-8cc3-e2379cd0c820 | lab |
| TestOrg | 3fb26e5e-5ac4-44e7-8c8d-6ec42e74593c | org |

Post-wipe: Oakwood Lab only; organizations empty; zero auth.users without
profiles (orphan check passed).

---

## Audit Trail

Actions logged via `logActivity`:
`Added`, `Submitted COA`, `Submitted Lot Validation`, `Approved Lot`,
`Rejected Lot` (includes reason), `Archived Lot`, `Opened` (logs actual
item name), `Used`, `Deleted from Storage`, `Deleted from Bench`.

---

## Threshold Logic

Per-item thresholds override lab-wide defaults.
Fallback: item setting → lab_settings default.

```typescript
const expiringSoonDays = item.expiring_soon_days ?? labSettings.expiringSoonDays
const urgentDays = item.urgent_days ?? labSettings.urgentDays
const lowStockThreshold = item.low_stock_threshold ?? labSettings.lowStockThreshold
```

`working_expiry_days` auto-calculates `working_expiry_date` when a lot
opens: `working_expiry_date = opened_date + working_expiry_days`. Tech
can manually override after auto-fill.

`techs_can_edit_thresholds` controls whether technicians can set
thresholds when creating/editing items. Managers always can.

---

## FEFO (First Expired First Out)

When tech opens a lot, system checks for an earlier-expiring lot of
the same item with approved/not_required status.

If found → soft warning dialog:
- "Open Suggested Lot Instead" → switches lots
- "Continue Anyway" → proceeds with original
- "Cancel" → nothing opens

Rules: only compares lots with `status = 'In Storage'` and
`validation_status = 'approved' OR 'not_required'`. Never hard-blocks.

---

## Barcode Scanning

- Library: `@zxing/browser` + `@zxing/library`
- Component: `components/dashboard/barcode-camera-scanner.tsx`
- Parser: `parseSmartBarcode()` in `lib/inventory-utils.ts`
- Supports: Code 128, GS1, HIBC, QR Code, EAN
- Rear camera by default, flip button toggles, USB scanner toggle
- Camera stops fully on modal close (controlsRef.stop() + stop tracks
  + srcObject = null)
- 1-second cooldown prevents duplicate scans
- Requires HTTPS

### Known ZXing Limits (target: iPad)
- Cannot reliably read long GS1-128 on mobile camera
- Cannot read stacked double barcodes (only catches one)

### Future: Dynamsoft Migration (when first customers onboard)
- Confirmed reads all lab label formats including stacked barcodes
- ~$10-15/month production cost
- Migration: swap ZXing in `barcode-camera-scanner.tsx` + add one line
  to `parseSmartBarcode()`:
  `const trimmed = raw.trim().replace(/\{GS\}/g, "\x1d")`
  (`{GS}` is Dynamsoft's FNC1 separator — parser already handles `\x1d`)

### USB Scanner Notes
Zebra DS series confirmed in target labs (excellent GS1-128).
2D imaging scanners can read stacked barcodes sequentially.

---

## Mobile & Tablet Responsiveness

### Breakpoints
- Phone (<640px): card layouts, no sidebar
- Tablet (640-1024px): table layouts, hamburger sidebar
- iPad lg (1024px): icon-only sidebar (w-16), collapsible right panel
- Desktop xl+ (1280px+): full sidebar (w-64), right panel always visible

### Sidebar
- Below lg: hidden, hamburger opens slide-in
- lg: icon-only, native tooltip on hover, license card hidden
- xl+: full sidebar w/ icons + labels

### Phone Card Layouts
- Inventory: item group cards with lot sub-cards
- Lot in Use: active lot cards, fields stacked
- Requests: request cards with status + actions

### Right Panel (Search/Filter/Timeline)
Hidden on mobile, collapsible at lg, always visible at xl+.

### Mobile Modals
- `flex flex-col max-h-[90vh] overflow-hidden`
- Header fixed, content scrollable, footer fixed
- Padding: `p-4 sm:p-10`

### Mobile Button Rows
`grid grid-cols-2 gap-2 sm:flex sm:gap-3`, each button `w-full justify-center sm:w-auto`.

---

## Tab URL Persistence

Active tab synced to query param: `/dashboard?tab=inventory`

Valid tabs: `dashboard, inventory, lotinuse, requests, activitylog,
validation, analytics, labsharing, settings`

- Uses `useSearchParams()` to read on mount
- Uses `router.replace()` with `{ scroll: false }` to update
- Wrapped in `Suspense` (Next.js 16 requirement)
- Survives refresh, works with browser back/forward

---

## Idle Auto-Logout

Tracks: mousemove, mousedown, keydown, touchstart, scroll, click.

Timer:
- 8 min inactivity → warning dialog
- 2 min countdown (m:ss format)
- "Stay Logged In" → reset timers
- "Log Out Now" or expiry → signOut + /login redirect
- Total time to logout: 10 minutes

Warning dialog: amber header, live countdown, dark overlay, z-[60].
All listeners/timers cleaned up on unmount.

---

## One Active Session Per User

Second login wins — first session gets kicked.

### Architecture
- `active_sessions` table: user_id PK, session_token, created_at
- Login: upsert token via ON CONFLICT (user_id) DO UPDATE
- Token in localStorage as `buddy_session_token`
- 30s poll on dashboard + org-admin checks token match
- Mismatch → `sessionReplacedSignOut()` → /login?reason=session_replaced

### Sign Out Patterns (lib/active-session.ts)
- `voluntarySignOut(userId)` — DELETE row + clear localStorage + signOut
- `sessionReplacedSignOut(router)` — clear localStorage + signOut +
  redirect (does NOT delete row — preserves newer session)

### Replaced Banner
/login reads `?reason=session_replaced` → amber warning. Distinct from
invalid credentials styling.

---

## Password Reset Flow

Email-based, not inline fields.

1. User clicks "Send Password Reset Email" (Profile Settings) OR
   "Forgot password?" (Login page)
2. `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
3. Branded email arrives from noreply@yourbuddyapp.com
4. Link opens `/reset-password`
5. New password + confirm with strength checklist
6. `supabase.auth.updateUser({ password })` → /login

### Strength Rules
Min 8 chars, lowercase, uppercase, digit, special char.
Shared: `lib/password-strength.ts` + `components/password-strength-checklist.tsx`.
Enforced on /register-lab and /reset-password.

### Redirect URLs (Supabase Auth → URL Configuration)
- http://localhost:3000/reset-password
- https://buddy-lab-tracker.vercel.app/reset-password
- https://yourbuddyapp.com/reset-password

---

## Dashboard Overview Cards

Four expandable KPI cards on /dashboard home:
1. **Expired Lots** (red) — past expiry, storage + bench
2. **Urgent < X Days** (amber) — within urgent_days, storage + bench
3. **Expiring < X Days** (yellow) — between urgent_days and expiring_soon_days
4. **Low Stock Items** (green) — total units ≤ threshold, storage only

Behavior: click to expand (one at a time), max 5 items + "and X more",
per-item thresholds with lab fallback, click row → navigate to relevant
tab. Card labels use dynamic threshold values.

---

## Bell Notifications Architecture

### Hook: hooks/use-bell-alerts.ts
60s auto-refresh. Accepts userRole to gate manager-only queries at
fetch time. Returns: pendingApprovals, requestsPending,
orderedNotReceived, benchExpiring, outOfStock, totalCount, isLoading.

### Categories (display order)
1. **Pending Approvals** (manager only) → inventory_lots WHERE
   validation_status IN (pending_approval, pending_coa) → ?tab=validation
2. **Requests Awaiting Approval** (manager only) → requests WHERE
   status='pending' AND date_requested ≤ now()-3 days → ?tab=requests
3. **Ordered Not Yet Received** (all) → requests WHERE status='ordered'
   → ?tab=requests
4. **Bench Expiry Today/Tomorrow** (all) → active_lots WHERE
   working_expiry_date BETWEEN today AND today+1 → ?tab=lotinuse
5. **Out of Stock** (all) → items with zero total units in storage
   → ?tab=inventory

### Rules (Never Break)
- Manager-only categories gated at BOTH fetch and render time
- Bell uses `router.replace()` (NOT push)
- Badge hidden when totalCount = 0 or loading; capped at 99+
- Max 20 rows then "and X more alerts"
- Empty state: checkmark icon + "No alerts right now"

---

## Coding Conventions

- Prefer server components unless interactivity is needed
- Keep components modular (future Buddy products will share them)
- Explain SQL/Supabase concepts clearly — James is building SQL fluency
- Always scope queries to lab_id
- Use TypeScript types/interfaces for Supabase tables
- Never rely on app-level filtering alone — RLS is enforcement
- Empty threshold fields save as NULL, not 0
- Signed URLs generated lazily on click, not on page load
- Camera must stop completely on modal close
- ESC closes all modals (useEffect cleanup return)
- `router.replace()` not `router.push()` for tab URL updates
- Never query email from profiles — use auth.users via admin client

---

## Security Rules (Never Break)

- All inventory_lots queries must include `.eq("lab_id", labId)`
- `openNewLotInSupabase()` initial fetch must be lab-scoped
- Open-to-bench uses ALLOWLIST (not_required, approved, archived only)
- ValidationTab only mounts when `userRole === 'manager'` (render guard)
- No console.log in production code
- No hardcoded lab_ids or user_ids
- Never add email column back to profiles — use auth.users
- Never disable RLS on any table including profiles
- get_my_lab_id() and get_my_org_id() must use NULLIF for empty strings
  AND read from JWT — never query profiles
- Super admin checks use `auth.jwt() ->> 'user_role'` only
- Never expose service role key with NEXT_PUBLIC_ prefix
- Email change blocked for technicians by design (security anchor —
  prevents account hijacking via compromised email access)
- Rate limiting must stay on all API routes (Upstash pattern) (exception: recovery-elevation-status has no limiter by design — it is called on every gate evaluation). As of July 15, 2026 every limited route uses a route-specific prefixed key (`feedback-notify:`, `mfa-enroll:`, `mfa-enroll-complete:`, `mfa-recovery-gen:`, `mfa-recovery-redeem:`, `user-email:`, `set-active:`, `set-role:`, `security-log:`) so per-IP buckets cannot collide.
- `profiles.role` is client-immutable: authenticated has table UPDATE revoked and column UPDATE only on `(full_name, lab_id, org_id)`. Role changes go through `set_user_role` / `/api/users/set-role` only. A plain `REVOKE UPDATE (role)` is a no-op against Supabase's table-level UPDATE grant — always use the table-revoke + column-regrant form in `role-column-lockdown.sql`.
- Labs RLS policies must use JWT claims only — never profiles subquery
- Super admins must not access /dashboard — /super-admin only
- Org admins have no lab_id — never scope to inventory queries
- **Never add UPDATE or DELETE policies to activity_logs** — append-only
  is enforced and required for 21 CFR Part 11
- activity_logs RLS policies must use JWT only — never profiles subquery
- audit_log_retention_years read-only on customer UI; super admin only
- Two-factor enrollment must go through `/api/mfa/enroll` — never call `supabase.auth.mfa.enroll()` directly from client code
- `/mfa-setup` page must use `useRef` lock to prevent React Strict Mode double-invocation (causes ghost factor race)
- Dashboard gate order is fixed: onboarding → 2FA setup → 2FA challenge → dashboard
- Privileged-route gates (`/super-admin`, `/org-admin`) use `resolveMfaGateRedirect(returnTo)` — steps 2–3 only; never bypass
- `listFactors()` from the client SDK hides unverified factors — use admin API (`admin.auth.admin.mfa.listFactors`) when you need to see them
- Never delete verified 2FA factors automatically — only `status = 'unverified'` can be cleaned up programmatically
- Profile Settings Security tab must not call `supabase.auth.mfa.enroll()` directly — enable flow routes to `/mfa-setup` which uses `/api/mfa/enroll`
- The Regenerate 2FA flow has an expected window where the user has zero factors — do not try to keep the old factor active during re-enrollment (Supabase max 1 factor per user)
- After May 30, 2026, new Supabase tables in `public` schema require
  explicit GRANT statements for the Data API to access them. Existing
  tables grandfathered until October 30, 2026.
- All new table SQL must follow the Standard New Table Template below
  (create + grant + RLS + policies — four steps, in that order).
- Billing ownership is resolved ONLY by `resolveBillingOwner()`. Never derive
  it inline from role or `lab_id` in a route or component.
- Org membership for billing must be read from `labs.org_id` — never from
  `profiles.org_id` or the JWT `org_id` claim (routinely NULL for org-lab staff).
- Stripe checkout/portal and `resolveBillingOwner` both read role from
  `profiles.role` (admin client) — not from the JWT. RLS still uses
  `auth.jwt() ->> 'user_role'` until token refresh. App-vs-RLS lag is a
  layer divergence that fails safe, not a designed cross-check. (False
  JWT-vs-DB app-layer claim recorded 2026-07-31, corrected same day.)
- Table-level GRANTs and RLS policies are independent locks — audit both.
  A missing write policy is not a substitute for tight grants (see Phase A
  `billing_accounts` revoke; same class as the role-column lockdown).
- Silent-empty is this codebase's recurring failure mode. Three instances
  found in one week: an empty `billing_accounts` read rendering as "Trial";
  an RLS-blocked read being indistinguishable from zero rows; and a throwing
  date formatter caught into null, blanking the renewal line for every user.
  In each case a failure produced an innocent-looking empty value that the
  UI accepted as fact. Rule: a catch block that returns null/empty must log
  first. Never let a failure and a legitimately-empty result look identical.
- `Intl.DateTimeFormat`: never combine `dateStyle`/`timeStyle` with
  `timeZoneName` (or other component options) — it throws at runtime;
  `tsc` will not catch it. Use separate formatters
  (`lib/format-renewal-date.ts`).
- Webhook durability: stamp `processed_stripe_events.applied_at` only after
  apply succeeds or the event is a terminal ignore; return 500 (leave
  `applied_at` NULL) on write failure so Stripe retries. Never treat a
  receipt alone as "done."

---

## Standard New Table SQL Template

Every new table in the `public` schema must include four steps:
create → grant → enable RLS → add policies. Skipping the GRANT step
means the Data API (supabase-js, PostgREST) cannot reach the table,
even with RLS perfectly configured.

```sql
-- 1. Create the table
create table public.your_table (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  -- ... your columns
  created_at timestamptz not null default now()
);

-- 2. Grant Data API access (required May 30, 2026+)
grant select, insert, update, delete on public.your_table to authenticated;
grant select, insert, update, delete on public.your_table to service_role;
-- Note: only grant to `anon` if the table needs unauthenticated access
-- (which it almost never does for B2B SaaS)

-- 3. Enable RLS
alter table public.your_table enable row level security;

-- 4. Add lab-scoped policies (standard pattern)
create policy "lab members select own rows"
  on public.your_table for select to authenticated
  using (
    (auth.jwt() ->> 'user_role' = 'super_admin')
    or (lab_id = get_my_lab_id())
  );

create policy "lab members insert own rows"
  on public.your_table for insert to authenticated
  with check (lab_id = get_my_lab_id());

-- ... add update/delete policies as needed
```

### Why this matters
- Pre May 30, 2026: GRANT was implicit. Tables in `public` schema were
  automatically exposed to the API.
- Post May 30, 2026: GRANT is explicit. Missing GRANT → PostgREST returns
  error code 42501.
- Existing Buddy tables (created before May 30) are grandfathered. Only
  affects new tables going forward.

### Audit existing grants
To check current grants on all public tables:

```sql
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee in ('authenticated', 'anon', 'service_role')
order by table_name, grantee;
```

---

## Modal UX Conventions

### Enter Key Submission
- Every modal with primary action (Save/Submit/Confirm) supports Enter
- useEffect with keydown listener firing primary handler on Enter
- Guard: skip if `document.activeElement?.tagName === 'TEXTAREA'`
- Guard: only fire when modal open
- Cleanup on close + unmount; ESC close always preserved

### Android Back Button
- On modal open: `window.history.pushState(null, '', window.location.href)`
- popstate listener closes modal instead of navigating
- Cleanup on close + unmount

---

## Compliance Architecture

### Regulatory Context
Healthcare-adjacent. Not a medical device. No PHI. Must be audit-ready
for 21 CFR Part 11, ALCOA+, CLIA (if clinical labs onboard), and SDLC
validation expectations from regulated customers.

### ALCOA+ Status
| Principle | Implementation | Status |
|-----------|---------------|--------|
| Attributable | user_name + user_initials TEXT snapshots on every audit row (no user_id FK — survives user deletion) | ✅ |
| Legible | Structured schema, TypeScript types | ✅ |
| Contemporaneous | Server-side timestamps on all inserts | ✅ |
| Original | Append-only audit log (RLS no UPDATE/DELETE) | ✅ |
| Accurate | Unique constraints, RLS, duplicate prevention | ✅ |
| Complete | 10+ audit action types covering the full lot lifecycle. MFA recovery events are now written to `security_logs`; `activity_logs` entries `MFA Recovery Code Redeemed` / `MFA Recovery Code Redeem Failed` are legacy historical rows written before July 10, 2026 and are no longer produced (must remain visible, not deleted/hidden). | ✅ |
| Consistent | All queries lab_id scoped, JWT role gates | ✅ |
| Enduring | COA 3yr, audit log configurable 1-10yr (default 3), records preserved indefinitely | ✅ |
| Available | Activity log tab with action type filters | ✅ |

### 21 CFR Part 11 Checklist
| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Computer-generated audit trail | logActivity() on all state changes | ✅ |
| Time-stamped records | Supabase server timestamps | ✅ |
| Immutable records | Append-only RLS on activity_logs | ✅ |
| Attributable records | user_name + user_initials snapshots on every audit row | ✅ |
| Access controls | Role-based gates + RLS on all tables | ✅ |
| Audit trail for validation | Approved/Rejected/Archived logged | ✅ |
| Secure unique user IDs | Supabase Auth, one session per user | ✅ |

### Audit Log Rules (Never Break)
- activity_logs must NEVER have UPDATE or DELETE policy
- No admin UI button, scheduled job, or API may modify audit rows
- Only exception: **full lab/tenant deletion** — `activity_logs.lab_id` CASCADE
  removes rows when the lab row is deleted (documented tenant-wipe exception;
  July 10 test tenants wiped this way). `security_logs` survives (SET NULL).
  Real-customer offboarding must document wipe date + lab_id per tenant.
- logActivity() must include: user_name, user_initials, lab_id, action, item context, timestamp
- Audit rows written AFTER action succeeds, never speculatively

### Validation State Machine (Compliance-Critical)
The most compliance-critical logic. Must be deterministic.

Allowlist for open-to-bench (NEVER use blocklist):
- `not_required` → can open
- `approved` → can open
- `archived` → can open (docs filed, lot physically valid)
- Everything else → BLOCKED

### Software Validation Plan
- Document: docs/software-validation-plan.md (BIM-SVP-001 v1.2 — COMPLETE)
- Covers: intended use, SDLC, validation strategy, known limits
- Classification: NOT a medical device

### Traceability Matrix
- Document: docs/traceability-matrix.md
- Maps: Requirement → Feature → Code → Test → Status
- 11 requirements seeded (REQ-011 user deactivation added July 15, 2026)

- Break-glass emergency recovery: docs/break-glass-runbook.md

---

## Custom Access Token Hook (lives in Supabase, NOT in Git)

Full SQL: docs/custom-access-token-hook.sql (source of record — the hook is
NOT deployed from Git; it lives in the Supabase DB).

- Injects lab_id / org_id / user_role into JWT claims. Does NOT touch aal
  (Supabase reserves aal; hook-set values are overwritten).
- After any CREATE OR REPLACE, re-apply all three grants (stripped on replace):
  1. GRANT EXECUTE on the function to supabase_auth_admin
  2. GRANT SELECT ON profiles to supabase_auth_admin
  3. GRANT SELECT ON labs to supabase_auth_admin
  Source of record: docs/custom-access-token-hook.sql
- GUARDRAIL: any NEW table the hook reads needs (a) GRANT SELECT to
  supabase_auth_admin (rolbypassrls=false) AND (b) an RLS policy permitting
  that role. Miss either → lockout or silent corrupt claims.
- Diagnostics: Supabase Auth Logs (exact error);
  has_table_privilege('supabase_auth_admin','public.<table>','SELECT');
  pg_proc.prosrc to read the hook body (NOT pg_get_functiondef — editor
  auto-LIMIT bug).

---

## Dependency Management Conventions

### Dependabot policy
- **Patch/minor updates:** Auto-grouped into a single weekly PR. Safe to
  merge after Vercel preview build passes.
- **Major version updates:** Dependabot is configured to IGNORE these.
  Major bumps must be opened manually after testing.
- **Security CVEs:** Dependabot opens these as separate PRs regardless of
  severity. Review individually.
- **Frozen packages:** `@zxing/*` is ignored pending Dynamsoft migration.

### When merging Dependabot PRs
1. Verify Vercel preview build passes (green checkmark next to PR title)
2. For security CVE PRs, read the advisory link to assess production
   relevance
3. After merge, run locally: `git pull && npm install && npm audit`
4. If new vulnerabilities appear, run `npm audit fix` (no --force)
5. If `npm audit fix --force` is suggested, DO NOT run it without first
   verifying what package will be downgraded — npm often suggests
   destructive downgrades (e.g., "fix postcss by downgrading Next to 9.3.3")

### npm install warnings to take seriously
- `npm warn ERESOLVE overriding peer dependency` → package.json and
  package-lock.json may now disagree. Run `npm install` again with no
  arguments to test for consistency. Vercel's strict CI will fail where
  local lenient install succeeds.
- `multiple lockfiles detected` (Next.js warning) → a stray
  package-lock.json exists outside the project. Delete the stray one.

### Accepted vulnerability risks
Documented in `npm-audit-exceptions.md`. Reviewed monthly. Entries require:
- Vulnerability ID and severity
- Affected dependency chain
- Production risk assessment (why it's not exploitable in our usage)
- Fix path (what we're waiting for)

### Lockfile rules
- Only one `package-lock.json` exists — at the repo root
- Never run `npm install` outside the project folder (creates stray lockfiles)
- `package-lock.json` MUST be committed to git for deterministic builds

### Vercel build failures from Dependabot branches
Vercel runs preview builds on every Dependabot branch. Failures on those
branches are NOT production incidents — they signal that a proposed update
is incompatible. Only failures on the `main` branch indicate a real
production deploy issue.

To reduce email noise:
- Settings → Notifications → toggle off "Deployment failure" for Preview
  deployments
- Keep Production failure emails ON

---

## Response Style

- **Mentor tone:** Explain decisions, not just code
- **Flag issues early:** Warn about RLS, auth, multi-tenancy risks
- **Tradeoffs first:** Briefly explain options before recommending
- **Healthcare context:** Prefer explicit auditable patterns over clever shortcuts
- **Python-to-TypeScript bridges:** Draw analogies to Python when helpful
