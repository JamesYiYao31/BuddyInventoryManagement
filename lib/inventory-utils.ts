import { supabase } from "./supabase"
import { getEarliestExpiry } from "./expiry-utils.ts"

export { getEarliestExpiry }

export type SidebarPage = "dashboard" | "inventory" | "lotinuse" | "requests" | "activitylog" | "analytics" | "labsharing" | "settings"
export type InventoryStatus = "In Storage" | "Low Stock" | "Expiring Soon" | "Expired" | "Watchlist"

/** Single lowest-trackable count. Legacy DB rows (boxes × units) are normalized when reading. */
export const totalUnitsFromInventoryRow = (row: {
  quantity_type?: string | null
  units?: number | null
  count?: number | null
}): number => {
  const qt = row.quantity_type
  const u = Number(row.units) || 0
  const c = Number(row.count) || 0
  if (qt === "units_and_count") return u * c
  if (qt === "units_only") return u
  return c
}

export interface LotEntry {
  lotId: string
  itemId: string
  lot: string
  expiry: string
  receivedDate: string
  vendor: string
  storage: string
  status: InventoryStatus
  notes: string
  totalUnits: number
  itemName?: string
}

export interface InventoryGroup {
  itemId: string
  name: string
  lots: LotEntry[]
}

export interface Item {
  id: string
  name: string
  vendor: string | null
  vendor_sku: string | null
}

// ── SMART BARCODE PARSER (Waterfall: HIBC → GS1 → Code 128 Plaintext) ──

export type BarcodeFormat = "HIBC" | "GS1" | "CODE128"

export interface ParsedBarcode {
  format: BarcodeFormat
  sku: string
  lot: string
  expiry: string
  raw: string
}

/**
 * Waterfall barcode parser. Detects format, extracts what it can.
 *
 * 1. HIBC  — string starts with `+`
 * 2. GS1   — string contains `(01)` or raw AI `01` with 14-digit GTIN
 * 3. Code 128 / plaintext — everything else; entire string → sku
 */
export function parseSmartBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim()
  if (!trimmed) return { format: "CODE128", sku: "", lot: "", expiry: "", raw }

  // ── 1. HIBC detection (starts with "+") ──
  if (trimmed.startsWith("+")) return parseHIBC(trimmed)

  // ── 2. GS1 detection ──
  if (isGS1(trimmed)) return parseGS1(trimmed)

  // ── 3. Code 128 / plaintext fallback ──
  return { format: "CODE128", sku: trimmed, lot: "", expiry: "", raw }
}

function isGS1(s: string): boolean {
  if (s.includes("(01)") || s.includes("(10)") || s.includes("(17)")) return true
  // Raw FNC1 stream: starts with AI 01 followed by 14-digit GTIN
  const clean = s.replace(/[\x1d~]/g, "")
  if (clean.startsWith("01") && clean.length >= 16 && /^\d{16}/.test(clean)) return true
  return false
}

/**
 * HIBC (Health Industry Bar Code) parser.
 *
 * Primary symbol: +{LIC}{product/catalog}        (after the leading "+")
 * Secondary symbol: +$$lot/expiry                 (second "+" segment)
 *
 * Many HIBC barcodes concatenate primary+secondary into one string.
 * Common date formats: YYDDD (Julian), YYMMDD, MMDDYY.
 */
function parseHIBC(s: string): ParsedBarcode {
  const result: ParsedBarcode = { format: "HIBC", sku: "", lot: "", expiry: "", raw: s }

  // Split on "+" to get segments; first char is always "+" so segments[0] is empty
  const segments = s.split("+").filter(Boolean)
  if (segments.length === 0) return result

  // Primary label — everything up to "/" or end is the LIC + product code (= our SKU)
  const primary = segments[0]
  // The LIC is typically 4 chars (alpha+digits) but the full primary IS the vendor SKU
  result.sku = primary.replace(/[/\s]/g, "")

  // Secondary label (if present)
  if (segments.length >= 2) {
    const secondary = segments[1]
    // HIBC secondary starts with "$$" for lot+date, or "$" for lot-only
    if (secondary.startsWith("$$")) {
      parseHIBCSecondary(secondary.substring(2), result)
    } else if (secondary.startsWith("$")) {
      parseHIBCSecondary(secondary.substring(1), result)
    } else {
      // Some encoders skip $ — try to split lot/date heuristically
      parseHIBCSecondary(secondary, result)
    }
  }

  return result
}

