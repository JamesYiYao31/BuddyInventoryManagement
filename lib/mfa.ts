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
