# Buddy Inventory Management — Break-Glass Runbook

**Emergency recovery when normal login paths have failed.**  
Use the **Supabase SQL Editor** on the **production** project (US region). Work slowly. One query at a time.

---

## WARNING — Read this before you run anything

- **This bypasses the application** and operates directly on production data (auth + profiles).
- **Read and understand every query** before you execute it. Do not paste SQL you do not understand.
- **Never improvise SQL against production.** If the fix you need is not in this runbook, stop, document symptoms, and think before acting.
- **Always run a `SELECT` first** to inspect the target row(s) before any `UPDATE` or `DELETE`.
- **Auth and JWT changes only take effect after the affected user logs out and logs back in.** Until then, their existing session may still carry old claims or AAL level.

---

## Before you start

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and select the **Buddy Inventory Management** production project (US region).
2. Go to **SQL Editor** → **New query**.
3. Keep a separate incident note (text file or ticket): date, who is affected, what failed, each query you run, and the outcome.

**Tables you will touch (read-only unless noted):**

| Schema | Table / object | Purpose |
|--------|----------------|---------|
| `public` | `profiles` | `role`, `lab_id`, `org_id`, `full_name` — **no email column** |
| `auth` | `users` | Email and auth identity |
| `auth` | `mfa_factors` | TOTP factors (max 1 per user in app settings) |
| `public` | `custom_access_token_hook` | Postgres function that injects JWT claims at login |

**JWT claims** (injected at login by `custom_access_token_hook`):

- `lab_id` — UUID or null  
- `org_id` — UUID or null  
- `user_role` — `super_admin` | `org_admin` | `manager` | `technician`

**Role ↔ column rules (profiles):**

| Role | `lab_id` | `org_id` |
|------|----------|----------|
| `super_admin` | `NULL` | `NULL` |
| `org_admin` | `NULL` | organization UUID |
| `manager` | lab UUID | nullable (org labs) |
| `technician` | lab UUID | nullable |

---

## SCENARIO 1 — Super admin locked out (lost authenticator)

### Symptoms

- The **super admin** cannot complete login because the authenticator app code is wrong, the device was lost, or enrollment is stuck.
- Password may work, but TOTP verification fails or loops.
- No one else can fix this from `/super-admin` if only the super admin has access.

### Step 1 — Diagnostic `SELECT` (run first)

**1a. Find the super admin user id from `profiles`:**

```sql
SELECT id, full_name, role, lab_id, org_id, created_at
FROM public.profiles
WHERE role = 'super_admin';
```

Expect **one row** (or a small known set). Copy the `id` (UUID) — this is the `user_id` for auth tables.

**1b. If you need to confirm by email, join `auth.users` (email is not in `profiles`):**

```sql
SELECT p.id, p.full_name, p.role, u.email, u.created_at AS auth_created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role = 'super_admin';
```

**1c. Inspect MFA factors for that user** (replace `YOUR_SUPER_ADMIN_USER_ID`):

```sql
SELECT id, user_id, friendly_name, factor_type, status, created_at, updated_at
FROM auth.mfa_factors
WHERE user_id = 'YOUR_SUPER_ADMIN_USER_ID';
```

Review the result: note `id`, `status` (`verified` or `unverified`), and `friendly_name` (app uses `Buddy Inventory Management` for in-app MFA).

### Step 2 — Fix SQL

**Delete the stuck factor** only after the `SELECT` above shows the correct row. Replace placeholders:

```sql
-- Run ONLY after confirming the factor id from the SELECT above.
DELETE FROM auth.mfa_factors
WHERE id = 'FACTOR_ID_FROM_SELECT'
  AND user_id = 'YOUR_SUPER_ADMIN_USER_ID';
```

If multiple factors appear (unusual with max-1 setting), delete only the factor you intend to remove; run one `DELETE` per factor id, each preceded by a `SELECT`.

**Important:** This removes TOTP for that account. The account is at **AAL1** (password only) until someone re-enrolls 2FA. Super admin should re-enroll via the normal flow (Supabase dashboard MFA and/or app policy) after login.

### Step 3 — Verify the fix worked

1. Re-run the factors `SELECT` — expect **zero rows** for that user:

```sql
SELECT id, friendly_name, status
FROM auth.mfa_factors
WHERE user_id = 'YOUR_SUPER_ADMIN_USER_ID';
```

2. Super admin signs out everywhere, then logs in with **password only** (no TOTP prompt for the removed factor).
3. Re-enroll 2FA per your security policy before considering the incident closed.

---

## SCENARIO 2 — Auth hook / JWT claims broken (broad login failure)

### Symptoms