function parseHIBCSecondary(seg: string, result: ParsedBarcode) {
  // Strip trailing check character if present (single alpha at end after digits)
  let body = seg.replace(/[A-Z]$/i, "")

  // Try to find a 6-digit date suffix (YYMMDD) at the end
  const dateMatch = body.match(/(\d{6})$/)
  if (dateMatch) {
    const dateStr = dateMatch[1]
    const yy = parseInt(dateStr.substring(0, 2), 10)
    const mm = dateStr.substring(2, 4)
    const dd = dateStr.substring(4, 6)
    const century = yy >= 50 ? 1900 : 2000
    result.expiry = `${century + yy}-${mm}-${dd}`
    result.lot = body.substring(0, body.length - 6) || result.lot
  } else {
    // No date found — entire body is lot
    result.lot = body || result.lot
  }
}

/**
 * GS1-128 / DataMatrix parser.
 * Handles parenthesised AIs — (01)(17)(10) — and raw FNC1 streams.
 */
function parseGS1(raw: string): ParsedBarcode {
  const result: ParsedBarcode = { format: "GS1", sku: "", lot: "", expiry: "", raw }
  const trimmed = raw.trim()

  // Strategy 1: parenthesised AI format
  if (trimmed.includes("(01)") || trimmed.includes("(10)") || trimmed.includes("(17)")) {
    const aiPattern = /\((\d{2,4})\)([^(]*)/g
    let match: RegExpExecArray | null
    while ((match = aiPattern.exec(trimmed)) !== null) {
      const [, ai, value] = match
      const v = value.replace(/[\x1d\x00]/g, "").trim()
      if (ai === "01") result.sku = v
      else if (ai === "10") result.lot = v
      else if (ai === "17") result.expiry = formatGS1Date(v)
    }
    return result
  }

  // Strategy 2: raw FNC1 stream
  const clean = trimmed.replace(/[~\x1d]/g, "\x1d")
  const segments = clean.split("\x1d").filter(Boolean)

  for (const seg of segments) {
    if (seg.startsWith("01") && seg.length >= 16) {
      result.sku = seg.substring(2, 16)
      extractGS1Tail(seg.substring(16), result)
    } else if (seg.startsWith("10")) {
      result.lot = seg.substring(2)
    } else if (seg.startsWith("17") && seg.length >= 8) {
      result.expiry = formatGS1Date(seg.substring(2, 8))
      extractGS1Tail(seg.substring(8), result)
    }
  }

  // Single undelimited string fallback
  if (!result.sku && !result.lot && clean.startsWith("01") && clean.length >= 16) {
    result.sku = clean.substring(2, 16)
    extractGS1Tail(clean.substring(16), result)
  }

  return result
}

function extractGS1Tail(rest: string, result: ParsedBarcode) {
  if (!rest) return
  if (rest.startsWith("17") && rest.length >= 8) {
    result.expiry = formatGS1Date(rest.substring(2, 8))
    extractGS1Tail(rest.substring(8), result)
  } else if (rest.startsWith("10")) {
    result.lot = rest.substring(2).replace(/\x1d.*/, "")
  }
}

function formatGS1Date(yymmdd: string): string {
  if (yymmdd.length < 6) return ""
  const yy = parseInt(yymmdd.substring(0, 2), 10)
  const mm = yymmdd.substring(2, 4)
  const dd = yymmdd.substring(4, 6)
  const century = yy >= 50 ? 1900 : 2000
  return `${century + yy}-${mm}-${dd}`
}

// ── ITEMS TABLE HELPERS ──

export const fetchAllItems = async (): Promise<Item[]> => {
  const { data, error } = await supabase
    .from("items")
    .select("id, name, vendor, vendor_sku")
    .order("name", { ascending: true })

  if (error) {
    console.error("Failed to fetch items:", error)
    return []
  }
  return data as Item[]
}

export const lookupItemByVendorSku = async (sku: string): Promise<Item | null> => {
  if (!sku) return null
  const { data, error } = await supabase
    .from("items")
    .select("id, name, vendor, vendor_sku")
    .eq("vendor_sku", sku)
    .maybeSingle()

  if (error) {
    console.error("vendor_sku lookup failed:", error)
    return null
  }
  return data as Item | null
}

export type TechDashboardWidget = "donut" | "waste" | "expenses" | "none"

export interface LabSettings {
  lowStockThreshold: number
  expiringSoonDays: number
  urgentDays: number
  labTimezone: string
  techDashboardWidget: TechDashboardWidget
}

export const LAB_SETTINGS_DEFAULTS: LabSettings = {
  lowStockThreshold: 5,
  expiringSoonDays: 30,
  urgentDays: 7,
  labTimezone: "America/Chicago",
  techDashboardWidget: "donut",
}

export const fetchLabSettings = async (): Promise<LabSettings> => {
  const d = LAB_SETTINGS_DEFAULTS

  try {
    // First attempt: full select including tech_dashboard_widget
    const { data, error } = await supabase
      .from("lab_settings")
      .select("low_stock_threshold, expiring_soon_days, urgent_days, lab_timezone, tech_dashboard_widget")
      .eq("id", 1)
      .maybeSingle()

    if (error) {
      console.error("[fetchLabSettings] Supabase error — falling back to defaults.", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      })

      // Likely cause: tech_dashboard_widget column doesn't exist yet.
      // Retry with legacy columns so the dashboard keeps working.
      const legacy = await supabase
        .from("lab_settings")
        .select("low_stock_threshold, expiring_soon_days, urgent_days, lab_timezone")
        .eq("id", 1)
        .maybeSingle()

      if (legacy.error) {
        console.error("[fetchLabSettings] Legacy fallback also failed — using defaults.", {
          message: legacy.error?.message,
          details: legacy.error?.details,
          hint: legacy.error?.hint,
          code: legacy.error?.code,
        })
        return d
      }
      if (!legacy.data) return d

      return {
        lowStockThreshold: legacy.data.low_stock_threshold ?? d.lowStockThreshold,
        expiringSoonDays: legacy.data.expiring_soon_days ?? d.expiringSoonDays,
        urgentDays: legacy.data.urgent_days ?? d.urgentDays,
        labTimezone: legacy.data.lab_timezone ?? d.labTimezone,
        techDashboardWidget: d.techDashboardWidget,
      }
    }

    if (!data) {
      // Table is empty — return safe defaults instead of crashing.
      return d
    }

    return {
      lowStockThreshold: data.low_stock_threshold ?? d.lowStockThreshold,
      expiringSoonDays: data.expiring_soon_days ?? d.expiringSoonDays,
      urgentDays: data.urgent_days ?? d.urgentDays,
      labTimezone: data.lab_timezone ?? d.labTimezone,
      techDashboardWidget: data.tech_dashboard_widget ?? d.techDashboardWidget,
    }
  } catch (err: any) {
    console.error("[fetchLabSettings] Unexpected exception — using defaults.", {
      message: err?.message,
      details: err?.details ?? err?.stack,
    })
    return d
  }
}

