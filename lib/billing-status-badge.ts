/**
 * Shared billing-status badge classes and labels for super-admin surfaces.
 * Pure — no React, no app/ imports.
 */
export function billingStatusBadgeClass(status: string | null): string {
  switch (status) {
    case "active":
      return "bg-green-500/15 text-green-800 dark:text-green-400"
    case "trialing":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-400"
    case "past_due":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-400"
    case "suspended":
      return "bg-red-500/15 text-red-800 dark:text-red-400"
    case null:
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
    default:
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
  }
}

export function billingStatusLabel(status: string | null): string {
  if (status === null) return "No billing account"
  if (status === "past_due") return "Payment issue"
  return status.replace(/_/g, " ")
}
