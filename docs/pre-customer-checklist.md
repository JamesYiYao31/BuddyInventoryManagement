# Pre-Customer Cleanup Checklist (Phase 8I)

**Purpose:** Final verification run before onboarding the first paying customer.
Confirms the production environment is clean, secure, correctly scoped, and free
of test artifacts — without touching the one piece of real data that must survive.

**How to use:** Run top to bottom in a single sitting. Check each box only after
you've personally verified it on the **production** deployment
(`yourbuddyapp.com`), not localhost. Anything that fails gets fixed
before the next customer invite goes out.

> 📌 **KEEP — Oakwood Lab:** Oakwood is the demo/dogfooding lab kept in production
> so you can experience the product from a customer's perspective. It holds only
> synthetic placeholder data — nothing real or irreplaceable — but you'll want to
> keep it around for demo continuity, so the "wipe test data" steps below exclude
> it by default. Deleting it costs nothing but that convenience. As always, verify
> the `lab_id` before deleting any lab, since a delete cascades through inventory,
> lots, and audit rows.

---

## 1. Test Data Hygiene  `(8I)`

- [x] **Test labs removed** — four archived test tenants wiped July 10, 2026
  (TestLab, TestLab123, TestLabinOrg, TestOrg — UUIDs in CLAUDE.md). Oakwood Lab
  verified intact and operational post-wipe (July 11): login, inventory, activity
  log, and members all confirmed working.
- [x] **Orphaned profiles / child rows cleaned** — zero orphan rows confirmed for
  all four wiped tenant UUIDs across child tables (July 11 re-run). No `profiles`
  rows pointing at deleted labs.
