import { supabase } from "./supabase"

export type SidebarPage = "dashboard" | "inventory" | "lotinuse" | "requests" | "activitylog" | "analytics" | "labsharing"
export type InventoryStatus = "In Storage" | "Low Stock" | "Expiring Soon" | "Expired" | "Watchlist"
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
  itemName?: string // Optional helper
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

export const STATUS_STYLES: Record<string, string> = {
  "In Storage": "bg-green-500/10 text-green-600",
  "Low Stock": "bg-yellow-500/10 text-yellow-600",
  "Expiring Soon": "bg-red-500/10 text-red-600",
  "Expired": "bg-gray-500/10 text-gray-600",
  "Watchlist": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
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
  workingExpiryDate: string 
  actualExpiryDate: string  
  quantityLeft: string      
  status: LotInUseStatus
}

export const LOT_IN_USE_STYLES: Record<string, string> = {
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

export type RequestStatus = "Pending" | "Approved" | "Ordered" | "Received"

export interface ReorderRequest {
  id: string
  catalogNumber: string
  itemName: string
  vendor: string
  orderQty: number
  unitPrice: number
  totalPrice: number
  status: RequestStatus
  notes: string
  dateRequested: string
}

export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  "Pending": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  "Approved": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Ordered": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "Received": "bg-green-500/10 text-green-600 dark:text-green-400",
}

export const CATALOG_DB: Record<string, { name: string; vendor: string; price: number }> = {
  "CAT-100124": { name: "IAST Culture Bottle", vendor: "Thermo Fisher", price: 45.00 },
  "CAT-26542": { name: "BioBall", vendor: "Merck", price: 120.50 },
  "CAT-25510": { name: "DMSO", vendor: "Sigma Aldrich", price: 35.00 },
  "CAT-99887": { name: "FACS Clean", vendor: "BD Biosciences", price: 85.00 },
}

export type ActivityActionType = "Added" | "Opened" | "Used" | "Disposed" | "Ordered" | "Received" | "Edited"

export interface ActivityLogEntry {
  id: string
  date: string
  time: string
  user: string
  userInitials: string
  actionType: ActivityActionType
  itemName: string
  lotNumber: string
  details: string
}

export const ACTION_STYLES: Record<string, string> = {
  "Added": "bg-green-500/10 text-green-600 dark:text-green-400",
  "Received": "bg-green-500/10 text-green-600 dark:text-green-400",
  "Opened": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Used": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "Ordered": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "Edited": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  "Disposed": "bg-red-500/10 text-red-600 dark:text-red-400",
}

// ── NEW: DATABASE FETCHING WITH AUTOMATIC MAPPING ──

export const fetchInventoryFromSupabase = async (): Promise<InventoryGroup[]> => {
  const { data, error } = await supabase
    .from('inventory_lots')
    .select(`*, items(name, vendor)`)
  
  if (error) { console.error(error); return []; }

  const groups: Record<string, InventoryGroup> = {}

  data.forEach((row: any) => {
    const name = row.items?.name || "Unknown"
    // Map database snake_case to frontend camelCase
    const lot: LotEntry = {
      lotId: row.id,
      lot: row.lot_number,
      expiry: row.expiry_date,
      receivedDate: row.received_date,
      vendor: row.items?.vendor || "",
      storage: row.storage_location,
      status: row.status,
      notes: row.notes,
      quantityType: row.quantity_type,
      units: row.units,
      unitLabel: row.unit_label,
      count: row.count,
      countLabel: row.count_label,
      itemName: name
    }

    if (!groups[name]) {
      groups[name] = { itemId: row.item_id, name, lots: [] }
    }
    groups[name].lots.push(lot)
  })

  return Object.values(groups)
}
// ADD TO THE BOTTOM OF lib/inventory-utils.ts

export const logActivity = async (
  actionType: ActivityActionType, 
  itemName: string, 
  lotNumber: string, 
  details: string
) => {
  const { error } = await supabase
    .from('activity_logs')
    .insert([{
      user_name: "James", // This will be dynamic once we add Auth
      user_initials: "JM",
      action_type: actionType,
      item_name: itemName,
      lot_number: lotNumber,
      details: details
    }])
  
  if (error) console.error("Logging failed:", error)
}

// Function to fetch logs for the table
export const fetchLogsFromSupabase = async (): Promise<ActivityLogEntry[]> => {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) { console.error(error); return []; }

  return data.map((log: any) => ({
    id: log.id,
    date: new Date(log.created_at).toLocaleDateString(),
    time: new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    user: log.user_name,
    userInitials: log.user_initials,
    actionType: log.action_type,
    itemName: log.item_name,
    lotNumber: log.lot_number,
    details: log.details
  }))
}
// --- ADD TO lib/inventory-utils.ts ---