export const updateLabSettings = async (
  settings: LabSettings
): Promise<{ success: boolean; error?: string }> => {
  const { error } = await supabase
    .from("lab_settings")
    .update({
      low_stock_threshold: settings.lowStockThreshold,
      expiring_soon_days: settings.expiringSoonDays,
      urgent_days: settings.urgentDays,
      tech_dashboard_widget: settings.techDashboardWidget,
    })
    .eq("id", 1)

  if (error) {
    console.error("[updateLabSettings] Failed — retrying without tech_dashboard_widget.", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    })

    // Retry without the new column so managers can still save thresholds
    // when the tech_dashboard_widget column hasn't been added to Supabase yet.
    const retry = await supabase
      .from("lab_settings")
      .update({
        low_stock_threshold: settings.lowStockThreshold,
        expiring_soon_days: settings.expiringSoonDays,
        urgent_days: settings.urgentDays,
      })
      .eq("id", 1)

    if (retry.error) {
      console.error("[updateLabSettings] Legacy retry failed.", {
        message: retry.error?.message,
        details: retry.error?.details,
      })
      return { success: false, error: retry.error.message }
    }
    return { success: true }
  }
  return { success: true }
}

export const createItem = async (
  name: string,
  vendor?: string,
  vendorSku?: string
): Promise<Item | null> => {
  const row: Record<string, string> = { name }
  if (vendor) row.vendor = vendor
  if (vendorSku) row.vendor_sku = vendorSku

  const { data, error } = await supabase
    .from("items")
    .insert([row])
    .select("id, name, vendor, vendor_sku")
    .single()

  if (error) {
    console.error("Failed to create item:", error)
    return null
  }
  return data as Item
}

