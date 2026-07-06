/**
 * Validates that a returnTo path is safe for internal redirect.
 * Accepts only paths starting with / but NOT // (protocol-relative)
 * or /\ (backslash variant some browsers normalize to protocol-relative).
 */
export function isSafeReturnTo(path: string | null): path is string {
  if (!path) return false
  if (!path.startsWith("/")) return false
  if (path.startsWith("//")) return false
  if (path.startsWith("/\\")) return false
  return true
}