- [ ] **Test invites cleared** — no unused or expired invite rows from testing sit in the invites table.
- [ ] **Test inventory / lots removed** — any seed inventory, lots, or COA records created during testing are gone (Oakwood's legitimate test data may stay if you want a live demo lab).
- [ ] **Test feedback rows reviewed** — feedback submitted during testing is cleared from Supabase and the Google Sheet, so the first real feedback isn't buried under noise.
- [ ] **`active_sessions` table clean** — no stale session rows from old test logins.
- [ ] **`mfa_recovery_elevations` clean** — no leftover elevation rows from recovery-code testing (these are TTL'd, but verify none are lingering).

## 2. Audit Log Integrity (Compliance-Critical)  `(8A · 8B · 8H)`

> The audit log is append-only by design (21 CFR Part 11 §11.10(e)). These checks
> confirm the guardrail is intact — they are **not** an invitation to clean up audit rows.

- [ ] **`activity_logs` still has NO UPDATE policy and NO DELETE policy** — verify in Supabase. This is the immutability guarantee; if a policy crept in during testing, remove it.
- [ ] **Do NOT delete test audit rows individually** — the only sanctioned way to remove audit history is a full lab/tenant wipe (which cascades). Per-row audit deletion is forbidden even for test data.
- [x] **If a test lab was deleted, document the tenant wipe** — July 10 wipe documented in
  CLAUDE.md (four UUIDs + method). `security_logs` SET NULL survival verified
  behaviorally via rollback-transaction FK test (July 11) — structural FK
  introspection July 10, behavioral proof July 11.
- [ ] **Retention commitment is documented** — confirm the audit-log retention language is captured in ToS/Privacy Policy (Phase 8H) before go-live. Reminder: retention is a stored *commitment*; no automated deletion runs today.

## 3. Multi-Tenancy & RLS Verification  `(8I · core arch)`

- [ ] **RLS enabled on all 17 tables** (the 17th, `security_logs`, added July 10, 2026) — spot-check in Supabase that no table had RLS disabled during debugging and left off. (`profiles` RLS stays enabled.)
- [ ] **Cross-tenant isolation confirmed** — log in as an Oakwood manager and verify you see only Oakwood data; no other lab's inventory, lots, or logs are reachable.
- [ ] **Super_admin scoping correct** — super_admin has `lab_id = NULL` AND `org_id = NULL`, can reach `/super-admin` only, and is correctly blocked from `/dashboard`.
- [ ] **JWT claims minting correctly** — decode a fresh production token (full sign-out → clear `buddylab-auth` localStorage → fresh login) and confirm `lab_id`, `org_id`, `user_role` are all correct. (Stale-token lesson from June 7 — only a re-minted token reflects reality.)
- [ ] **Hook grants intact** — `supabase_auth_admin` has SELECT on every table the access token hook reads (`profiles`, `labs`). Missing grant = total login lockout.

## 4. Code & Build Cleanliness  `(8E · 8I)`

- [ ] **No `console.log` in production code** — search the codebase; none should ship to prod.
- [ ] **No hardcoded `lab_id` / `user_id` values** anywhere in the code.
- [ ] **Vercel production build is clean** — zero errors, zero warnings on the latest `main` deploy.
- [ ] **No stray lockfiles** — exactly one `package-lock.json`, at repo root (Next.js "multiple lockfiles" warning is clear).
- [ ] **`npm audit` reviewed** — any open findings are either fixed or documented in `npm-audit-exceptions.md` with rationale.
- [ ] **Service role key not exposed** — confirm no `NEXT_PUBLIC_` prefix on the service role key or any secret.

## 5. Environment & Secrets  `(8I)`

- [ ] **All production env vars set correctly in Vercel** — Supabase URL/keys, Resend API keys (app key *and* the separate Supabase SMTP key), Upstash, Google service account, webhook secret.
- [ ] **`.env` and `.claude/settings.local.json` NOT committed** — confirm `.gitignore` entries hold and neither appears in git history.
- [ ] **Webhook secret validation active** — `/api/feedback-notify` rejects requests without the correct `x-webhook-secret` header.
- [ ] **Rate limiting live on all API routes** — Upstash pattern (10 req/hr/IP) confirmed in place.

## 6. Auth & 2FA Readiness  `(8J · Phase A · login alerts)`

- [x] **Super_admin (you) has TOTP enrolled + recovery codes generated** — done *before* the mandatory super_admin gate is enforced (Phase A). No self-lockout.
- [x] **Recovery-code login verified** — you've confirmed you can get back in via a recovery code, and the 60-min elevation TTL expires correctly.
- [x] **Mandatory 2FA gate works for super_admin / managers / org_admins** — dashboard gate order intact (onboarding → setup → challenge → dashboard); `/super-admin` (×3) and `/org-admin` use `resolveMfaGateRedirect()`.
- [ ] **Deactivation verified:** deactivated test user cannot log in, loses data access mid-session, and events appear in `security_logs`.
- [ ] **Super_admin login email alerts live** — you get notified on super_admin login (Phase 8 lighter item).

## 7. Email & Domain  `(Phase 7 · domain routing)`

- [ ] **Resend sending from verified `noreply@yourbuddyapp.com`** — test a real invite/reset email lands and renders branded.
- [ ] **Branded email templates render correctly** — invite, password reset, security alerts all look right in a real inbox (not just preview).
- [x] **Domain cutover complete** — `www.yourbuddyapp.com` is verified and serving
  production traffic on Vercel; apex `yourbuddyapp.com` 308-redirects to `www`
  (confirmed via Vercel dashboard and direct browser test). End-to-end smoke test
  passed on the live domain: login, password-reset email link, invite-link
  generation, and MFA/recovery redirect all confirmed working on `yourbuddyapp.com`.

## 8. Customer-Facing Surfaces  `(8F · 8H · onboarding)`

- [ ] **ToS published** at the agreed URL (Phase 8H) — includes data ownership, retention commitment, no-PHI clause.
- [ ] **Privacy Policy published** (Phase 8H) — data collected, Supabase US storage, RLS protection.
- [ ] **Onboarding flow walked end-to-end** — invite → signup → `/welcome` steps → 2FA enrollment → dashboard, as a brand-new manager would experience it.
- [ ] **First customer's lab provisioned correctly** — created with the right name, `org_id` set appropriately (NULL for single-lab), retention years confirmed, before the invite is sent.

---

## Final Sign-Off

- [ ] Every box above is checked on **production**.
- [x] Oakwood demo lab is intact and operational post-wipe (July 11) — login,
  inventory, activity log, members confirmed.
- [ ] A fresh token decode confirms clean claims.
- [ ] You can personally log in, hit the 2FA challenge, and reach `/super-admin`.

**Cleared for first customer onboarding:** ____________________ (date)
