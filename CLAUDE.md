# Buddy Inventory Management — Claude Context File

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
therapy and research labs. It is part of a broader brand called Buddy,
which will expand into additional products in the future — so keep
components modular and reusable.

**Target market:** Small US-based cell therapy and research labs.
**Positioning:** Between expensive enterprise tools (Benchling,
LabArchives) and lightweight free options (Quartzy).
**Pricing model:** Per-lab flat-rate subscription (not per-seat).
**Compliance context:** Labs may handle sensitive materials. Accuracy,
traceability, and reliability are critical — this is a healthcare-
adjacent domain. No PHI is stored — intentional product decision.

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
- **Rate Limiting:** Upstash Redis (@upstash/ratelimit, US-East-1)
- **Feedback Logging:** Google Sheets via service account

---

## Current Development Status

### Phase 1 — Complete ✅
- Multi-tenant architecture complete
- Role system: Lab Manager and Lab Technician
- All features scoped to `lab_id`
- Dynamic lab names everywhere
- Auth session polling + owner protection guard
- COA & Lot Validation full workflow implemented
- Audit trail for all validation actions
- Duplicate lot prevention (unique constraint + app-level guard)
- Bench block for unapproved lots
- Feedback table exists in Supabase ✅
- Passwords handled by Supabase Auth ✅

### Phase 2 — Complete ✅
- History tab in Validation & COA (archived lots, search, file access)
- Per-item threshold overrides (expiring_soon_days, urgent_days,
  low_stock_threshold, working_expiry_days)
- Global tech threshold permission toggle in lab_settings
- Reagent Usage Report (date filters, CSV, PDF export)
- Smarter Requests (auto-fill catalog number, save back to items)
- FEFO soft warning when opening later-expiring lots
- Camera barcode scanning (@zxing/browser, flip button, USB toggle)
- Plain lot number scan fix (fallback in parseSmartBarcode)
- Barcode scanner improved: TRY_HARDER hints, wider scan box, autofocus,
  torch support (Android), stacked barcode retry logic
- ZXing limits confirmed — Dynamsoft migration planned for when customers onboard
- Pre-deployment security audit complete
- Vercel deployment live ✅
- Mobile responsiveness complete (phone + tablet) ✅
- Tab URL persistence (?tab=inventory survives refresh) ✅
- Idle auto-logout (45min timeout, 2min warning dialog) ✅
- Buddy logo only in sidebar (text removed) ✅

### Phase 3 — Onboarding & Support ✅
- [x] Self-serve onboarding flow
      → 3-step welcome wizard at /welcome
      → Step 1: Welcome screen with lab name pill
      → Step 2: Editable Technician Key (custom values, no spaces, min 6 chars)
        with helper text encouraging customization
      → Step 3: Configure lab settings (timezone, thresholds, COA toggle)
      → All fields have styled info boxes with helper text explanations
      → Dashboard onboarding gate: managers redirected to /welcome if onboarding_complete = false
      → onboarding_complete flag on lab_settings (default false, set true on Finish Setup)
- [x] Feedback & Support
      → Header button renamed to "Feedback & Support"
      → Links to existing /dashboard/feedback page
- [x] Timezone UI
      → Auto-detect browser timezone on lab registration
      → Global timezone list in lib/timezones.ts (covers all major world regions)
      → Timezone selector in welcome wizard Step 3
      → Timezone card added as first card in lab settings tab
      → LAB_SETTINGS_DEFAULTS falls back to Intl.DateTimeFormat timezone
- [ ] Self-serve lab registration (open signup)
      → DEFERRED — invite-only model kept for first 10 customers
      → Super admin generates invite link manually
      → Revisit after 10 customers onboarded

### Phase 4 — Feedback & Integration ✅
- [x] Unified Feedback & Support page (/dashboard/feedback)
      → Three styled toggle buttons: ⚠️ Bug Report, 🙋 Support Request, 💬 Feedback
      → Default selection: Bug Report
      → Fields: type, title, description
      → Enter key submits (guards textarea + loading state)
      → Success banner + form reset on submit
      → Session expiry handled gracefully
- [x] API Route: /api/feedback-notify
      → Secured with x-webhook-secret header (401 if missing/wrong)
      → Fetches full_name from profiles, email from auth.users (admin client)
      → Fetches lab name from labs table
      → All types do both: Resend email + Google Sheets append
      → Email subject: [Buddy Inventory Management] New {Type}: {title}
      → Google Sheets row: Date | Type | Title | Description | Lab Name | Submitted By | Status
- [x] Infrastructure
      → Resend account (free tier)
      → Google Cloud service account for Sheets
      → Supabase webhook on feedback INSERT
      → Google Sheets "Buddy Lab Feedback Log" (Log + Summary tabs)

### Phase 5 — Security Hardening ✅
- [x] JWT Custom Claims Hook
      → custom_access_token_hook injects lab_id, org_id, and user_role into every JWT on login
      → Enabled in Supabase: Authentication → Hooks → Customize Access Token
      → Grants given to supabase_auth_admin for profiles table access
      → SET search_path = public + fully qualified table references required
- [x] get_my_lab_id() rewritten
      → Now reads from auth.jwt() instead of querying profiles table
      → Uses NULLIF to handle empty string claims: NULLIF(auth.jwt() ->> 'lab_id', '')::uuid
      → Eliminates circular RLS dependency permanently
- [x] RLS enabled on ALL tables (12/12)
      → profiles: 4 policies (select/update/insert/delete)
      → Super admin checks use auth.jwt() ->> 'user_role' = 'super_admin'
      → Lab scoping uses get_my_lab_id() which reads from JWT
      → No circular dependency anywhere
- [x] Legacy inventory table dropped
      → Replaced by items + inventory_lots + active_lots
- [x] email column removed from profiles table
      → Email stored securely in auth.users only
      → feedback-notify API route uses admin.auth.admin.getUserById() for email
      → profiles now contains: id, lab_id, org_id, full_name, role only
- [x] Vercel security headers (vercel.json in project root)
      → X-Content-Type-Options: nosniff
      → X-Frame-Options: DENY
      → X-XSS-Protection: 1; mode=block
      → Referrer-Policy: strict-origin-when-cross-origin
      → Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
      → Permissions-Policy: camera=(self), microphone=(), geolocation=()
      → Content-Security-Policy: allows self, Supabase, Resend only
