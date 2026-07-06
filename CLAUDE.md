# Buddy Inventory Management — Claude Context File

## Recent Sessions

### Session: June 16, 2026 (latest) — Doc-Accuracy Corrections: SVP v1.1, Table Count 14→16, RLS Re-verify
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
  - enroll route header says 10/hr but the live limit is 100/hr (has a revert-TODO).
  - feedback-notify email also includes the submitter's email address (doc omits it).
  - super_admin / org_admin recovery-code redemptions produce no audit
    record — logMfaRecoveryActivity() exits early when lab_id is null.
    Fix requires a non-lab-scoped security_logs table (planned). Deferred
    until security log split is implemented. Flagged by security audit
    July 2026.

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
    verified at buddy-lab-tracker.vercel.app.
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
- **Also verify (future):** recovery-code REDEEM route is rate-limited (Upstash),
  not just the login route — failed-redeem log lines in the screenshot are
  correct behavior, but brute-force should be stopped at the rate limiter well
  before it generates log volume.

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
  Test tenants (TestLab, TestLab123, TestOrg, TestLabinOrg) ARCHIVED, not
  wiped — true tenant wipe (cascades inventory/audit) deferred to 8I
  pre-customer pass; verify lab_id FK cascade chain before ever running it.
  Note: deleting tonight's org_admin tester means re-testing the org-admin
  gate requires provisioning a fresh org + org_admin via invite flow.
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
- **Deployment:** Vercel (buddy-lab-tracker.vercel.app)
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
Done June 16, 2026.
- `docs/api-documentation.md` documents 5 of the 6 API routes
  (feedback-notify, mfa/enroll, recovery-codes/generate,
  recovery-codes/redeem, recovery-elevation-status): purpose, caller,
  auth, rate limit, request/response.
  super-admin/user-email route deferred — tracked in api-doc cleanup pass.
- JSDoc added on the three most auditor-scrutinized functions in
  `lib/inventory-utils.ts`: parseSmartBarcode(), logActivity(),
  resolveCurrentUserLabId(). The resolveCurrentUserLabId() block was corrected to
  state it queries `profiles` (not the JWT) and cross-references get_my_lab_id().
- Doc reflects the post-cleanup redeem route (DB-row elevation model, no
  refreshSession flag, grantRecoveryElevation helper) — see June 16 session above.

#### 8G — Software Validation Plan ✅
Done June 16, 2026. `docs/software-validation-plan.md` (BIM-SVP-001 v1.1) —
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
- Remaining: fill real last name (Author field + revision table) before export.

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

### JWT Claims Architecture
Every JWT contains 3 custom claims injected at login by
`custom_access_token_hook` (Postgres function):
- `lab_id` — null for super_admin and org_admin
- `org_id` — null for super_admin and single-lab users
- `user_role` — 'manager' | 'technician' | 'org_admin' | 'super_admin'

Helpers:
- `get_my_lab_id()` → `SELECT NULLIF(auth.jwt() ->> 'lab_id', '')::uuid`
- `get_my_org_id()` → `SELECT NULLIF(auth.jwt() ->> 'org_id', '')::uuid`

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
- profiles RLS: ENABLED (verified June 16, 2026, pg_class.relrowsecurity = true).
  Public-schema tables: 16 total, RLS enabled on all (verified June 16, 2026 in
  Supabase). Never disable. Supersedes any note claiming it should be disabled.

### Security Layers
| Layer | Implementation |
|-------|---------------|
| Passwords | Supabase Auth bcrypt, min 8 chars, mixed case + digits + symbols |
| Password reset | Email-based flow via /reset-password |
| Session enforcement | One active session per user (30s poll) |
| Database isolation | RLS on all 16 tables (activity_logs append-only) |
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

---

## Database Schema Reference

### organizations
```
id, name,
plan (text, default 'trial'),
trial_ends_at (timestamptz, default now() + 90 days),
created_at, created_by (uuid → auth.users)
```
- RLS enabled — super admin full access, org admin sees own org
- plan: 'trial' | 'starter' | 'pro' | 'enterprise' (Stripe later)

### labs
```
id, name, tech_key, is_archived, archived_at, created_at, owner_id,
org_id (uuid, nullable → organizations),
trial_starts_at (timestamptz, default now()),
trial_ends_at (timestamptz, default now() + 90 days)
```
- org_id NULL = single-lab customer; uuid = belongs to org
- ON DELETE RESTRICT on org_id (can't delete org with active labs)
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

### lot_validation_records
```
id, lab_id, lot_id, previous_lot_number, result,
file_url, file_name, submitted_by, submitted_at,
approved_by, approved_at, rejection_reason, notes
```

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
- 21 CFR Part 11 compliant — DB-level immutability

### requests
```
id, lab_id, item_id (nullable), item_name, vendor, catalog_number,
order_qty, unit_price, total_price, status, notes, date_requested
```

### profiles
```
id, lab_id, org_id, full_name,
role ('super_admin' | 'org_admin' | 'manager' | 'technician'),
created_at (timestamptz, default now())
```
- email column removed — stored in auth.users only
- RLS enabled
- Never query email from profiles — use `admin.auth.admin.getUserById()`

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

### feedback
```
id, user_id, lab_id, type ('bug' | 'support' | 'feedback'),
title, description, created_at
```

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

### Storage bucket: coa-documents (private)
Path: `{lab_id}/{lot_id}/{timestamp}_{filename}`

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
- Rate limiting must stay on all API routes (Upstash pattern) (exception: recovery-elevation-status has no limiter by design — it is called on every gate evaluation; super-admin/user-email now has a 20/hr limiter added July 2026)
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
| Complete | 10+ audit action types covering the full lot lifecycle, plus MFA recovery events (MFA Recovery Code Redeemed / Redeem Failed) written by logMfaRecoveryActivity() — pending separation into a dedicated security log | ✅ |
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
- Only exception: full lab deletion (tenant wipe — must be documented)
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
- Document: docs/software-validation-plan.md (BIM-SVP-001 v1.1 — COMPLETE)
- Covers: intended use, SDLC, validation strategy, known limits
- Classification: NOT a medical device

### Traceability Matrix
- Document: docs/traceability-matrix.md
- Maps: Requirement → Feature → Code → Test → Status
- 10 requirements seeded

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
