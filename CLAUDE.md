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

- [ ] Document retention commitment in ToS / Privacy Policy (Phase 8H)
- [ ] Future: Automated retention cleanup job (NOT URGENT — storage cheap)
      Test extensively before enabling — deletion is irreversible.

#### 8C — Traceability Matrix (High Priority — Pending)
Create Google Sheet "Buddy Traceability Matrix" with columns:
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
- Set up Jest or Vitest + Supabase test client
- Integration tests for validation state machine (all 8 transitions)
- Integration tests for RLS scoping (cross-lab isolation, role gates)
- Unit tests for parseSmartBarcode() edge cases
- Unit tests for threshold fallback logic (item → lab default)
- GitHub Actions CI on push to main

#### 8E — Security Scanning (Pending)
- Snyk on GitHub (free tier covers open source) — npm CVE scans
- Enable Dependabot for automated dependency PRs
- Audit npm packages — confirm no abandoned libs

#### 8F — API Documentation (Pending)
- Document /api/feedback-notify in Swagger/OpenAPI or README
- JSDoc comments on parseSmartBarcode(), logActivity(),
  resolveCurrentUserLabId() — most auditor-scrutinized functions

#### 8G — Software Validation Plan (Pending)
1-2 page document: intended use, regulatory classification (NOT a
medical device), SDLC approach, validation strategy, known limitations
(ZXing barcode limits, no PHI), change control process.

#### 8H — Terms of Service & Privacy Policy (Pending)
- ToS: data ownership, 3-year retention, no PHI clause, SLA
- Privacy Policy: data collected, Supabase US storage, RLS protection
- Publish at yourbuddyapp.com/terms and /privacy before first customer

#### 8I — Pre-Customer Checklist (Pending)
- No console.log in production build
- No hardcoded lab_ids/user_ids anywhere
- Vercel build clean (zero warnings, zero errors)
- All env vars set correctly in production
- yourbuddyapp.com domain resolves correctly

#### 8J — Two-Factor Authentication ✅
- TOTP via Supabase MFA (max 1 factor per user)
- Mandatory for managers + org admins, optional for technicians
- Server-side enrollment endpoint (`/api/mfa/enroll`) handles ghost factor
  cleanup atomically using admin API
- AAL2-gated dashboard access for privileged roles
- Onboarding Step 4 embeds enrollment for new managers
- `/mfa-setup`, `/mfa-challenge`, dashboard gate, login flow all wired
- React Strict Mode double-mount guarded via `useRef` lock

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
```sql
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

---

## Security Architecture

### Current Security Score: 9.7/10
Production-grade for healthcare-adjacent B2B SaaS with no PHI.
Audit log immutability satisfies 21 CFR Part 11. Remaining 0.5/10
gap requires enterprise tooling (formal pen testing, SOC 2).

### Security Layers
| Layer | Implementation |
|-------|---------------|
| Passwords | Supabase Auth bcrypt, min 8 chars, mixed case + digits + symbols |
| Password reset | Email-based flow via /reset-password |
| Session enforcement | One active session per user (30s poll) |
| Database isolation | RLS on all 14 tables (activity_logs append-only) |
| Data scoping | JWT-based get_my_lab_id() + get_my_org_id() |
| Profile security | RLS enabled, email column removed |
| Transport | HTTPS via HSTS |
| Browser attacks | 6 security headers via vercel.json |
| API abuse | Upstash rate limiting (10 req/hr/IP) |
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
| super_admin | ✅ Supabase dashboard MFA (separate from app MFA) | Manual |
| org_admin | ✅ Mandatory | Login + dashboard gate |
| manager | ✅ Mandatory | Login + dashboard gate |
| technician | ⚪ Optional | Voluntary via Profile Settings |

#### AAL (Authenticator Assurance Level) model
- `aal1` = password verified only
- `aal2` = password + TOTP verified this session
- Managers + org admins must reach `aal2` to access `/dashboard`
- AAL is encoded in the JWT and read via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`

#### Gate order (NEVER REORDER)
On every dashboard load, in `checkSessionAndRole`:
1. **First:** if role is `manager` and `onboarding_complete = false` → `/welcome`
2. **Second:** if role is `manager`/`org_admin` AND not enrolled in 2FA → `/mfa-setup`
3. **Third:** if role is `manager`/`org_admin` AND enrolled AND AAL is `aal1` → `/mfa-challenge`
4. **Otherwise:** proceed to dashboard

