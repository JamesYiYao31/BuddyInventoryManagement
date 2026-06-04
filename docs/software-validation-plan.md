# Buddy Inventory Management — Software Validation Plan

> **STATUS: OUTLINE / SKELETON — not yet written.** Section headers and
> one-line scope notes only. Fill in prose section by section. Target length:
> 1–2 pages when complete (Phase 8G).

**Document owner:** James (sole developer)
**Last updated:** June 2, 2026 (skeleton created)

---

## 1. Purpose & Scope
One line: what this document is (the validation plan for Buddy) and what system/version it covers.

## 2. Intended Use
One line: what Buddy is for — lab inventory & lot-validation tracking for small US cell therapy / research labs.

## 3. Regulatory Classification
One line: **NOT a medical device**; stores **no PHI**; built to be audit-ready for 21 CFR Part 11 + ALCOA+.

## 4. System Overview
One line: brief architecture summary — Next.js + Supabase (RLS multi-tenant), Vercel deployment, no PHI stored.

## 5. SDLC Approach
One line: how the software is developed — prompt-driven implementation in Cursor, build-then-test, CLAUDE.md as persistent context, GitHub version control.

## 6. Validation Strategy
One line: how requirements are verified — manual testing now, traceability matrix (8C) as evidence, automated tests (8D) planned post-launch.

## 7. Requirements & Traceability
One line: point to `docs/traceability-matrix.md` (REQ-001–REQ-010) as the requirement-to-code-to-verification record.

## 8. Known Limitations
One line: list the honest constraints — ZXing barcode limits (long GS1-128 / stacked on camera), no automated test coverage yet, no PHI by design.

## 9. Change Control Process
One line: how changes are managed — GitHub commits, Dependabot/Snyk for dependencies, major-version bumps reviewed manually, accepted risks in `npm-audit-exceptions.md`.

## 10. Security & Access Controls
One line: summary of controls — RLS on all tables, JWT role gates, 2FA on privileged roles, one-active-session, append-only audit log.

## 11. Backup & Recovery
One line: data backup posture + reference to `docs/break-glass-runbook.md` for emergency recovery.

## 12. Approval / Sign-off
One line: who reviewed and approved this plan, and date (you, as sole developer, for now).

---

### Notes for whoever fills this in
- Keep it to 1–2 pages. Auditors value clarity over volume.
- Sections 7, 9, and 11 should point to the existing repo docs rather than
  repeat them (traceability matrix, npm-audit-exceptions, break-glass runbook).
- Section 8 (Known Limitations) is the most important to be honest in —
  stating limitations plainly is a strength, not a weakness, in validation docs.
- Most content already exists in CLAUDE.md; this doc is largely a synthesis of
  what's there into auditor-facing language.
