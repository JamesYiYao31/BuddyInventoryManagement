// ── TYPES ──
export type SidebarPage = "dashboard" | "requests" | "lotinuse" | "inventory" | "activitylog"
export type InventoryStatus = "In Storage" | "Low Stock" | "Expiring Soon" | "Expired"
export type QuantityType = "units_and_count" | "units_only" | "count_only"

export interface LotEntry {
  lotId: string
  lot: string
  expiry: string
  receivedDate: string
  vendor: string
  storage: string
  status: InventoryStatus
  notes: string
  quantityType: QuantityType
  units: number
  unitLabel: string
  count: number
  countLabel: string
}

export interface InventoryGroup {
  itemId: string
  name: string
  lots: LotEntry[]
}

export interface LabSettings {
  lowStockCount: number
  expiryWarnDays: number
  expiryUrgentDays: number
}

// ── CONSTANTS ──
export const STATUS_STYLES: Record<InventoryStatus, string> = {
  "In Storage": "bg-success/10 text-success",
  "Low Stock": "bg-warning/10 text-warning",
  "Expiring Soon": "bg-destructive/10 text-destructive",
  "Expired": "bg-muted text-muted-foreground",
}

// ── HELPERS ──
export const totalCountLabel = (lot: LotEntry | Omit<LotEntry, "lotId">): string => {
  if (lot.quantityType === "units_only") return `${lot.units} ${lot.unitLabel}`
  if (lot.quantityType === "count_only") return `${lot.count} ${lot.countLabel}`
  return `${lot.units} ${lot.unitLabel} / ${lot.count} ${lot.countLabel}`
}

export const daysUntilExpiry = (expiry: string): number => {
  if (!expiry) return 999
  const d = new Date(expiry)
  const now = new Date()
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export const getLotTotalCountValue = (lot: LotEntry): number => {
  if (lot.quantityType === "units_only") return lot.units
  if (lot.quantityType === "count_only") return lot.count
  return lot.units * lot.count
}

export const getLotStatus = (lot: LotEntry, settings: LabSettings): InventoryStatus => {
  if (!lot.expiry) return "In Storage"
  const days = daysUntilExpiry(lot.expiry)
  if (days <= 0) return "Expired"
  if (days <= settings.expiryUrgentDays) return "Expiring Soon"
  if (getLotTotalCountValue(lot) <= settings.lowStockCount) return "Low Stock"
  return "In Storage"
}

export const emptyLotForm = (): Omit<LotEntry, "lotId"> => ({
  lot: "", expiry: "", receivedDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), 
  vendor: "", storage: "", status: "In Storage", notes: "", quantityType: "units_and_count",
  units: 1, unitLabel: "box", count: 1, countLabel: "units",
})