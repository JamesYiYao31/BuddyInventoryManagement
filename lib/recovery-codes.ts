import { randomInt } from "crypto"
import bcrypt from "bcryptjs"
import { formatRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery-code-format"

export { formatRecoveryCode, normalizeRecoveryCode }

/** Uppercase alphanumeric excluding ambiguous chars: 0, O, 1, I, L */
const RECOVERY_CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

const BCRYPT_ROUNDS = 10

function randomCodeSegment(length: number): string {
  let segment = ""
  for (let i = 0; i < length; i += 1) {
    segment += RECOVERY_CODE_CHARSET[randomInt(RECOVERY_CODE_CHARSET.length)]
  }
  return segment
}

/** Generate 10 recovery codes in XXXX-XXXX format. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const normalized = randomCodeSegment(4) + randomCodeSegment(4)
    return formatRecoveryCode(normalized)
  })
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code)
  return bcrypt.hash(normalized, BCRYPT_ROUNDS)
}

export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code)
  if (normalized.length !== 8) return false
  return bcrypt.compare(normalized, hash)
}
