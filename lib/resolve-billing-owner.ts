import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Single source of truth for "who owns billing for this caller".
 *
 * Business model (settled):
 * - A standalone lab pays for itself; its manager may purchase and manage.
 * - An org pays ONE subscription covering all its labs.
 * - Managers and technicians inside an ORG lab may SEE the plan but may never
 *   purchase or manage billing. Only the org_admin may.
 *
 * Both Stripe routes previously derived ownership inline from role alone and
 * keyed managers on profiles.lab_id, which can never match an org-owned
 * billing_accounts row (those carry lab_id NULL by CONSTRAINT
 * billing_owner_exactly_one). See docs/audits/2026-07-26-billing-resolution-audit.md.
 *
 * FAIL CLOSED: every Supabase read below is error-checked, and a failed read is
 * treated exactly like an empty one — both deny. No path returns a purchasable
 * owner ("lab" | "org") without a successful read that positively proves it.
 */

export type BillingDenialCode =
  /** manager/technician inside an org lab — the org_admin owns billing */
  | "org_managed_billing"
  /** technician in a standalone lab, super_admin, or an unknown role */
  | "role_not_permitted"
  /** missing lab_id / org_id, missing profile, missing lab, or a failed read */
  | "profile_incomplete"

export type BillingOwner =
  | { kind: "lab"; labId: string }
  | { kind: "org"; orgId: string }
  | { kind: "denied"; code: BillingDenialCode; message: string }

const DENIAL_MESSAGES: Record<BillingDenialCode, string> = {
  org_managed_billing:
    "Billing for this lab is managed by your organization. Ask your organization administrator to make changes.",
  role_not_permitted: "You don't have permission to manage billing.",
  profile_incomplete:
    "Your account is not fully set up for billing. Please contact support.",
}

function deny(
  userId: string,
  role: string | null,
  code: BillingDenialCode,
  reason: string,
): BillingOwner {
  const line = `[resolveBillingOwner] denied user=${userId} role=${role ?? "unknown"} code=${code} reason=${reason}`
  if (code === "profile_incomplete") {
    console.error(line)
  } else {
    console.warn(line)
  }
  return { kind: "denied", code, message: DENIAL_MESSAGES[code] }
}

/**
 * Resolves the billing owner for an already-authenticated user.
 *
 * Everything is derived from `userId` — the id taken from a verified access
 * token by the caller. No lab id, org id, or role is ever accepted from a
 * request body or query string, so the service-role client below cannot be
 * steered at another tenant's rows: both lookups are keyed on ids the server
 * read for this user (profiles.id = userId, then labs.id = that profile's own
 * lab_id).
 *
 * Callers must handle `kind: "denied"` explicitly — that is why this returns a
 * discriminated union rather than a nullable owner that is easy to forget.
 */
export async function resolveBillingOwner(
  userId: string,
  client?: SupabaseClient,
): Promise<BillingOwner> {
  const admin =
    client ?? (await import("./mfa-api-auth.ts")).createAdminClient()

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role, lab_id, org_id")
    .eq("id", userId)
    .maybeSingle()

  // A failed read and a missing row both deny — never a permissive default.
  if (profileError) {
    return deny(userId, null, "profile_incomplete", `profile read failed: ${profileError.message}`)
  }
  if (!profile) {
    return deny(userId, null, "profile_incomplete", "profile row not found")
  }

  const role = typeof profile.role === "string" ? profile.role : null

  if (role === "org_admin") {
    const orgId = typeof profile.org_id === "string" ? profile.org_id : null
    if (!orgId) {
      return deny(userId, role, "profile_incomplete", "org_admin has no org_id")
    }
    return { kind: "org", orgId }
  }

  if (role === "manager") {
    const labId = typeof profile.lab_id === "string" ? profile.lab_id : null
    if (!labId) {
      return deny(userId, role, "profile_incomplete", "manager has no lab_id")
    }

    // The lab's own org_id is the ONLY reliable signal of org membership:
    // org-lab staff routinely carry profiles.org_id = NULL, so neither the
    // profile column nor the JWT org_id claim can stand in for this read.
    const { data: lab, error: labError } = await admin
      .from("labs")
      .select("org_id")
      .eq("id", labId)
      .maybeSingle()

    // An unreadable or missing lab must NEVER be treated as standalone —
    // that would hand a purchasable owner back on a failed read.
    if (labError) {
      return deny(userId, role, "profile_incomplete", `lab read failed: ${labError.message}`)
    }
    if (!lab) {
      return deny(userId, role, "profile_incomplete", `lab ${labId} not found`)
    }

    // Only a positively-NULL org_id proves standalone ownership. Any other
    // value — including an unexpected shape — falls to the org-managed denial.
    if (lab.org_id === null || lab.org_id === undefined) {
      return { kind: "lab", labId }
    }

    return deny(userId, role, "org_managed_billing", `lab ${labId} belongs to an org`)
  }

  if (role === "technician") {
    return deny(userId, role, "role_not_permitted", "technicians cannot manage billing")
  }

  if (role === "super_admin") {
    return deny(userId, role, "role_not_permitted", "super_admin has no tenant billing context")
  }

  return deny(userId, role, "role_not_permitted", "unrecognized role")
}