- [x] API Rate Limiting
      → Upstash Redis (US-East-1) + @upstash/ratelimit
      → Sliding window: 10 requests per hour per IP
      → Applied to /api/feedback-notify
      → Returns 429 with RateLimit headers when exceeded
- [x] Vercel Preview Deployment Protection enabled
- [x] 2FA enabled on both Supabase and Vercel accounts

### Phase 6 — Organization Layer (In Progress)
- [x] Organizations table created with RLS
- [x] org_id added to labs, profiles, lab_invites
- [x] org_admin role added to profiles role constraint
- [x] JWT hook updated to inject org_id alongside lab_id and user_role
- [x] get_my_org_id() helper function created (JWT-based)
- [x] get_my_lab_id() updated with NULLIF for empty string safety
- [x] RLS policies for org layer (JWT-only, no circular dependencies)
- [x] labs policies rewritten to use JWT claims only (no profiles subquery)
- [x] Super admin org provisioning UI (Single Lab / Organization toggle)
- [x] Super admin redirects away from dashboard to /super-admin
- [x] handle_new_user trigger fixed (org_admin role + email removed + org_id)
- [x] Org admin signup flow via /register-lab?token=X
- [x] /org-admin dashboard (labs grid, member list, invite gen, revoke, promote/demote)
- [x] Login + dashboard redirects for org_admin role
- [x] Manager invite generation by org admin (per lab, one active per lab)
- [x] Revoke invite flow (revoked_at + revoked_by auditable)
- [x] Promote/demote within org labs (confirmation modal, JWT re-login note)
- [x] Labs UPDATE RLS policy added (was missing, caused silent save failures)
- [ ] Stripe + billing (org-level, 3-month trial, 7-day grace period)
- [ ] Website (yourbuddyapp.com)

### Phase 7 — Security & UX Hardening (In Progress)
- [x] Tech key — editable in onboarding Step 2 + lab settings card
      → Custom values allowed (no spaces, min 6 chars, special chars OK)
      → Case-sensitive matching (oakwood ≠ Oakwood)
      → Unique constraint with 23505 error handling
      → Helper text encouraging managers to customize
      → Enter-to-save on both input fields
- [x] One active session per user
      → active_sessions table (user_id PK, session_token, created_at)
      → RLS enabled (user_id = auth.uid())
      → Login upserts session token, stores in localStorage
      → 30-second poll checks token match on dashboard + org-admin
      → Second login kicks first device with amber banner
      → Voluntary sign out deletes row; replaced sign out preserves new session
      → lib/active-session.ts centralizes all session logic
- [x] Password strength enforcement
      → Supabase: min 8 chars, lowercase + uppercase + digits + symbols
      → lib/password-strength.ts shared utility
      → components/password-strength-checklist.tsx shared UI
      → Enforced on register-lab signup form
- [x] Password reset via email
      → Profile settings: "Send Password Reset Email" button (no inline fields)
      → /reset-password standalone page with strength checklist
      → supabase.auth.resetPasswordForEmail with redirectTo
      → Redirect URLs configured: localhost, Vercel, yourbuddyapp.com
- [x] Branded email templates
      → Confirm signup and Reset password HTML templates in Supabase
      → Buddy branding, dark theme, green CTA button
      → Contact support messaging (not "ignore this email")
- [x] SMTP via Resend
      → smtp.resend.com:465, custom SMTP enabled in Supabase
      → Dedicated API key for Supabase SMTP (separate from app key)
      → Using Supabase built-in email temporarily until domain DNS verifies
- [x] Domain setup — yourbuddyapp.com
      → Purchased via Cloudflare Registrar
      → Cloudflare zone activated (resolved nameserver mismatch issue)
      → Resend domain verified — MX, SPF, DKIM, DMARC all green
      → Sender switched from onboarding@resend.dev → noreply@yourbuddyapp.com
      → /api/feedback-notify uses branded sender
      → Supabase SMTP sender updated to noreply@yourbuddyapp.com
- [x] Supabase security notifications enabled
      → Password changed, email changed, MFA added/removed
- [x] Feedback icon updated (bug emoji → MessageSquareDiff from lucide-react)
- [x] Dashboard overview cards redesigned
      → 4 cards: Expired Lots, Urgent < X Days, Expiring < X Days, Low Stock
      → Pending Requests card removed
      → Cards use dynamic threshold labels from labSettings
      → Expandable with item details (max 5, "and X more")
      → Urgent and Expiring Soon check both storage AND bench lots
      → Click-to-navigate: storage → inventory, bench → lot in use
      → Colors consolidated: red (expired), amber (urgent), yellow (expiring), green (low stock)
- [x] Inventory badges — multiple badges per lot
      → Lots show ALL applicable badges simultaneously
      → Expired, Urgent, Expiring Soon, Low Stock evaluated independently
      → Per-item threshold overrides with lab settings fallback
- [x] Inventory expanded row shows active thresholds
      → "Thresholds: Urgent < X days · Expiring Soon < X days · Low Stock ≤ X units"
      → "(lab default)" label for values using fallback
- [x] Open-to-bench allowlist fix — archived lots can now be opened
      to bench after validation records are moved to history. Fixed in
      openNewLotInSupabase(), OPENABLE_VALIDATION_STATUSES, FEFO check,
      and helper text (4 locations)
- [x] Header bell notifications redesigned
      → hooks/use-bell-alerts.ts (separate hook, 60s auto-refresh, per-item thresholds)
      → hooks/use-lab-alerts.ts extracted for dashboard alert cards
      → Activity log action type filter (12 types, quick-select pills)
      → Zero quantity ghost lot bug fixed (app guard + DB constraint)
- [x] Super admin full features — /super-admin/labs/[id] and /super-admin/orgs/[id]
      detail pages, billing overview, role editing, tech key reset,
      invite revoke, trial extend, Stripe placeholder
- [x] profiles.created_at column added
      → Backfilled from auth.users for existing members
      → Joined date now shows in super admin lab/org member tabs
        and org admin member cards
