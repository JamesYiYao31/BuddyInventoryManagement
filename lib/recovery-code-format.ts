/** Normalize user input: strip dashes/spaces, uppercase. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase()
}

/** Format 8-char normalized code as XXXX-XXXX. */
export function formatRecoveryCode(normalized: string): string {
  if (normalized.length !== 8) return normalized
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}
