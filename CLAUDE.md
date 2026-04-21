# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Buddy Lab is a multi-tenant B2B SaaS lab inventory management system for cell therapy and research labs. It is healthcare-adjacent — accuracy, traceability, and audit trails are critical. It is part of a broader "Buddy" brand, so keep components modular and reusable.

**Tech stack:** Next.js 16, Tailwind v4, Supabase (auth + database + RLS), Shadcn/ui (New York style), TypeScript

---

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Run unit tests (lib/*.test.ts via Node --test)
```

---

## Architecture

### App Router structure

Uses Next.js App Router. Prefer server components; use `"use client"` only when interactivity is required.

- `/app/dashboard` — Main application (tabbed layout): Inventory, Analytics, Settings, Team Management, Feedback
- `/app/login` — Auth flows: manager sign-in, technician sign-in, lab registration
- `/app/register-lab` — Onboarding via one-time invite token
- `/app/super-admin` — Admin control panel (super_admin role only)
- `/components/ui` — Shadcn/ui primitives (do not modify directly)
- `/components/dashboard` — App-specific components (tables, forms, sidebar)
- `/lib/inventory-utils.ts` — Core business logic: barcode parsing, Supabase queries, expiry calculations
- `/database-scripts/supabase-copy.sql` — Full schema reference

### Multi-tenancy

**Every query and insert must be scoped to `lab_id`.** Row Level Security (RLS) is the enforcement layer in Supabase — never rely solely on application-level filtering. When touching any database operation:
1. Confirm `lab_id` is passed on inserts
2. Confirm RLS policies exist for that table
3. Flag if a query could accidentally return cross-tenant data

### Auth and roles

Three roles: `manager`, `technician`, `super_admin`. Role is stored in `profiles.role` and set via `raw_user_meta_data` on signup. A Supabase trigger `handle_new_user()` auto-creates the `profiles` row on signup.

Invitation flow: Lab managers register via a one-time `lab_invites` token, which creates the lab and sets `manager_key`/`tech_key`. Technicians later join using `tech_key`.

### Inventory data model (non-obvious)

- **`inventory_lots`** — Sealed/stored inventory. `quantity_type` is an enum: `"units_only"`, `"units_and_count"` (e.g., 5 boxes × 10 units). Use `totalUnitsFromInventoryRow()` in `lib/inventory-utils.ts` to normalize across both types.
- **`active_lots`** — Opened/in-use lots. Tracks both `working_expiry_date` (conservative stop-use date) and `actual_expiry_date` (manufacturer expiry).
- **Item status is computed, not stored** — "Expiring Soon", "Low Stock", etc. are derived at read time from `lab_settings` thresholds and today's date, not persisted.
- **`activity_logs`** — Audit trail. Every inventory mutation should write a corresponding log entry.

### Barcode parsing

`parseSmartBarcode()` in `lib/inventory-utils.ts` is a waterfall parser supporting HIBC, GS1-128, and plain Code 128 formats. This is compliance-critical — do not bypass it for raw barcode input.

---

## Coding Conventions

- Use TypeScript interfaces for all Supabase table shapes
- Always scope queries and inserts to `lab_id`
- Label any remaining dummy/hardcoded data clearly so it's easy to swap for real Supabase data

---

## Collaborator Context

James has an intermediate Python background and is actively building TypeScript, SQL, and web dev skills. When explaining decisions — especially around multi-tenancy, auth, and SQL — draw analogies to Python patterns where helpful. Explain the "why" behind architectural choices. Flag potential RLS, auth, and multi-tenancy issues early.