export const STATUS_STYLES: Record<string, string> = {
  "In Storage": "bg-green-500/10 text-green-600",
  "Low Stock": "bg-yellow-500/10 text-yellow-600",
  "Expiring Soon": "bg-red-500/10 text-red-600",
  "Expired": "bg-gray-500/10 text-gray-600",
  "Watchlist": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
}

/**
 * Returns the lab's current calendar date (YYYY-MM-DD) in the configured timezone,
 * completely ignoring the user's browser clock.
 */
export const getLabCurrentDateStr = (timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formatter.format(new Date())
}

/**
 * Pure calendar-day difference: expiry minus lab-today.
 * Positive → days remaining, 0 → expires today (NOT expired), negative → past due.
 */
export const daysUntilExpiry = (expiry: string, labTimezone: string = "America/Chicago"): number => {
  if (!expiry) return 999
  const todayStr = getLabCurrentDateStr(labTimezone)
  const todayMs = new Date(todayStr + "T00:00:00").getTime()
  const expiryMs = new Date(expiry + "T00:00:00").getTime()
  return Math.round((expiryMs - todayMs) / (1000 * 60 * 60 * 24))
}

export const getLotTotalCount = (lot: LotEntry): number => lot.totalUnits

export const getLotStatus = (lot: LotEntry, settings: LabSettings): InventoryStatus => {
  const days = daysUntilExpiry(lot.expiry, settings.labTimezone)
  if (days < 0) return "Expired"
  if (days >= 0 && days <= settings.expiringSoonDays) return "Expiring Soon"
  if (getLotTotalCount(lot) <= settings.lowStockThreshold) return "Low Stock"
  return "In Storage"
}

export const emptyLotForm = (labTimezone: string = "America/Chicago"): Omit<LotEntry, "lotId"> => ({
  itemId: "",
  lot: "", expiry: "", receivedDate: getLabCurrentDateStr(labTimezone), vendor: "", storage: "",
  status: "In Storage", notes: "", totalUnits: 1,
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

export interface RequestMutationInput {
  catalogNumber: string
  itemName: string
  vendor: string
  orderQty: number
  unitPrice: number
  notes: string
}

export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  "Pending": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  "Approved": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Ordered": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "Received": "bg-green-500/10 text-green-600 dark:text-green-400",
}

export const CATALOG_DB: Record<string, { name: string; vendor: string; price: number }> = {
  "CAT-100124": { name: "IAST Culture Bottle", vendor: "Thermo Fisher", price: 45.0 },
  "CAT-26542": { name: "BioBall", vendor: "Merck", price: 120.5 },
  "CAT-25510": { name: "DMSO", vendor: "Sigma Aldrich", price: 35.0 },
  "CAT-99887": { name: "FACS Clean", vendor: "BD Biosciences", price: 85.0 },
}

export const createRequestInSupabase = async (input: RequestMutationInput) => {
  return supabase
    .from("requests")
    .insert([
      {
        catalog_number: input.catalogNumber,
        item_name: input.itemName,
        vendor: input.vendor,
        order_qty: input.orderQty,
        unit_price: input.unitPrice,
        total_price: input.orderQty * input.unitPrice,
        status: "Pending",
        notes: input.notes,
      },
    ])
}

export const updateRequestInSupabase = async (requestId: string, input: RequestMutationInput) => {
  return supabase
    .from("requests")
    .update({
      catalog_number: input.catalogNumber,
      item_name: input.itemName,
      vendor: input.vendor,
      order_qty: input.orderQty,
      unit_price: input.unitPrice,
      total_price: input.orderQty * input.unitPrice,
      notes: input.notes,
    })
    .eq("id", requestId)
}

export type ActivityActionType = "Added" | "Opened" | "Used" | "Disposed" | "Ordered" | "Received" | "Edited" | "Deleted from Bench" | "Deleted from Storage"

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
  "Deleted from Bench": "bg-red-500/10 text-red-600 dark:text-red-400",
  "Deleted from Storage": "bg-red-500/10 text-red-600 dark:text-red-400",
}

export const fetchInventoryFromSupabase = async (): Promise<InventoryGroup[]> => {
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(`*, items(name, vendor)`)

  if (error) {
    console.error(error)
    return []
  }

  const groups: Record<string, InventoryGroup> = {}

  data.forEach((row: any) => {
    const name = row.items?.name || "Unknown"

    const lot: LotEntry = {
      lotId: row.id,
      itemId: row.item_id,
      lot: row.lot_number,
      expiry: row.expiry_date,
      receivedDate: row.received_date,
      vendor: row.items?.vendor || "",
      storage: row.storage_location,
      status: row.status,
      notes: row.notes,
      totalUnits: totalUnitsFromInventoryRow(row),
      itemName: name,
    }

    if (!groups[name]) {
      groups[name] = { itemId: row.item_id, name, lots: [] }
    }
    groups[name].lots.push(lot)
  })

  return Object.values(groups)
}

