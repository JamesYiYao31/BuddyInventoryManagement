/**
 * Extract a lowercase error code from a billing-overview (or similar) error
 * response body. Prefers `error_code` (checkout / route house style), then
 * `code`. Missing or unparsable body → `request_failed` — never throws.
 */
export function resolveBillingOverviewErrorCode(bodyText: string): string {
  const trimmed = typeof bodyText === "string" ? bodyText.trim() : ""
  if (!trimmed) return "request_failed"

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "request_failed"
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.error_code === "string" && record.error_code.length > 0) {
      return record.error_code
    }
    if (typeof record.code === "string" && record.code.length > 0) {
      return record.code
    }
    return "request_failed"
  } catch {
    return "request_failed"
  }
}