- Many or all users cannot use the app after login: errors, blank data, or permission denied everywhere.
- New logins succeed at the auth layer but the app behaves as if `user_role`, `lab_id`, or `org_id` is missing.
- Symptoms started after editing `custom_access_token_hook` in SQL (`CREATE OR REPLACE`) without re-applying grants.

### Healthy baseline (what a working system looks like)

- The privilege check on the hook should list `supabase_auth_admin` with `EXECUTE`. If `supabase_auth_admin` is **missing** from that list, that is the broken-grants diagnosis — apply the GRANT/REVOKE block below.
- `has_schema_privilege('supabase_auth_admin', 'public', 'USAGE')` should return **true**.
- If both of the above are healthy but logins still fail, the problem is **not** grants — inspect the function body (view definition query above) for broken logic instead of re-applying grants.

### Step 1 — Diagnostic `SELECT` (run first)

**2a. Confirm the hook function exists and view its definition:**

```sql
select pg_get_functiondef('public.custom_access_token_hook'::regprocedure) as definition;
```

Note: alias the result with `as definition` so the SQL editor's auto-applied LIMIT does not cause a syntax error. If you still get a limit-related error, choose **No limit** in the editor.

Read the `definition` output. It should read `profiles` and set JWT claims `lab_id`, `org_id`, and `user_role`. If the function is missing or obviously wrong, do **not** guess the body — restore from your last known-good migration or backup before re-granting.

**2b. Check whether `supabase_auth_admin` can execute the hook:**

```sql
SELECT
  routine_schema,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'custom_access_token_hook'
ORDER BY grantee, privilege_type;
```

You should see **`EXECUTE` granted to `supabase_auth_admin`**. If that grant is missing, the hook will not run at token issuance — claims stay empty or stale.

**2c. Check whether `supabase_auth_admin` has USAGE on the `public` schema:**

```sql
select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') as can_use_public_schema;
```

Note: `information_schema.usage_privileges` does **not** report schema-level USAGE grants, so it always returns empty here and is misleading. `has_schema_privilege()` returns a clean true/false. Expect **true** in a healthy system.

**2d. (Optional) Spot-check a known user’s profile** (claims source of truth):

```sql
SELECT id, role, lab_id, org_id, full_name
FROM public.profiles
WHERE id = 'ANY_KNOWN_USER_UUID';
```

### Step 2 — Fix SQL

**Re-apply the known-correct grants** (safe to run if diagnostics show missing `EXECUTE` for `supabase_auth_admin`):

```sql
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

**Why this happens:** `CREATE OR REPLACE FUNCTION public.custom_access_token_hook(...)` resets privileges. Without these `GRANT`/`REVOKE` statements, Auth cannot call the hook and JWT custom claims will not be injected.

If the function **definition itself** is wrong, fixing grants alone is not enough — you must restore the correct function body from version-controlled SQL, then run the three statements above again.

### Step 3 — Verify the fix worked

1. Re-run the routine privileges query (Step 2b) — confirm `supabase_auth_admin` has `EXECUTE`.

2. Have an affected user **sign out completely**, then sign in again (new JWT required).

3. Confirm app behavior:
   - **Manager/technician** → `/dashboard` loads with lab data.
   - **Org admin** → `/org-admin` loads.
   - **Super admin** → `/super-admin` loads.

4. If still broken, inspect Supabase **Authentication → Hooks** in the dashboard and confirm the access token hook still points at `public.custom_access_token_hook`.

---

## SCENARIO 3 — Manually fix a user's role or lab_id

### Symptoms

- User can log in but sees the wrong dashboard, empty inventory, or permission errors.
- Profile was updated incorrectly, invite flow left bad data, or emergency promotion/demotion is required.
- You have confirmed the fix in `profiles` is correct; the app still shows old behavior until re-login.

### Step 1 — Diagnostic `SELECT` (run first)

**By user id:**

```sql
SELECT id, full_name, role, lab_id, org_id, created_at
FROM public.profiles
WHERE id = 'USER_UUID_HERE';
```

**By email** (email lives in `auth.users` only):

```sql
SELECT p.id, p.full_name, p.role, p.lab_id, p.org_id, u.email
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'user@example.com';
```

Copy `id`, current `role`, `lab_id`, and `org_id`. Decide the correct target values using the role table in [Before you start](#before-you-start).

### Step 2 — Fix SQL

**Example: set user to manager of a specific lab** (replace UUIDs):

```sql
UPDATE public.profiles
SET
  role = 'manager',
  lab_id = 'TARGET_LAB_UUID',
  org_id = NULL  -- or org UUID if lab belongs to an organization
WHERE id = 'USER_UUID_HERE';
```

**Example: set user to org_admin:**

```sql
UPDATE public.profiles
SET
  role = 'org_admin',
  lab_id = NULL,
  org_id = 'TARGET_ORG_UUID'