Onboarding MUST run first because `/welcome` Step 4 handles 2FA enrollment internally.

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
- `/mfa-setup` — enrollment (QR + secret + 6-digit input). Uses `useRef` lock to prevent React Strict Mode double-invocation. Has guard: if already enrolled, redirects to `/dashboard`.
- `/mfa-challenge` — login TOTP verification. Redirects to `/mfa-setup` if not enrolled.
- `/welcome` Step 4 — enrollment inside onboarding. Auto-skips to Step 5 if already enrolled.

#### Rules (Never Break)
- Server-side enroll endpoint is the ONLY way to start enrollment — never call `supabase.auth.mfa.enroll()` directly from client code
- `/api/mfa/enroll` must derive `user_id` from the validated access token, never from request body
- Only `status = 'unverified'` factors may be deleted by the cleanup; verified factors are never touched
- React Strict Mode double-mount must be guarded with `useRef` on `/mfa-setup` (effect creates server-side state)
- Friendly name conflicts are handled by deleting unverified factors before enroll, not by appending timestamps
- Dashboard gate order: onboarding → setup → challenge → dashboard. Never reorder.

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
- Rate limiting must stay on all API routes (Upstash pattern)
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
- `listFactors()` from the client SDK hides unverified factors — use admin API (`admin.auth.admin.mfa.listFactors`) when you need to see them
- Never delete verified 2FA factors automatically — only `status = 'unverified'` can be cleaned up programmatically

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
| Attributable | user_id + role via JWT on every audit row | ✅ |
| Legible | Structured schema, TypeScript types | ✅ |
| Contemporaneous | Server-side timestamps on all inserts | ✅ |
| Original | Append-only audit log (RLS no UPDATE/DELETE) | ✅ |
| Accurate | Unique constraints, RLS, duplicate prevention | ✅ |
| Complete | 10 audit action types cover full lot lifecycle | ✅ |
| Consistent | All queries lab_id scoped, JWT role gates | ✅ |
| Enduring | COA 3yr, audit log configurable 1-10yr (default 3), records preserved indefinitely | ✅ |
| Available | Activity log tab with action type filters | ✅ |

### 21 CFR Part 11 Checklist
| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Computer-generated audit trail | logActivity() on all state changes | ✅ |
| Time-stamped records | Supabase server timestamps | ✅ |
| Immutable records | Append-only RLS on activity_logs | ✅ |
| Attributable records | user_id on every audit row | ✅ |
| Access controls | Role-based gates + RLS on all tables | ✅ |
| Audit trail for validation | Approved/Rejected/Archived logged | ✅ |
| Secure unique user IDs | Supabase Auth, one session per user | ✅ |

### Audit Log Rules (Never Break)
- activity_logs must NEVER have UPDATE or DELETE policy
- No admin UI button, scheduled job, or API may modify audit rows
- Only exception: full lab deletion (tenant wipe — must be documented)
- logActivity() must include: user_id, lab_id, action, item context, timestamp
- Audit rows written AFTER action succeeds, never speculatively

### Validation State Machine (Compliance-Critical)
The most compliance-critical logic. Must be deterministic.

Allowlist for open-to-bench (NEVER use blocklist):
- `not_required` → can open
- `approved` → can open
- `archived` → can open (docs filed, lot physically valid)
- Everything else → BLOCKED

### Software Validation Plan
- Document: [Link TBD — Phase 8G]
- Covers: intended use, SDLC, validation strategy, known limits
- Classification: NOT a medical device

### Traceability Matrix
- Document: [Link TBD — Phase 8C]
- Maps: Requirement → Feature → Code → Test → Status
- 10 requirements seeded

---

## Response Style

- **Mentor tone:** Explain decisions, not just code
- **Flag issues early:** Warn about RLS, auth, multi-tenancy risks
- **Tradeoffs first:** Briefly explain options before recommending
- **Healthcare context:** Prefer explicit auditable patterns over clever shortcuts
- **Python-to-TypeScript bridges:** Draw analogies to Python when helpful
