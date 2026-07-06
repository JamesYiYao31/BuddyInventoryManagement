import {
  checkRecoveryElevation,
  getAssuranceLevel,
  getMfaEnrollmentStatus,
} from "@/lib/mfa"

/**
 * Privileged-route MFA gate (mirrors dashboard checkSessionAndRole steps 2–3).
 * Returns a redirect path, or null if the user may proceed.
 */
export async function resolveMfaGateRedirect(returnTo: string): Promise<string | null> {
  const { enrolled } = await getMfaEnrollmentStatus()
  if (!enrolled) {
    return `/mfa-setup?returnTo=${encodeURIComponent(returnTo)}`
  }

  const level = await getAssuranceLevel()
  if (level === "aal2") {
    return null
  }

  if (level === "aal1") {
    const recovered = await checkRecoveryElevation()
    if (recovered) {
      return null
    }
    return `/mfa-challenge?returnTo=${encodeURIComponent(returnTo)}`
  }

  return null
}
