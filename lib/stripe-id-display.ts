/**
 * Shared Stripe ID display helpers for super-admin surfaces.
 * Pure truncation + clipboard copy — no React.
 */

export function truncateStripeId(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

export async function copyStripeId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id)
  } catch {
    // Clipboard may be unavailable; title still exposes the full id.
  }
}
