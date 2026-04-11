// lib/inventory-utils.ts

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

export const STATUS_STYLES: Record<InventoryStatus, string> = {
  "In Storage": "bg-green-500/10 text-green-600",
  "Low Stock": "bg-yellow-500/10 text-yellow-600",
  "Expiring Soon": "bg-red-500/10 text-red-600",
  "Expired": "bg-gray-500/10 text-gray-600",
}

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

export const getLotTotalCount = (lot: LotEntry): number => {
  if (lot.quantityType === "units_only") return lot.units
  if (lot.quantityType === "count_only") return lot.count
  return lot.units * lot.count
}

export const getLotStatus = (lot: LotEntry, settings: LabSettings): InventoryStatus => {
  if (!lot.expiry) return "In Storage"
  const days = daysUntilExpiry(lot.expiry)
  if (days <= 0) return "Expired"
  if (days <= settings.expiryUrgentDays) return "Expiring Soon"
  if (getLotTotalCount(lot) <= settings.lowStockCount) return "Low Stock"
  return "In Storage"
}

export const emptyLotForm = (): Omit<LotEntry, "lotId"> => ({
  lot: "", expiry: "", receivedDate: new Date().toLocaleDateString(), vendor: "", storage: "",
  status: "In Storage", notes: "", quantityType: "units_and_count",
  units: 1, unitLabel: "box", count: 1, countLabel: "units",
})

export type LotInUseStatus = "Active" | "Low Volume" | "Expiring Soon" | "Expired"

export interface LotInUseEntry {
  id: string
  itemId: string
  itemName: string
  lotNumber: string
  openedDate: string
  workingExpiryDate: string // e.g., 30 days after opening
  actualExpiryDate: string  // Printed on the bottle
  quantityLeft: string      // e.g., "15 vials" or "40%"
  status: LotInUseStatus
}

export const LOT_IN_USE_STYLES: Record<LotInUseStatus, string> = {
  "Active": "bg-green-500/10 text-green-600 dark:text-green-400",
  "Low Volume": "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "Expiring Soon": "bg-red-500/10 text-red-600 dark:text-red-400",
  "Expired": "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
}

export const getEarliestExpiry = (date1: string, date2: string): string => {
  if (!date1) return date2
  if (!date2) return date1
  const d1 = new Date(date1).getTime()
  const d2 = new Date(date2).getTime()
  return d1 < d2 ? date1 : date2
}