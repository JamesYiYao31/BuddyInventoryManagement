# Buddy Inventory Management — Traceability Matrix

**Document purpose:** Maps each compliance-relevant requirement to the feature
that implements it, the code that enforces it, and how it is verified. This is
the connective tissue between Buddy's compliance claims and its actual system.

**Source of truth:** This markdown file, version-controlled in the repo, is the
canonical copy. Any Google Sheet export is a disposable presentation copy and
must be regenerated from this file — never maintained separately.

**Verification honesty:** Verification status reflects the *actual* current
state. Automated test coverage (Phase 8D) is not yet built, so most items are
verified by manual testing. Where automated tests are planned, this is noted
explicitly. This is an accurate and defensible position for a pre-launch,
solo-developed product; it doubles as the test-writing checklist for Phase 8D.

**Regulatory basis:** 21 CFR Part 11, ALCOA+, SDLC validation expectations.
Buddy is **not a medical device** and stores **no PHI**.

**Last reviewed:** June 2, 2026
**Maintained by:** James (sole developer)

---

## Matrix

| ID | Requirement | Feature | Code Location | How Verified | Status |
|----|-------------|---------|---------------|--------------|--------|
| REQ-001 | Lot tracking scoped to lab (no cross-tenant data access) | Multi-tenant RLS + `lab_id` scoping on all inventory queries | RLS policies on all 16 tables; `resolveCurrentUserLabId()` and `get_my_lab_id()` (JWT claim); every `inventory_lots` query includes `.eq("lab_id", labId)` in `lib/inventory-utils.ts` | Manual testing: logged in as members of two different labs, confirmed neither can see the other's lots. RLS enforced at DB layer, not app-only. | Verified (manual) — automated cross-lab isolation test planned in 8D |
| REQ-002 | COA must be submitted before lot validation (gating document order) | Validation state machine: `pending_coa` precedes `pending_validation` | `submitCOARecord()` and `submitLotValidation()` in `lib/inventory-utils.ts`; status flow advances `pending_coa → pending_validation → pending_approval` | Manual testing: attempted lot validation before COA on a both-required item; system held lot at `pending_coa` until COA submitted. | Verified (manual) — automated state-machine test planned in 8D |
| REQ-003 | Unapproved lots blocked from opening to bench | Open-to-bench **allowlist** (not blocklist) | `OPENABLE_VALIDATION_STATUSES = new Set(["not_required", "approved", "archived"])` and `canOpenInventoryLot()` in `components/dashboard/lot-in-use-table.tsx`; blocked lots rejected in both manual-select and barcode-scan paths | Manual testing: confirmed lots in `pending_coa`, `pending_validation`, `pending_approval`, `rejected` cannot be opened via dropdown or scanner; only allowlisted statuses appear/open. | Verified (manual) — automated allowlist test planned in 8D |
| REQ-004 | All validation actions logged with user + timestamp | Audit trail via `logActivity()` on every state change | `logActivity()` called in `submitCOARecord()`, `submitLotValidation()`, `approveLot()`, `rejectLot()` (with reason) in `lib/inventory-utils.ts`; writes to `activity_logs` with user, lab_id, action, lot context, server timestamp | Manual testing: performed each validation action, confirmed corresponding row appears in Activity Log tab with correct actor and timestamp. | Verified (manual) — automated audit-write test planned in 8D |
| REQ-005 | Duplicate lots prevented within a lab | Database unique constraint | `UNIQUE (lab_id, item_id, lot_number)` on `inventory_lots` table | Manual testing: attempted to add a second lot with the same item + lot number in the same lab; DB rejected with unique-constraint violation surfaced to user. | Verified (manual) — DB-level constraint (structurally enforced) |
| REQ-006 | FEFO (First Expired First Out) soft warning on lot open | FEFO soft-warning dialog comparing earlier-expiring approved lots | FEFO comparison + `handleOpenSuggestedFefoLot()` in `components/dashboard/lot-in-use-table.tsx`; compares only lots with `status = "In Storage"` and `validation_status` of `approved`/`not_required`; never hard-blocks | Manual testing: opened a later-expiring lot when an earlier-expiring approved lot existed; warning dialog offered the suggested lot, "Continue Anyway," and "Cancel." | Verified (manual) — soft warning by design (advisory, not enforced) |
| REQ-007 | Role-based access control (manager vs technician gates) | Render guards + RLS role checks + dashboard gate order | ValidationTab mounts only when `userRole === 'manager'` (render guard); JWT `user_role` claim drives RLS; super_admin/org_admin/manager/technician gating across dashboard routes | Manual testing: logged in as technician — Validation & COA tab not visible; logged in as manager — full access. Confirmed role gates at both render and data layers. | Verified (manual) — automated role-gate test planned in 8D |
| REQ-008 | One active session per user (second login kicks the first) | `active_sessions` token enforcement with 30s poll | `lib/active-session.ts`: `persistNewActiveSession()`, `verifyActiveSessionForUser()`, `sessionReplacedSignOut()`; 30s poll on dashboard + org-admin pages compares localStorage token to DB | Manual testing: logged into the same account from a second device; first session detected mismatch within poll interval and was signed out with the "session replaced" banner. | Verified (manual) — automated session-enforcement test planned in 8D |
| REQ-009 | Audit log is immutable (append-only) | Append-only RLS on `activity_logs` (no UPDATE, no DELETE policy) | `activity_logs` RLS: INSERT scoped to `lab_id = get_my_lab_id()`, SELECT lab-scoped + super_admin; **no UPDATE or DELETE policy exists** | Manual testing: attempted UPDATE and DELETE against `activity_logs` via client; both blocked by RLS. Satisfies 21 CFR Part 11 §11.10(e). | Verified (manual) — DB-level immutability (structurally enforced) |
| REQ-010 | COA / validation documents retained at least 3 years | Document retention commitment + indefinite preservation | `audit_log_retention_years` on `lab_settings` (default 3, CHECK 1–10); COA/validation files in private `coa-documents` storage bucket; no deletion job runs — records preserved indefinitely | Manual review: confirmed no cron/scheduled deletion exists; retention value is a stored commitment, and current behavior keeps all records indefinitely (over-retention is compliance-safe). | Verified (manual / documented commitment) — retention note to be reflected in ToS/Privacy (8H) |

---

## Notes on verification methods

- **"Verified (manual)"** — exercised by hand against the running application
  and confirmed to behave as specified. Legitimate verification for a
  pre-launch product; not yet covered by an automated regression test.
- **"DB-level / structurally enforced"** — the requirement is guaranteed by a
  database constraint or the *absence* of a policy (e.g. append-only logs),
  not by application logic that could regress silently.
- **"Documented commitment"** — a policy/retention promise rather than a code
  behavior; verified by confirming no contradicting mechanism exists.

## Phase 8D coverage map (the gap, made explicit)

The requirements marked "automated … test planned in 8D" are the regression
risks worth covering first when automated testing is built:

- REQ-001 cross-lab isolation (RLS scoping)
- REQ-002 validation state-machine order
- REQ-003 open-to-bench allowlist
- REQ-004 audit-write on each action
- REQ-007 role gates
- REQ-008 single-session enforcement

REQ-005 and REQ-009 are structurally enforced at the DB layer and are lower
regression risk, but a thin test asserting the constraint/missing-policy still
exists would be cheap insurance.

---

## Maintenance

Update this matrix whenever a compliance-relevant requirement, its
implementing code location, or its verification status changes. Re-export to
Google Sheets only when a presentation copy is needed; never edit the Sheet as
the primary record.