// Resolves the current authenticated user's display name + initials from the
// profiles table. Falls back to auth metadata, then email-prefix — never to a
// hardcoded name. Returns null if there is no session.
export const resolveCurrentUserIdentity = async (): Promise<{
  userId: string
  name: string
  initials: string
  email: string
} | null> => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null

  const user = session.user
  const email = user.email ?? ""

  let name = ""
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.full_name && profile.full_name.trim()) {
    name = profile.full_name.trim()
  } else if (user.user_metadata?.full_name) {
    name = String(user.user_metadata.full_name).trim()
  } else if (email) {
    name = email.split("@")[0]
  } else {
    name = "Unknown User"
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || name.slice(0, 2).toUpperCase()

  return { userId: user.id, name, initials, email }
}

export const logActivity = async (
  actionType: ActivityActionType,
  itemName: string,
  lotNumber: string,
  details: string
) => {
  const identity = await resolveCurrentUserIdentity()

  if (!identity) {
    console.error("[logActivity] No authenticated user — aborting log insert.")
    return
  }

  const { error } = await supabase.from("activity_logs").insert([
    {
      user_name: identity.name,
      user_initials: identity.initials,
      action_type: actionType,
      item_name: itemName,
      lot_number: lotNumber,
      details: details,
    },
  ])

  if (error) console.error("[logActivity] Insert failed:", error)
}

// ── TEAM MANAGEMENT ──

export interface LabProfile {
  id: string
  fullName: string
  email: string
  role: "manager" | "technician"
}

export const fetchLabProfiles = async (): Promise<LabProfile[]> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .order("full_name", { ascending: true })

  if (error) {
    console.error("[fetchLabProfiles] Failed:", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    })
    return []
  }

  return (data || []).map((p: any) => ({
    id: p.id,
    fullName: p.full_name || "",
    email: p.email || "",
    role: (p.role === "manager" ? "manager" : "technician") as "manager" | "technician",
  }))
}

export const updateUserRole = async (
  userId: string,
  newRole: "manager" | "technician"
): Promise<{ success: boolean; error?: string }> => {
  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", userId)

  if (error) {
    console.error("[updateUserRole] Failed:", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    })
    return { success: false, error: error.message }
  }
  return { success: true }
}

export const fetchLogsFromSupabase = async (): Promise<ActivityLogEntry[]> => {
  const { data, error } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false })

  if (error) {
    console.error(error)
    return []
  }

  return data.map((log: any) => ({
    id: log.id,
    date: new Date(log.created_at).toLocaleDateString(),
    time: new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    user: log.user_name,
    userInitials: log.user_initials,
    actionType: log.action_type,
    itemName: log.item_name,
    lotNumber: log.lot_number,
    details: log.details,
  }))
}

export const fetchActiveLotsFromSupabase = async (): Promise<LotInUseEntry[]> => {
  const { data, error } = await supabase
    .from("active_lots")
    .select(`*, items(name)`)
    .order("opened_date", { ascending: false })

  if (error) {
    console.error(error)
    return []
  }

  return data.map((row: any) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.items?.name || "Unknown Item",
    lotNumber: row.lot_number,
    openedDate: row.opened_date,
    workingExpiryDate: row.working_expiry_date,
    actualExpiryDate: row.actual_expiry_date,
    quantityLeft: row.quantity_left,
    status: row.status,
  }))
}