- [x] Single-lab billing tab in /super-admin/labs/[id]
      → trial_starts_at and trial_ends_at columns added to labs table
      → computeLabTrialInfo helper falls back to created_at if columns null
      → Real UI with progress bar, days remaining, color coding
      → Matches org billing section styling
      → Disabled Manage Billing + "Stripe Coming Soon" badge
- [x] Forgot password on login page
      → "Forgot password?" link added below password field on Sign In view only
      → Modal opens with email field (pre-filled from login form)
      → Calls supabase.auth.resetPasswordForEmail with redirectTo /reset-password
      → Success message intentionally vague to prevent email enumeration
      → ESC key closes modal, Enter key submits
      → Branded reset email arrives from noreply@yourbuddyapp.com
- [x] /reset-password flow tested end-to-end
      → Email link → reset page → new password → redirect to login → sign in works
      → Password strength checklist enforces all rules before submit enabled
- [x] Test data cleanup
      → Deleted Organization Test 1 + 2
      → Deleted Lab 1, Lab 2, Lab 1 Test, Lab 2 Test
      → Deleted associated profiles, lab_settings, lab_invites
      → Production DB now clean of test data

### Phase 8 — Compliance Readiness (Target: End of June)
Goal: Make Buddy audit-ready for regulated US lab customers before
the first 10 customers onboard. Based on 21 CFR Part 11, ALCOA+,
and general SDLC validation standards for healthcare-adjacent SaaS.

#### 8A — Audit Log Immutability ✅
- [x] Append-only RLS policies on activity_logs table
      → Dropped legacy UPDATE/DELETE policies that allowed super_admin to modify
      → Dropped legacy SELECT/INSERT policies that used profiles subquery
      → New SELECT policy: lab members scoped to lab_id, super admin sees all
      → New INSERT policy: WITH CHECK (lab_id = get_my_lab_id())
      → No UPDATE policy — ever, for any role including super_admin
      → No DELETE policy — ever, for any role including super_admin
      → JWT-based (auth.jwt() ->> 'user_role'), no profiles subquery
      → Satisfies 21 CFR Part 11 §11.10(e) immutability requirement
      → Satisfies ALCOA+ "Original" data integrity principle

#### 8B — Audit Log Retention Policy
- [ ] Add audit_log_retention_years to lab_settings (default: 3)
      → Match the COA records retention policy (3 years from archived)
      → Display in lab settings tab so managers know their data commitment
      → Document in Terms of Service / Privacy Policy when ready
- [ ] Confirm activity_log rows are never soft-deleted or purged
      → No scheduled job, no admin UI button that touches activity_log
      → Only exception: lab deletion (full tenant wipe, documented)

#### 8C — Traceability Matrix (Priority: High)
- [ ] Create a Google Sheet: "Buddy Traceability Matrix"
      Columns: Requirement | Feature Description | Where in Code | How Verified | Status
      Seed with these core requirements:
      → REQ-001: Lot tracking scoped to lab (RLS + lab_id)
      → REQ-002: COA must precede lot validation (state machine order)
      → REQ-003: Unapproved lots blocked from bench (allowlist check)
      → REQ-004: All validation actions logged with user + timestamp
      → REQ-005: Duplicate lots prevented (unique constraint)
      → REQ-006: FEFO soft warning on lot open
      → REQ-007: Role-based access (manager vs technician gates)
      → REQ-008: One active session per user
      → REQ-009: Audit log immutable (append-only RLS)
      → REQ-010: COA documents retained 3 years
- [ ] Link traceability matrix in this CLAUDE.md once created

#### 8D — Automated Testing (Priority: High)
- [ ] Set up Jest + Supabase test client (or Vitest for Next.js)
- [ ] Write integration tests for validation state machine:
      → pending_coa → cannot open to bench (blocked)
      → pending_coa → COA uploaded → pending_validation
      → pending_validation → lot validation uploaded → pending_approval
      → pending_approval → manager approves → approved
      → pending_approval → manager rejects → rejected
      → approved → can open to bench (allowed)
      → not_required → can open to bench (allowed)
      → rejected → cannot open to bench (blocked)
- [ ] Write integration tests for RLS scoping:
      → Lab A user cannot read Lab B inventory_lots
      → Technician cannot access validation tab data
      → Super admin can read all labs
- [ ] Write unit tests for parseSmartBarcode() edge cases
- [ ] Write unit tests for threshold fallback logic (item → lab default)
- [ ] Add test run to CI (GitHub Actions on push to main)

#### 8E — Security Scanning
- [ ] Add Snyk to GitHub repo (free tier covers open source)
      → Scans npm dependencies for known CVEs
      → Runs on every PR automatically
      → Fix any high/critical findings before first customer
- [ ] Enable GitHub Dependabot for automated dependency PRs
- [ ] Review all npm packages AI suggested — confirm no abandoned libs

#### 8F — API Documentation
- [ ] Document all API routes in a Swagger/OpenAPI spec or README:
      → /api/feedback-notify (POST, webhook-secured, rate-limited)
      → Any future public or partner-facing routes
      → Internal: document expected headers, payloads, error codes
- [ ] Add JSDoc comments to all lib/ utility functions
      → parseSmartBarcode(), logActivity(), resolveCurrentUserLabId()
      → These are the most auditor-scrutinized functions

#### 8G — Software Validation Plan (Light Version)
- [ ] Write a 1-2 page Software Validation Plan document covering:
      → Product name and version
      → Intended use (lab inventory management, non-clinical decision support)
      → Regulatory classification (not a medical device — confirm this)
      → SDLC approach (iterative, AI-assisted, human-reviewed)
      → Validation approach (traceability matrix + automated tests + UAT)
      → Known limitations (ZXing barcode limits, no PHI stored)
      → Change control process (how updates are reviewed before deploy)
- [ ] Store in Google Drive, link here once done

#### 8H — Terms of Service & Privacy Policy
- [ ] Draft basic ToS for lab customers covering:
      → Data ownership (lab owns their data)
      → Data retention (3 years for audit records)
      → No PHI commitment (explicit clause)
      → Uptime / SLA expectations (honest for MVP)
- [ ] Draft Privacy Policy (required for any US business SaaS)
      → What data is collected (lab name, user name, email, inventory data)
      → How it is stored (Supabase US region)
      → How it is protected (RLS, encryption at rest via Supabase)