export const fetchActiveLotsFromSupabase = async (): Promise<LotInUseEntry[]> => {
  const { data, error } = await supabase
    .from('active_lots')
    .select(`*, items(name)`)
    .order('opened_date', { ascending: false });

  if (error) { console.error(error); return []; }

  return data.map((row: any) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.items?.name || "Unknown Item",
    lotNumber: row.lot_number,
    openedDate: row.opened_date,
    workingExpiryDate: row.working_expiry_date,
    actualExpiryDate: row.actual_expiry_date,
    quantityLeft: row.quantity_left,
    status: row.status
  }));
}

export const openNewLotInSupabase = async (
  inventoryLotId: string,
  itemId: string,
  lotNumber: string,
  actualExpiry: string,
  workingExpiry: string,
  quantityToMove: number, // How many "boxes/containers" from inventory
  yieldPerContainer: number, // How many "units" that results in on bench
  unitLabel: string
) => {
  // 1. Decrement the count in inventory_lots
  const { data: invLot, error: fetchErr } = await supabase
    .from('inventory_lots')
    .select('count')
    .eq('id', inventoryLotId)
    .single();

  if (fetchErr || !invLot) throw new Error("Could not find inventory lot.");

  const newInventoryCount = invLot.count - quantityToMove;

  if (newInventoryCount < 0) throw new Error("Insufficient stock in inventory.");

  // Update Inventory
  await supabase
    .from('inventory_lots')
    .update({ count: newInventoryCount })
    .eq('id', inventoryLotId);

  // 2. Add to active_lots (Bench)
  const totalBenchUnits = quantityToMove * yieldPerContainer;
  const { error: activeErr } = await supabase
    .from('active_lots')
    .insert([{
      item_id: itemId,
      lot_number: lotNumber,
      opened_date: new Date().toISOString().split('T')[0],
      working_expiry_date: workingExpiry,
      actual_expiry_date: actualExpiry,
      quantity_left: `${totalBenchUnits} ${unitLabel}`,
      status: 'Active'
    }]);

  if (activeErr) throw activeErr;

  // 3. Log Activity
  await logActivity("Opened", "Item", lotNumber, `Opened ${quantityToMove} containers for bench use.`);
}

export const logUsageInSupabase = async (
  activeLotId: string,
  currentQtyString: string,
  deductAmount: number,
  itemName: string,
  lotNumber: string
) => {
  const parts = currentQtyString.split(" ");
  const currentVal = parseInt(parts[0]);
  const label = parts.slice(1).join(" ");
  const newVal = currentVal - deductAmount;

  if (newVal <= 0) {
    // Archive/Delete if empty
    await supabase.from('active_lots').delete().eq('id', activeLotId);
    await logActivity("Used", itemName, lotNumber, `Used remaining ${currentVal} ${label}. Lot cleared.`);
  } else {
    await supabase
      .from('active_lots')
      .update({ 
        quantity_left: `${newVal} ${label}`,
        status: newVal < 5 ? 'Low Volume' : 'Active' // Simple logic for status update
      })
      .eq('id', activeLotId);
    
    await logActivity("Used", itemName, lotNumber, `Deducted ${deductAmount} ${label}.`);
  }
}
// --- ADD TO lib/inventory-utils.ts ---

export interface DashboardStats {
  expiredCount: number;
  urgentCount: number;
  lowStockCount: number;
  pendingRequests: number;
  totalMonthlySpend: number;
}

export const calculateDashboardStats = (
  inventory: InventoryGroup[],
  activeLots: LotInUseEntry[],
  requests: ReorderRequest[],
  settings: LabSettings
): DashboardStats => {
  const now = new Date();
  
  // 1. Expired (Freezer + Bench)
  const expiredInventory = inventory.flatMap(g => g.lots).filter(l => daysUntilExpiry(l.expiry) <= 0).length;
  const expiredBench = activeLots.filter(l => daysUntilExpiry(getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate)) <= 0).length;

  // 2. Urgent (Next 7 days)
  const urgentInventory = inventory.flatMap(g => g.lots).filter(l => {
    const days = daysUntilExpiry(l.expiry);
    return days > 0 && days <= settings.expiryUrgentDays;
  }).length;
  
  // 3. Low Stock
  const lowStock = inventory.filter(g => {
    const totalCount = g.lots.reduce((acc, lot) => acc + (lot.count || 0), 0);
    return totalCount <= settings.lowStockCount;
  }).length;

  // 4. Pending Requests
  const pending = requests.filter(r => r.status === "Pending").length;

  // 5. Total Monthly Spend
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthlySpend = requests
    .filter(r => {
      const d = new Date(r.dateRequested);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && r.status !== "Pending";
    })
    .reduce((sum, r) => sum + r.totalPrice, 0);

  return {
    expiredCount: expiredInventory + expiredBench,
    urgentCount: urgentInventory,
    lowStockCount: lowStock,
    pendingRequests: pending,
    totalMonthlySpend: monthlySpend
  };
};