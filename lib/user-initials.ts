export function initialsFromDisplayName(name: string): string {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || name.trim().slice(0, 2).toUpperCase()
  return initials || "??"
}