- [ ] Publish at yourbuddyapp.com/terms and /privacy before first customer

#### 8I — Clean Up & Pre-Customer Checklist
- [ ] Delete all test orgs, labs, and profiles from production DB
- [ ] Confirm no console.log statements in production build
- [ ] Confirm no hardcoded lab_ids or user_ids anywhere in codebase
- [ ] Run Vercel build locally — zero warnings, zero errors
- [ ] Confirm all environment variables set correctly in Vercel production
- [ ] Confirm Resend DNS (DKIM, SPF, DMARC) verified in Cloudflare
- [ ] Confirm yourbuddyapp.com domain resolves correctly

### Future — Post 10 Customers
- [ ] Open self-serve lab registration (no invite required)
- [ ] Dynamsoft Barcode Reader migration
      → Replace ZXing in barcode-camera-scanner.tsx
      → One line change in parseSmartBarcode() handles Dynamsoft output
      → See Barcode Scanning section for full migration notes
- [ ] Failed login attempt monitoring (Sentry or Datadog)
- [ ] Formal penetration testing before enterprise customers
- [ ] SOC 2 Type I assessment (when pursuing larger regulated lab contracts)

---

## Customer Types

Two customer types coexist in the same database:

**Single Lab** — existing model, unchanged
```
You (super_admin)
  └── Oakwood Lab (lab)
        ├── Manager
        └── Technicians
```

**Organization** — new model (Phase 6)
```
You (super_admin)
  └── City Blood Bank (organization)
        ├── Org Admin (oversees all labs, manages invites)
        ├── Research Lab → Manager → Technicians
        ├── Clinical Lab → Manager → Technicians
        └── QC Lab       → Manager → Technicians
```

Nullable `org_id` is the key — NULL means single-lab customer,
UUID means belongs to an organization. Single-lab customers are
completely unaffected by the org layer.

### Role Matrix
| Role | lab_id | org_id | Can access |
|------|--------|--------|-----------|
| super_admin | NULL | NULL | /super-admin only |
| org_admin | NULL | uuid | Org admin dashboard |
| manager | uuid | nullable | /dashboard |
| technician | uuid | nullable | /dashboard |

### Org Admin Capabilities
| Action | Org Admin |
|--------|-----------|
| See list of their labs | ✅ |
| See members per lab | ✅ |
| Generate manager invite (per lab) | ✅ |
| Revoke pending invites | ✅ |
| Promote/demote manager ↔ technician | ✅ |
| Remove members from lab | ❌ (manager only) |
| Create new labs | ❌ (super admin only) |
| Access inventory data | ❌ |
| Configure lab settings | ❌ |

### Provisioning Flow
**Single lab:** You create lab → send manager invite link → manager signs up
**Organization:** You create org + labs → send org admin invite → org admin signs up → org admin generates manager invites per lab → managers sign up

---

## Multi-Tenancy Architecture

Every query and insert must be scoped to the current user's `lab_id`.
Row Level Security (RLS) is the enforcement layer — never rely solely
on application-level filtering. When helping with any database
operation, always:
1. Confirm `lab_id` is being passed on inserts
2. Confirm RLS policies are in place for that table
3. Flag if a query could accidentally return cross-tenant data

Each lab is a fully isolated tenant. Lab managers and technicians
only ever see their own lab's data.

### Key Technical Rules (Never Break These)
- Always scope queries to `lab_id` via `resolveCurrentUserLabId()`
- Super admin always has `lab_id = null` and `org_id = null`
- Org admin always has `lab_id = null` and `org_id = <uuid>`
- Bootstrap upsert fallback must NOT be re-added
- `owner_id` on labs set via DB trigger `on_manager_profile_created`
- Invite marked as used BEFORE `signUp()` runs
- RLS is enabled on ALL tables including profiles — never disable it
- get_my_lab_id() reads from JWT (auth.jwt()), never from profiles table
- get_my_org_id() reads from JWT (auth.jwt()), never from profiles table
- Super admin checks use auth.jwt() ->> 'user_role', never a profiles subquery
- Labs RLS policies must never query profiles table — use JWT claims only

### JWT Claims Architecture
Every JWT token contains three custom claims injected at login:
- `lab_id` — the lab this user belongs to (null for super_admin and org_admin)
- `org_id` — the org this user belongs to (null for super_admin and single-lab users)
- `user_role` — 'manager' | 'technician' | 'org_admin' | 'super_admin'

These are set by `custom_access_token_hook` (Postgres function).
RLS policies read these claims directly — no database lookups needed.

Helper functions:
- `get_my_lab_id()` → `SELECT NULLIF(auth.jwt() ->> 'lab_id', '')::uuid`
- `get_my_org_id()` → `SELECT NULLIF(auth.jwt() ->> 'org_id', '')::uuid`

If a user's role or lab changes, they must log out and back in
for the new JWT claims to take effect.