/** Move lowest-trackable units from storage to bench. */
export const openNewLotInSupabase = async (
  inventoryLotId: string,
  itemId: string,
  lotNumber: string,
  actualExpiry: string,
  workingExpiry: string,
  unitsToMove: number,
  openedDate: string
) => {
  const { data: invLot, error: fetchErr } = await supabase
    .from("inventory_lots")
    .select("count, units, quantity_type")
    .eq("id", inventoryLotId)
    .single()

  if (fetchErr || !invLot) throw new Error("Could not find inventory lot.")

  const current = totalUnitsFromInventoryRow(invLot)
  const newInventoryCount = current - unitsToMove

  if (newInventoryCount < 0) throw new Error("Insufficient stock in inventory.")

  await supabase
    .from("inventory_lots")
    .update({
      count: newInventoryCount,
      quantity_type: "count_only",
      units: 0,
      unit_label: "units",
      count_label: "units",
    })
    .eq("id", inventoryLotId)

  const { error: activeErr } = await supabase.from("active_lots").insert([
    {
      item_id: itemId,
      lot_number: lotNumber,
      opened_date: openedDate,
      working_expiry_date: workingExpiry,
      actual_expiry_date: actualExpiry,
      quantity_left: `${unitsToMove} units`,
      status: "Active",
    },
  ])

  if (activeErr) throw activeErr

  await logActivity("Opened", "Item", lotNumber, `Opened ${unitsToMove} units for bench use.`)
}

export const logUsageInSupabase = async (
  activeLotId: string,
  currentQtyString: string,
  deductAmount: number,
  itemName: string,
  lotNumber: string
) => {
  const parts = currentQtyString.split(" ")
  const currentVal = parseInt(parts[0], 10)
  const label = parts.slice(1).join(" ")
  const newVal = currentVal - deductAmount

  if (newVal <= 0) {
    await supabase.from("active_lots").delete().eq("id", activeLotId)
    await logActivity("Used", itemName, lotNumber, `Used remaining ${currentVal} ${label}. Lot cleared.`)
  } else {
    await supabase
      .from("active_lots")
      .update({
        quantity_left: `${newVal} ${label}`,
        status: newVal < 5 ? "Low Volume" : "Active",
      })
      .eq("id", activeLotId)

    await logActivity("Used", itemName, lotNumber, `Deducted ${deductAmount} ${label}.`)
  }
}

export const deleteActiveLotInSupabase = async (
  activeLotId: string,
  itemName: string,
  lotNumber: string,
  reason: string
) => {
  const { error: deleteErr } = await supabase
    .from("active_lots")
    .delete()
    .eq("id", activeLotId)

  if (deleteErr) throw deleteErr

  await logActivity(
    "Deleted from Bench",
    itemName,
    lotNumber,
    `Deleted due to: ${reason}`
  )
}

export const deleteInventoryLotInSupabase = async (
  lotId: string,
  itemName: string,
  lotNumber: string,
  reason: string
) => {
  const { error } = await supabase
    .from("inventory_lots")
    .delete()
    .eq("id", lotId)

  if (error) throw error

  await logActivity(
    "Deleted from Storage",
    itemName,
    lotNumber,
    `Deleted due to: ${reason}`
  )
}

export const deleteRequestInSupabase = async (requestId: string) => {
  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)

  if (error) throw error
}

export interface DashboardStats {
  expiredCount: number
  urgentCount: number
  lowStockCount: number
  pendingRequests: number
  totalMonthlySpend: number
}

export const calculateDashboardStats = (
  inventory: InventoryGroup[],
  activeLots: LotInUseEntry[],
  requests: ReorderRequest[],
  settings: LabSettings
): DashboardStats => {
  const tz = settings.labTimezone
  const labToday = getLabCurrentDateStr(tz)
  const labDate = new Date(labToday + "T00:00:00")

  const expiredInventory = inventory.flatMap((g) => g.lots).filter((l) => daysUntilExpiry(l.expiry, tz) < 0).length
  const expiredBench = activeLots.filter(
    (l) => daysUntilExpiry(getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate), tz) < 0
  ).length

  const urgentInventory = inventory.flatMap((g) => g.lots).filter((l) => {
    const days = daysUntilExpiry(l.expiry, tz)
    return days >= 0 && days <= settings.expiringSoonDays
  }).length

  const lowStock = inventory.filter((g) => {
    const totalCount = g.lots.reduce((acc, lot) => acc + (lot.totalUnits || 0), 0)
    return totalCount <= settings.lowStockThreshold
  }).length

  const pending = requests.filter((r) => r.status === "Pending").length

  const currentMonth = labDate.getMonth()
  const currentYear = labDate.getFullYear()
  const monthlySpend = requests
    .filter((r) => {
      const d = new Date(r.dateRequested)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && r.status !== "Pending"
    })
    .reduce((sum, r) => sum + r.totalPrice, 0)

  return {
    expiredCount: expiredInventory + expiredBench,
    urgentCount: urgentInventory,
    lowStockCount: lowStock,
    pendingRequests: pending,
    totalMonthlySpend: monthlySpend,
  }
}
