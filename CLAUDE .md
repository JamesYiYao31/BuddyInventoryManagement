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

### Active work (Phase 2)
- [ ] History tab — 30 day display, 3 year file retrieval for COA/validation docs
- [ ] Reviewed flow for COA (manager reviews file → clicks Reviewed → moves to history)
- [ ] Vercel deployment
      → Environment variables setup
      → Redirect URLs for Supabase Auth
      → Test production build
- [ ] Self-serve onboarding flow
      → Welcome screen after first login
      → Guide manager to set Manager Key and Tech Key
      → Prompt to configure lab settings
- [ ] Lab Settings UI page
      → Timezone, thresholds, COA approval toggle
- [ ] Add support link / Contact Support (email or chat widget)
- [ ] Wire up feedback/bug report UI form
      → Supabase → Google Sheets or Gmail via Zapier
- [ ] Encryption review
      → Emails currently plain text in profiles
      → Decide if encryption at rest is needed (depends on PHI scope)

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
- `requires_lot_validation` → Lot Validation upload required before bench use
- Both, one, or neither can be true per item

### Validation Status Flow (inventory_lots.validation_status)
```
requires_coa only:
  pending_coa → tech uploads COA →
  approved (if require_coa_approval = false)
  pending_approval (if require_coa_approval = true) → manager approves → approved

requires_lot_validation only:
  pending_validation → tech uploads lot validation doc →
  pending_approval → manager approves/rejects → approved/rejected

requires both:
  pending_coa → tech uploads COA →
  pending_validation → tech uploads lot validation doc →
  pending_approval → manager approves/rejects → approved/rejected

archived = manager clicked "Move to History"
```

### Rules (Never Break These)
- COA must be submitted BEFORE lot validation (COA is the gating document)
- Lot Validation ALWAYS requires manager approval — never auto-approves
- COA auto-approval is controlled by `lab_settings.require_coa_approval`
- Lots with status `pending_coa`, `pending_validation`, `pending_approval`,
  or `rejected` are BLOCKED from Open to Bench
- Technicians cannot see the Validation & COA tab — manager only

### Who Does What
- **Technician:** uploads COA file, uploads Lot Validation file
  (in inventory expanded row)
- **Manager:** reviews files, sets pass/fail, approves/rejects,
  moves to history (in Validation & COA tab)

### Storage
- Bucket: `coa-documents` (private)
- Path pattern: `{lab_id}/{lot_id}/{timestamp}_{filename}`
- Used for both COA and Lot Validation documents
- Signed URLs with 1 year expiry for file access

---

## Database Schema Reference

### inventory_lots
```
id, lab_id, item_id, lot_number, expiry_date, received_date,
storage_location, quantity_type, units, unit_label, count,
count_label, notes, status, validation_status
```
- Unique constraint: `(lab_id, item_id, lot_number)`
- `validation_status` valid values:
  `not_required`, `pending_coa`, `pending_validation`,
  `pending_approval`, `approved`, `rejected`, `archived`

### items
```
id, lab_id, name, vendor, vendor_sku,
requires_coa (boolean, default false),
requires_lot_validation (boolean, default false)
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
lab_id, require_coa_approval (boolean, default false)
```

### Storage bucket: coa-documents (private)
- Path structure: `{lab_id}/{lot_id}/{timestamp}_{filename}`

---

## Audit Trail

All these actions are logged via `logActivity`:
- `Added` — lot added to inventory
- `Submitted COA` — tech uploaded COA file
- `Submitted Lot Validation` — tech uploaded lot validation doc
- `Approved Lot` — manager approved
- `Rejected Lot` — manager rejected (includes reason)
- `Archived Lot` — manager moved to history
- `Opened` — lot moved to bench
- `Used` — units deducted from active lot
- `Deleted from Storage` — lot deleted from inventory
- `Deleted from Bench` — lot deleted from active use

---

## Coding Conventions

- Prefer **server components** unless client interactivity is needed
- Keep components **modular and reusable** across future Buddy products
- Explain SQL and Supabase-specific concepts clearly — James is
  still building SQL fluency
- Always scope queries and inserts to `lab_id`
- Use TypeScript types/interfaces for Supabase table shapes
- Never rely solely on app-level filtering — RLS is the enforcement layer

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