**Critical:** When recreating custom_access_token_hook with CREATE OR REPLACE,
you must re-run the grants:
```sql
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

---

## Security Architecture

### Current Security Score: 9.5/10
The app is production-grade for a healthcare-adjacent B2B SaaS
with no PHI. Audit log immutability now satisfies 21 CFR Part 11.
Remaining gap (0.5/10) would require enterprise tooling
(formal pen testing, SOC 2).

### Security Layers
| Layer | Implementation |
|-------|---------------|
| Passwords | Supabase Auth bcrypt, min 8 chars, uppercase+lowercase+digits+symbols required |
| Password reset | Email-based reset flow via /reset-password page |
| Session enforcement | One active session per user (active_sessions table, 30s poll) |
| Database isolation | RLS on all 14 tables (including activity_logs as append-only) |
| Data scoping | JWT-based get_my_lab_id() + get_my_org_id() |
| Profile security | RLS enabled, email removed |
| Transport | HTTPS enforced via HSTS |
| Browser attacks | 6 security headers via vercel.json |
| API abuse | Upstash rate limiting (10 req/hr/IP) |
| Preview URLs | Vercel Authentication enabled |
| Account security | 2FA on Supabase + Vercel |
| Webhook | x-webhook-secret header validation |
| Email | Custom SMTP via Resend, branded templates, verified sender (noreply@yourbuddyapp.com) |
| Security alerts | Password/email change + MFA add/remove notifications enabled |
| Audit log immutability | activity_logs is append-only (no UPDATE/DELETE policies, JWT-based RLS) — 21 CFR Part 11 compliant |

### RLS Policy Pattern
Lab-scoped tables use:
```sql
USING (
  (auth.jwt() ->> 'user_role' = 'super_admin')
  OR (lab_id = get_my_lab_id())
)
```

Labs table uses JWT-only (no profiles subquery — avoids circular dependency):
```sql
USING (
  (auth.jwt() ->> 'user_role' = 'super_admin')
  OR (id = get_my_lab_id())
  OR (auth.jwt() ->> 'user_role' = 'org_admin' AND org_id = get_my_org_id())
)
```

### Environment Variables (Never expose these client-side)
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_WEBHOOK_SECRET
- RESEND_API_KEY
- GOOGLE_SERVICE_ACCOUNT_EMAIL
- GOOGLE_PRIVATE_KEY
- GOOGLE_SHEET_ID
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
should have the NEXT_PUBLIC_ prefix.

---

## Validation & COA Architecture

### Per-item flags (set at item creation)
- `requires_coa` → COA upload required before bench use
- `requires_lot_validation` → Lot Validation upload required
- Both, one, or neither can be true per item

### Validation Status Flow (inventory_lots.validation_status)
```
requires_coa only:
  pending_coa → tech uploads COA →
  approved (if require_coa_approval = false)
  pending_approval (if require_coa_approval = true) →
  manager approves → approved

requires_lot_validation only:
  pending_validation → tech uploads lot validation doc →
  pending_approval → manager approves/rejects →
  approved/rejected

requires both:
  pending_coa → tech uploads COA →
  pending_validation → tech uploads lot validation doc →
  pending_approval → manager approves/rejects →
  approved/rejected

archived = manager clicked "Move to History"
```

### Rules (Never Break These)
- COA must be submitted BEFORE lot validation (COA is the gating document)
- Lot Validation ALWAYS requires manager approval — never auto-approves
- COA auto-approval is controlled by `lab_settings.require_coa_approval`
- Lots with status `pending_coa`, `pending_validation`, `pending_approval`,
  or `rejected` are BLOCKED from Open to Bench
- Technicians cannot see the Validation & COA tab — manager only
- Open-to-bench backend uses ALLOWLIST: only `not_required`, `approved`,
  and `archived` can be opened (never use a blocklist approach)
- Archiving a lot's validation records (Move to History) does not block
  the physical lot from being opened to bench — archived means COA/validation
  docs are filed, not that the lot is invalid

### Who Does What
- **Technician:** uploads COA file, uploads Lot Validation file
  (in inventory expanded row)
- **Manager:** reviews files, sets pass/fail, approves/rejects,
  moves to history (in Validation & COA tab)

### Storage
- Bucket: `coa-documents` (private)
- Path pattern: `{lab_id}/{lot_id}/{timestamp}_{filename}`
- Used for both COA and Lot Validation documents
- Signed URLs generated lazily on click (1 hour TTL)
- Records retained for 3 years from archived date

---

## Database Schema Reference

### organizations (new — Phase 6)
```
id, name,
plan (text, default 'trial'),
trial_ends_at (timestamptz, default now() + 90 days),
created_at,
created_by (uuid → auth.users)
```
- RLS enabled — super admin full access, org admin sees own org only
- plan values: 'trial' | 'starter' | 'pro' | 'enterprise' (Stripe later)

### labs
```
id, name, tech_key, is_archived, archived_at, created_at, owner_id,
org_id (uuid, nullable → organizations),
trial_starts_at (timestamptz, default now()),
trial_ends_at (timestamptz, default now() + 90 days)
```
- org_id NULL = single-lab customer
- org_id uuid = belongs to an organization
- ON DELETE RESTRICT on org_id (can't delete org with active labs)
- trial_starts_at / trial_ends_at used by single-lab billing tab UI

### inventory_lots
```
id, lab_id, item_id, lot_number, expiry_date, received_date,
storage_location, quantity_type, units, unit_label, count,
count_label, notes, status, validation_status,
validation_archived_at (timestamptz, nullable)
```
- Unique constraint: `(lab_id, item_id, lot_number)`
- `validation_status` valid values:
  `not_required`, `pending_coa`, `pending_validation`,
  `pending_approval`, `approved`, `rejected`, `archived`
- Constraints:
  - `check_quantity_not_zero`: enforces count > 0 or units > 0
    depending on quantity_type
  - `inventory_lots_validation_status_check`: existing allowlist
    constraint on validation_status values

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
id, lab_id, lot_id, file_url, file_name,
lot_number, expiry_date, result, uploaded_by,
uploaded_at, notes
```

### lot_validation_records
```
id, lab_id, lot_id, previous_lot_number,
result, file_url, file_name,
submitted_by, submitted_at,
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
techs_can_edit_thresholds (boolean, default true)
```

### activity_logs
```
id, lab_id, created_at, user_name, user_initials,
action_type, item_name, lot_number, details
```
- RLS enabled — APPEND-ONLY (no UPDATE, no DELETE policies)
- SELECT: lab members scoped to lab_id, super admin sees all
- INSERT: lab_id = get_my_lab_id() (cannot forge logs for other labs)
- 21 CFR Part 11 compliant — immutability enforced at DB level
- Retention TBD (Phase 8B will add audit_log_retention_years setting)

### requests
```
id, lab_id, item_id (nullable, links to catalog item),
item_name, vendor, catalog_number,
order_qty, unit_price, total_price,
status, notes, date_requested
```

### profiles
```
id, lab_id, org_id, full_name,
role ('super_admin' | 'org_admin' | 'manager' | 'technician'),
created_at (timestamptz, default now())
```
- email column intentionally removed — stored in auth.users only
- RLS is ENABLED with policies
- Super admin has lab_id = NULL, org_id = NULL
- Org admin has lab_id = NULL, org_id = <uuid>
- Never query email from profiles — use admin.auth.admin.getUserById()
- created_at backfilled from auth.users.created_at for existing users

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
- Unique index: one active invite per lab (where used=false AND revoked_at IS NULL)
- org admin invites have lab_id = NULL, org_id = <uuid>
- manager invites have lab_id = <uuid>, org_id = nullable

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
- One row per user (PK enforces), upsert on login
- Second login overwrites token, first device gets kicked on next poll
- Voluntary sign out deletes row; session-replaced sign out does NOT delete
  (preserves the newer session)

