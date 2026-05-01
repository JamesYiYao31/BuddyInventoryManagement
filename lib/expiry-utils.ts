/** Earliest ISO date string; empty strings are ignored. */
export const getEarliestExpiry = (date1: string, date2: string): string => {
  if (!date1) return date2
  if (!date2) return date1
  const d1 = new Date(date1).getTime()
  const d2 = new Date(date2).getTime()
  return d1 < d2 ? date1 : date2
}
