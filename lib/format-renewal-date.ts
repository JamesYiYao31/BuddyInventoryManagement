/**
 * Format a billing period-end / renewal timestamp for display.
 * Viewer-local by default; optional `timeZone` is for tests only.
 *
 * Never combine `dateStyle` with `timeZoneName` in one Intl call — that throws
 * and previously blanked every renewal line (caught into null with no log).
 */
export function formatRenewalDate(
  iso: string | null | undefined,
  timeZone?: string,
): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    console.warn("[formatRenewalDate] invalid date input:", iso)
    return null
  }
  try {
    const dateOpts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
    }
    const tzOpts: Intl.DateTimeFormatOptions = { timeZoneName: "short" }
    if (timeZone) {
      dateOpts.timeZone = timeZone
      tzOpts.timeZone = timeZone
    }
    const date = new Intl.DateTimeFormat(undefined, dateOpts).format(d)
    const tz =
      new Intl.DateTimeFormat(undefined, tzOpts)
        .formatToParts(d)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    return tz ? `${date} (${tz})` : date
  } catch (err) {
    console.warn("[formatRenewalDate] failed to format:", iso, err)
    return null
  }
}