### Storage bucket: coa-documents (private)
- Path: `{lab_id}/{lot_id}/{timestamp}_{filename}`

---

## Audit Trail

All these actions are logged via `logActivity`:
- `Added` — lot added to inventory
- `Submitted COA` — tech uploaded COA file
- `Submitted Lot Validation` — tech uploaded lot validation doc
- `Approved Lot` — manager approved
- `Rejected Lot` — manager rejected (includes reason)
- `Archived Lot` — manager moved to history
- `Opened` — lot moved to bench (logs actual item name, not "Item")
- `Used` — units deducted from active lot
- `Deleted from Storage` — lot deleted from inventory
- `Deleted from Bench` — lot deleted from active use

---

## Threshold Logic

Per-item thresholds override lab-wide defaults.
Fallback chain: item setting → lab_settings default

```typescript
const expiringSoonDays = item.expiring_soon_days
  ?? labSettings.expiringSoonDays
const urgentDays = item.urgent_days
  ?? labSettings.urgentDays
const lowStockThreshold = item.low_stock_threshold
  ?? labSettings.lowStockThreshold
```

`working_expiry_days` on items auto-calculates
`working_expiry_date` when a lot is opened:
`working_expiry_date = opened_date + working_expiry_days`
Tech can still manually override the date after auto-fill.

`techs_can_edit_thresholds` on `lab_settings` controls whether
technicians can set thresholds when creating or editing items.
Managers can always edit thresholds regardless of this setting.

---

## FEFO (First Expired First Out)

When a tech tries to open a lot to bench, the system checks if
another lot of the same item exists in storage with an earlier
expiry date and approved/not_required validation status.

If found → soft warning dialog with three options:
- "Open Suggested Lot Instead" → switches to earlier lot
- "Continue Anyway" → proceeds with original lot
- "Cancel" → nothing opens

Rules:
- Only compares lots with status = 'In Storage'
- Only suggests lots with validation_status = 'approved'
  or 'not_required'
- Never hard-blocks — always allows Continue Anyway

---

## Barcode Scanning

- Library: `@zxing/browser` + `@zxing/library`
- Component: `components/dashboard/barcode-camera-scanner.tsx`
- Supports: Code 128, GS1, HIBC, QR Code, EAN and most formats
- Parser: `parseSmartBarcode()` in `lib/inventory-utils.ts`
- Fallback: if parser returns empty lot, raw input = lot number
  (fixes plain typed lot numbers and simple Code 128)
- Camera: rear by default (`facingMode: { ideal: 'environment' }`)
- Flip button toggles between front and rear camera
- Camera stops completely when modal closes (controlsRef.stop()
  + stop all media tracks + set srcObject = null)
- 1-second cooldown prevents duplicate rapid scans
- USB Scanner / Camera toggle in both scan modals
- Works in: Inventory tab barcode modal + Lot in Use scan modal
- Requires HTTPS — shows fallback message on HTTP

### Known Barcode Scanning Limitations (ZXing)
- ZXing cannot reliably read long GS1-128 barcodes on mobile camera
- ZXing cannot read stacked double barcodes (only catches one)
- These are library limitations — tuning hints does not fix them
- Primary target device is iPad — camera scanning must work well

### Future: Dynamsoft Barcode Reader (when first customers onboard)
- Confirmed via demo: reads all lab label formats perfectly
- Reads stacked barcodes (two barcodes per frame simultaneously)
- Reads long GS1-128 instantly on iPad camera
- Used by real healthcare/lab software in production
- Free trial available, ~$10-15/month production cost
- Confirmed working at demo.dynamsoft.com/barcode-reader with real labels

