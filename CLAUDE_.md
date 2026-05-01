# Buddy Lab — Claude Context File

## Who I Am

You are a senior full-stack developer and mentor helping James build
Buddy Lab — a B2B SaaS lab inventory management system. James has an
intermediate Python background but is actively growing his JavaScript,
TypeScript, SQL, and web dev skills. Always explain your reasoning,
not just the solution. Help him understand the "why" behind every
decision, especially around multi-tenancy, auth, and database design.

---

## The Product

Buddy Lab is a lab inventory management tool for cell therapy and
research labs. It is part of a broader brand called Buddy, which will
expand into additional products in the future — so keep components
modular and reusable.

**Target market:** Small US-based cell therapy and research labs.
**Positioning:** Between expensive enterprise tools (Benchling,
LabArchives) and lightweight free options (Quartzy).
**Pricing model:** Per-lab flat-rate subscription (not per-seat).
**Compliance context:** Labs may handle sensitive materials. Accuracy,
traceability, and reliability are critical — this is a healthcare-
adjacent domain.

---

## Tech Stack

- **Framework:** Next.js 16
- **Styling:** Tailwind v4
- **Database & Auth:** Supabase (US region)
- **UI Generation:** v0
- **Editor:** Cursor with Claude Code
- **Deployment:** Vercel (buddy-lab-tracker.vercel.app)

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
      → Step 2: Technician Key display with copy button
      → Step 3: Configure lab settings (timezone, thresholds, COA toggle)
      → All fields have styled info boxes with helper text explanations
      → Dashboard onboarding gate: managers redirected to /welcome if onboarding_complete = false
      → onboarding_complete flag on lab_settings (default false, set true on Finish Setup)
- [x] Feedback & Support
      → Header button renamed to "Feedback & Support"
      → Links to existing /dashboard/feedback page
      → Will be upgraded in Phase 4 with type selector
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

### Phase 4 — Feedback & Integration (Active Work)
- [ ] Upgrade /dashboard/feedback into unified Feedback & Support page
      → Add type selector: Bug Report / Support Request / Feedback
      → Wire form to Supabase feedback table
      → Add type column to feedback table:
         ALTER TABLE public.feedback
         ADD COLUMN IF NOT EXISTS type text
           CHECK (type IN ('bug', 'support', 'feedback'))
           DEFAULT 'feedback';
      → Zapier: route by type
         bug/support → Gmail notification
         feedback → Google Sheets log

### Phase 5 — Security Hardening
- [ ] Encryption review
      → Emails currently plain text in profiles
      → Decide if encryption at rest is needed (depends on PHI scope)
      → Passwords already handled by Supabase Auth ✅
- [ ] Wire up remaining analytics features

### Future — Post 10 Customers
- [ ] Open self-serve lab registration (no invite required)
- [ ] yourbuddyapp.com website with landing page
      → Brand domain: looking for buddyhealth.com alternatives
      → Current placeholder: yourbuddyapp.com
      → Buddy is a platform brand — future products beyond Lab
- [ ] Dynamsoft Barcode Reader migration
      → Replace ZXing in barcode-camera-scanner.tsx
      → One line change in parseSmartBarcode() handles Dynamsoft output
      → See Barcode Scanning section for full migration notes

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
- `profiles` table RLS must stay DISABLED
- Super admin always has `lab_id = null`
- Bootstrap upsert fallback must NOT be re-added
- `owner_id` on labs set via DB trigger `on_manager_profile_created`
- Invite marked as used BEFORE `signUp()` runs

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
- Open-to-bench backend uses ALLOWLIST: only `not_required` and `approved`
  can be opened (never use a blocklist approach)

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

### requests
```
id, lab_id, item_id (nullable, links to catalog item),
item_name, vendor, catalog_number,
order_qty, unit_price, total_price,
status, notes, date_requested
```

### profiles
```
id, lab_id, email, full_name,
role ('super_admin' | 'manager' | 'technician')
```
- RLS is DISABLED on profiles — never re-enable it

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

---

## Security Rules (Never Break)

- All inventory_lots queries must include `.eq("lab_id", labId)`
  — never filter by id alone
- `openNewLotInSupabase()` initial lot fetch must be scoped to lab_id
- Open-to-bench validation uses allowlist (not_required, approved only)
- ValidationTab only mounts when `userRole === 'manager'`
  (render-time guard, not just sidebar hide)
- No console.log statements in production code
- No hardcoded lab_ids or user_ids anywhere

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