WHERE id = 'USER_UUID_HERE';
```

**Example: set user to super_admin:**

```sql
UPDATE public.profiles
SET
  role = 'super_admin',
  lab_id = NULL,
  org_id = NULL
WHERE id = 'USER_UUID_HERE';
```

**Example: set user to technician:**

```sql
UPDATE public.profiles
SET
  role = 'technician',
  lab_id = 'TARGET_LAB_UUID'
  -- org_id: leave unchanged or set explicitly if needed
WHERE id = 'USER_UUID_HERE';
```

Run **only** the `UPDATE` that matches your intended end state. Do not set `lab_id` on `super_admin` or `org_admin`.

### Step 3 — Verify the fix worked

1. Re-run the profile `SELECT` from Step 1 — values must match intent.

2. Tell the user to **log out and log back in** (mandatory for new JWT claims).

3. Confirm they land on the correct surface:
   - `super_admin` → `/super-admin` only (not `/dashboard`)
   - `org_admin` → `/org-admin`
   - `manager` / `technician` → `/dashboard` with correct lab scope

---

## SCENARIO 4 — Disable a stuck 2FA factor directly in DB (any user)

### Symptoms

- A **manager**, **org admin**, **technician**, or other user cannot complete 2FA: lost phone, broken enrollment, or ghost **unverified** factor blocking `/api/mfa/enroll`.
- The app or `/api/mfa/enroll` is unreachable, so server-side cleanup cannot run.
- Scenario 1 is the same pattern for **super_admin**; this section applies to **any** `user_id`.

### Normal path (when app works)

The application enroll endpoint (`/api/mfa/enroll`) deletes **`status = 'unverified'`** factors via the Admin API before creating a new enrollment. Use that path when the app is up. This scenario is **only** when the app is down or the user cannot reach enrollment UI.

### Step 1 — Diagnostic `SELECT` (run first)

**4a. Find the user** (by email):

```sql
SELECT u.id, u.email, p.full_name, p.role, p.lab_id, p.org_id
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'user@example.com';
```

**4b. List all MFA factors** (replace `USER_UUID_HERE`):

```sql
SELECT id, user_id, friendly_name, factor_type, status, created_at, updated_at
FROM auth.mfa_factors
WHERE user_id = 'USER_UUID_HERE';
```

Identify the row to remove:

- **`unverified`** — safe to delete (ghost enrollment).
- **`verified`** — deleting is break-glass; user will be at **AAL1** until they re-enroll on `/mfa-setup` or Profile Settings.

**Never** `UPDATE` secret columns or try to “fix” a factor in place. **Only `DELETE` the whole factor row** is supported here.

### Step 2 — Fix SQL

```sql
-- Run ONLY after confirming id and user_id from the SELECT above.
DELETE FROM auth.mfa_factors
WHERE id = 'FACTOR_ID_FROM_SELECT'
  AND user_id = 'USER_UUID_HERE';
```

For managers and org admins, mandatory 2FA means they will be redirected to `/mfa-setup` after login until they enroll again.

### Step 3 — Verify the fix worked

1. Factors `SELECT` shows no row (or only the factors you intended to keep):

```sql
SELECT id, status, friendly_name
FROM auth.mfa_factors
WHERE user_id = 'USER_UUID_HERE';
```

2. User logs out, logs in with password, completes **re-enrollment** if required for their role.
3. For privileged roles, confirm **AAL2** after TOTP verify (dashboard access gate).

---

## After any break-glass action

Use this checklist before you close the incident:

- [ ] **Affected user can log in** with the expected role and landing page.
- [ ] **2FA re-enrolled** if you deleted a factor (`/mfa-setup`, onboarding Step 4, or Profile Settings → Security).
- [ ] User was told to **log out and back in** if you changed `profiles` or hook grants.
- [ ] **Incident note recorded** — break-glass actions are **not** written to the app’s `activity_logs` audit trail. Document separately:
  - Date and time (UTC)
  - Scenario number and short description
  - Queries run (or paste sanitized SQL)
  - Outcome (success / partial / rolled back)
  - Who performed the action and who approved it (if applicable)

---

## Quick reference

| Problem | Primary table / object | Typical fix |
|---------|------------------------|-------------|
| Super admin / user lost TOTP | `auth.mfa_factors` | `DELETE` factor after `SELECT` |
| Everyone missing claims | `custom_access_token_hook` grants | `GRANT` / `REVOKE` block in Scenario 2 |
| Wrong lab or role | `public.profiles` | `UPDATE` + user re-login |
| Stuck unverified MFA | `auth.mfa_factors` | `DELETE` unverified row; prefer `/api/mfa/enroll` when app is up |

**Production project:** Supabase US region · Auth hook: `public.custom_access_token_hook` · App: Buddy Inventory Management (Vercel).