### Dynamsoft Migration Notes (for when ready)
- Swap ZXing in `barcode-camera-scanner.tsx` for Dynamsoft SDK
- Add one line to `parseSmartBarcode()` to handle Dynamsoft output:
  `const trimmed = raw.trim().replace(/\{GS\}/g, "\x1d")`
  (`{GS}` is Dynamsoft's FNC1 separator — parser already handles `\x1d`)
- All other parser logic stays identical — no other changes needed

### USB Scanner Notes
- Zebra DS series confirmed in target labs — excellent GS1-128 support
- 2D imaging scanners (Honeywell Voyager, Zebra DS2208) can read
  stacked barcodes sequentially in one trigger pull
- Basic cheap USB scanners only catch one of two stacked barcodes
- USB Scanner toggle already exists in both scan modals

---

## Mobile & Tablet Responsiveness

### Breakpoints
- Phone: below sm (640px) → card layouts, no sidebar
- Tablet sm-md (640px-1024px) → table layouts, hamburger sidebar
- iPad Pro lg (1024px) → icon-only sidebar (w-16), collapsible right panel
- Desktop xl+ (1280px+) → full sidebar (w-64), right panel always visible

### Sidebar Behavior
- Mobile (below lg): hidden by default, hamburger opens slide-in overlay
- lg (1024px): icon-only (w-16), labels hidden, native tooltip on hover,
  license card hidden
- xl+ (1280px+): full sidebar (w-64) with icons and labels

### Content Offset
- Mobile: full width (no offset)
- lg: `lg:pl-16` (icon sidebar width)
- xl+: `xl:pl-64` (full sidebar width)

### Card Layouts (phone only, below sm)
- Inventory: item group cards with lot sub-cards, edit/delete/reorder
- Lot in Use: active lot cards with all fields stacked, deduct/delete
- Requests: request cards with status, catalog, qty, approve/edit/delete

### Right Panel (Global Search, Filter, Expiry Timeline)
- Hidden on mobile (`hidden lg:block`)
- Collapsible toggle button at lg breakpoint (`lg:flex xl:hidden`)
- Always visible at xl+

### Modal Behavior on Mobile
- All modals: `flex flex-col max-h-[90vh] overflow-hidden`
- Modal header: fixed, always visible
- Modal content: `overflow-y-auto flex-1` (scrollable)
- Modal footer (action buttons): fixed at bottom, always visible
- Modal padding: `p-4 sm:p-10` (reduced on mobile)

### Button Rows on Mobile
- Action button rows use `grid grid-cols-2 gap-2 sm:flex sm:gap-3`
- Each button: `w-full justify-center sm:w-auto`

---

## Tab URL Persistence

Active tab is synced to URL query param:
`/dashboard?tab=inventory`

Valid tab values:
`dashboard, inventory, lotinuse, requests, activitylog,
validation, analytics, labsharing, settings`

Implementation:
- Uses `useSearchParams()` to read tab on mount
- Uses `router.replace()` with `{ scroll: false }` to update URL
- All tab changes go through shared `handleNavigatePage()` handler
- Wrapped in `Suspense` boundary (Next.js 16 requirement)
- Survives page refresh, works with browser back/forward
- URLs are shareable and bookmarkable

---

## Idle Auto-Logout

Idle detection tracks: `mousemove, mousedown, keydown,
touchstart, scroll, click`

Timer flow:
- 43 minutes of inactivity → show warning dialog
- Warning dialog shows 2-minute countdown in m:ss format
- "Stay Logged In" → resets all timers, closes dialog
- "Log Out Now" → immediate signOut + redirect to /login
- Timer expires → auto signOut + redirect to /login

Warning dialog styling:
- Amber warning header with icon (urgency signal)
- Live countdown updates every second
- Dark overlay, rounded corners, matches app modal style
- z-index above all other content (z-[60])

Cleanup: all event listeners, timers, and intervals
removed on component unmount.

---

## One Active Session Per User

Each user account can only be logged in on one device at a time.
Second login wins — first session gets kicked.

### Architecture
- `active_sessions` table: user_id (PK), session_token, created_at
- Login: upsert token via ON CONFLICT (user_id) DO UPDATE
- Token stored in localStorage as `buddy_session_token`
- 30-second poll on dashboard + org-admin checks token match
- Mismatch → `sessionReplacedSignOut()` → /login?reason=session_replaced

### Sign Out Patterns (lib/active-session.ts)
- `voluntarySignOut(userId)` — DELETE active_sessions row + clear
  localStorage + supabase.auth.signOut()
- `sessionReplacedSignOut(router)` — clear localStorage +
  supabase.auth.signOut() + redirect (does NOT delete row —
  preserves the newer session)
- All sign out paths in the app use these centralized functions

### Session Replaced Banner
- /login reads ?reason=session_replaced query param
- Amber warning banner: "You were signed out because your account
  was logged in from another device."
- Distinct from invalid credentials error styling

---

## Password Reset Flow

Password changes are handled via email link, not inline fields.

### Flow
1. User clicks "Send Password Reset Email" in Profile Settings
2. `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
3. Email arrives with branded Buddy template
4. Link opens /reset-password page
5. User enters new password + confirm with strength checklist
6. `supabase.auth.updateUser({ password })` → redirect to /login

### Password Strength Rules
- Min 8 characters, lowercase, uppercase, digit, special character
- Shared utility: lib/password-strength.ts
- Shared UI: components/password-strength-checklist.tsx
- Enforced on: /register-lab signup + /reset-password page
- Green CheckCircle2 when met, red XCircle when not

### Redirect URLs (Supabase → Authentication → URL Configuration)
- http://localhost:3000/reset-password
- https://buddy-lab-tracker.vercel.app/reset-password
- https://yourbuddyapp.com/reset-password

---

## Dashboard Overview Cards

Four expandable KPI cards on the dashboard home tab:

### Cards
1. **Expired Lots** (red) — past expiry, storage + bench
2. **Urgent < X Days** (amber) — within urgent_days, storage + bench
3. **Expiring < X Days** (yellow) — between urgent_days and
   expiring_soon_days, storage + bench
4. **Low Stock Items** (green) — total units ≤ threshold, storage only

### Behavior
- Click to expand/collapse (one at a time)
- Expanded list shows max 5 items with "and X more"
- Per-item thresholds with lab settings fallback
- Urgent and Expiring Soon never overlap
- Bench lots use lab-wide thresholds (no item link)
- Click item row → navigate to inventory or lot in use tab
- Card labels use dynamic values from labSettings

---

## Bell Notifications Architecture

### Hook: hooks/use-bell-alerts.ts
Separate from useLabAlerts — owns its own Supabase queries.
Refreshes every 60 seconds automatically.
Accepts userRole to gate manager-only queries at fetch time.
Returns: pendingApprovals, requestsPending, orderedNotReceived,
benchExpiring, outOfStock, totalCount, isLoading

### Categories (in display order)
1. **Pending Approvals** (manager only)
   → `inventory_lots` WHERE `validation_status` IN
     (`pending_approval`, `pending_coa`)
   → Navigates to `?tab=validation`

2. **Requests Awaiting Approval** (manager only)
   → `requests` WHERE `status = 'pending'`
     AND `date_requested <= now() - 3 days`
   → Navigates to `?tab=requests`

3. **Ordered Not Yet Received** (all roles)
   → `requests` WHERE `status = 'ordered'`
   → Navigates to `?tab=requests`

4. **Bench Expiry Today/Tomorrow** (all roles)
   → `active_lots` WHERE `working_expiry_date`
     BETWEEN today AND today + 1 day
   → Navigates to `?tab=lotinuse`

5. **Out of Stock** (all roles)
   → items with zero total units across all
     `inventory_lots` WHERE `status = 'In Storage'`
   → Navigates to `?tab=inventory`

### Rules (Never Break These)
- Manager-only categories gated at BOTH fetch time and render time
- Bell uses `router.replace()` for all navigation (not `router.push()`)
- Badge hidden when totalCount = 0 or while loading
- Badge display capped at 99+
- Max 20 rows in dropdown, then "and X more alerts"
- Empty state: checkmark icon + "No alerts right now"

---

## Coding Conventions

- Prefer **server components** unless client interactivity is needed
- Keep components **modular and reusable** across future Buddy products
- Explain SQL and Supabase-specific concepts clearly — James is
  still building SQL fluency
- Always scope queries and inserts to `lab_id`
- Use TypeScript types/interfaces for Supabase table shapes
- Never rely solely on app-level filtering — RLS is the enforcement layer
- Empty threshold fields save as NULL, not 0
- Signed URLs generated lazily on click, never on page load
- Camera must stop completely when modal closes
- ESC key closes all modals (useEffect with cleanup return)
- `router.replace()` not `router.push()` for tab URL updates
- Never query email from profiles — always use auth.users via admin client

---

## Security Rules (Never Break)

- All inventory_lots queries must include `.eq("lab_id", labId)`
  — never filter by id alone
- `openNewLotInSupabase()` initial lot fetch must be scoped to lab_id
- Open-to-bench validation uses allowlist (not_required, approved, archived only) — never use a blocklist approach
- ValidationTab only mounts when `userRole === 'manager'`
  (render-time guard, not just sidebar hide)
- No console.log statements in production code
- No hardcoded lab_ids or user_ids anywhere
- Never add email column back to profiles — use auth.users
- Never disable RLS on any table including profiles
- Never rewrite get_my_lab_id() to query profiles — must use auth.jwt()
- Never rewrite get_my_org_id() to query profiles — must use auth.jwt()
- Never expose service role key or other secrets with NEXT_PUBLIC_ prefix
- Email change is blocked for technicians by design — must be done by manager
  (security anchor — prevents account hijacking via compromised email access)
- Rate limiting must stay on all API routes — use Upstash pattern
- Never write labs RLS policies that query profiles table — use JWT claims only
- get_my_lab_id() and get_my_org_id() must use NULLIF to handle empty string claims
- Super admins must not access /dashboard — redirect to /super-admin only
- Org admins have no lab_id — they must never be scoped to inventory queries
- Never add UPDATE or DELETE policies to activity_logs table
  — append-only is enforced and required for 21 CFR Part 11
- Never write activity_logs RLS policies that query profiles
  — must use auth.jwt() ->> 'user_role' for super admin checks

---

## Response Style

- **Mentor tone:** Explain decisions, not just code
- **Flag issues early:** Warn about potential problems before they
  happen, especially around RLS, auth, and multi-tenancy
- **Tradeoffs first:** When multiple approaches exist, briefly explain
  the tradeoff before recommending one
- **Healthcare context:** Accuracy and traceability matter — prefer
  explicit, auditable patterns over clever shortcuts
- **Python-to-TypeScript bridges:** When helpful, draw analogies to
  Python patterns James already knows

---

## Modal UX Conventions (apply to all modals)

### Enter Key Submission
- Every modal with a primary action (Save, Submit, Confirm) must support Enter key submission
- Use a `useEffect` with a `keydown` listener firing the primary handler on `event.key === 'Enter'`
- Guard: skip if `document.activeElement?.tagName === 'TEXTAREA'` (multi-line fields)
- Guard: only fire when the modal's open state is true
- Clean up listener on modal close and component unmount
- ESC key close behavior must always be preserved alongside this

### Android Back Button (Mobile)
- When any modal opens, push a dummy history entry:
  `window.history.pushState(null, '', window.location.href)`
- Listen for `popstate` and close the modal instead of allowing browser navigation
- Full cleanup of popstate listener on modal close and component unmount
- Prevents back button from navigating to login page or previous route while modal is open

---

## Compliance Architecture

### Regulatory Context
Buddy targets US-based cell therapy and research labs. Compliance
posture is healthcare-adjacent — not a medical device, no PHI stored,
but must be audit-ready for labs operating under:
- 21 CFR Part 11 (FDA electronic records & signatures)
- ALCOA+ data integrity principles (GxP standard)
- CLIA (if clinical labs onboard)
- General SDLC validation expectations from regulated customers

### ALCOA+ Compliance Status
| Principle | Implementation | Status |
|-----------|---------------|--------|
| Attributable | Every audit action stores user_id + role via JWT | ✅ |
| Legible | Structured schema, TypeScript types, human-readable action types | ✅ |
| Contemporaneous | Supabase server-side timestamps on all inserts | ✅ |
| Original | Append-only audit log (RLS: no UPDATE/DELETE, JWT-based) | ✅ |
| Accurate | Unique constraints, RLS scoping, duplicate lot prevention | ✅ |
| Complete | 10 audit action types cover full lot lifecycle | ✅ |
| Consistent | All queries lab_id scoped, JWT-enforced role gates | ✅ |
| Enduring | COA records 3 years, audit log retention TBD | Phase 8B |
| Available | Activity log tab with 12 action type filters | ✅ |

### 21 CFR Part 11 Checklist
| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Computer-generated audit trail | logActivity() on all state changes | ✅ |
| Time-stamped records | Supabase server timestamps | ✅ |
| Immutable records | Append-only RLS on activity_logs (no UPDATE/DELETE policies anywhere) | ✅ |
| Attributable records | user_id on every audit row | ✅ |
| Access controls | Role-based gates, RLS on all tables | ✅ |
| Audit trail for validation actions | Approved/Rejected/Archived logged | ✅ |
| Secure, unique user IDs | Supabase Auth, one session per user | ✅ |

### Audit Log Rules (Never Break These)
- activity_log table must NEVER have an UPDATE RLS policy
- activity_log table must NEVER have a DELETE RLS policy
- No admin UI button, scheduled job, or API route may modify audit rows
- Only exception: full lab deletion (tenant wipe) — must be documented
- logActivity() must always include: user_id, lab_id, action, item context, timestamp
- Audit rows must be written AFTER the action succeeds — never speculatively

### Validation State Machine (Core Compliance Logic)
The validation flow is the most compliance-critical logic in the app.
The state machine must be deterministic — Input A always produces Output B.
This is what makes the system audit-ready and AI-safe for future 2.0.

Allowlist for open-to-bench (never use blocklist):
- `not_required` → can open
- `approved` → can open
- `archived` → can open (docs filed, lot is physically valid)
- Everything else → BLOCKED

### Software Validation Plan
- Document: [Link TBD — Phase 8G]
- Covers: intended use, SDLC approach, validation strategy, known limitations
- Classification: Not a medical device — inventory management tool only

### Traceability Matrix
- Document: [Link TBD — Phase 8C]
- Maps: Requirement → Feature → Code location → Test case → Status
- Minimum 10 requirements seeded (see Phase 8C for full list)