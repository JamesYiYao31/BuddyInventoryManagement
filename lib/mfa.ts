import { supabase } from "@/lib/supabase"

export async function getMfaEnrollmentStatus(): Promise<{ enrolled: boolean; factorId: string | null }> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error || !data) return { enrolled: false, factorId: null }
  const verified = data.totp.find((f) => f.status === "verified")
  return { enrolled: !!verified, factorId: verified?.id ?? null }
}

export async function getAssuranceLevel(): Promise<"aal1" | "aal2" | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return null
  return data.currentLevel as "aal1" | "aal2" | null
}

export async function enrollTotp(): Promise<{ qrCodeUrl: string; secret: string; factorId: string } | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return null

    const response = await fetch('/api/mfa/enroll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      console.error('MFA enroll failed:', errorBody)
      return null
    }

    const data = await response.json()
    return {
      qrCodeUrl: data.qrCodeUrl,
      secret: data.secret,
      factorId: data.factorId,
    }
  } catch (err) {
    console.error('MFA enroll request failed:', err)
    return null
  }
}

export async function verifyTotpEnrollment(
  factorId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** Fire-and-forget security_logs write after verify succeeds. Never throws. */
export async function completeEnrollmentLog(replaced: boolean): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return

    await fetch("/api/mfa/enroll-complete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replaced }),
    })
  } catch (err) {
    console.error("[completeEnrollmentLog] Failed:", err)
  }
}

export async function verifyTotpChallenge(
  factorId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError || !challengeData) {
    return { success: false, error: challengeError?.message ?? "Could not create challenge" }
  }
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  })
  if (verifyError) return { success: false, error: verifyError.message }
  return { success: true }
}

export async function unenrollTotp(factorId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function generateMfaRecoveryCodes(): Promise<{ codes: string[] } | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return null

    const response = await fetch("/api/mfa/recovery-codes/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (!response.ok) return null

    const data = (await response.json()) as { codes?: string[] }
    if (!Array.isArray(data.codes) || data.codes.length === 0) return null
    return { codes: data.codes }
  } catch {
    return null
  }
}

export async function checkRecoveryElevation(): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return false

    const response = await fetch("/api/mfa/recovery-elevation-status", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!response.ok) return false

    const data = (await response.json().catch(() => ({}))) as { elevated?: boolean }
    return data.elevated === true
  } catch {
    return false
  }
}

export async function redeemMfaRecoveryCode(
  code: string,
): Promise<{ success: boolean; error?: string; remainingCount?: number }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: "Not authenticated." }
    }

    const response = await fetch("/api/mfa/recovery-codes/redeem", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean
      error?: string
      remainingCount?: number
    }

    if (!response.ok) {
      return {
        success: false,
        error: data.error ?? "Invalid recovery code.",
        remainingCount: data.remainingCount,
      }
    }

    return { success: true, remainingCount: data.remainingCount }
  } catch {
    return { success: false, error: "Could not redeem recovery code." }
  }
}
