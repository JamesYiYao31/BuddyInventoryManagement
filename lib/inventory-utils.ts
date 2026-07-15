import { supabase, signOutLocalOnRefreshFailure } from "./supabase"
import { initialsFromDisplayName } from "./user-initials"
import { getEarliestExpiry } from "./expiry-utils.ts"
import { setUserRole, setUserRoleErrorMessage } from "./set-user-role"

export { getEarliestExpiry }

export type SidebarPage = "dashboard" | "inventory" | "lotinuse" | "requests" | "activitylog" | "validation" | "analytics" | "labsharing" | "settings"
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
  validation_status?: string
}

export interface InventoryGroup {
  itemId: string
  name: string
  vendor?: string | null
  lots: LotEntry[]
  /** From `items` row; null → use lab_settings in UI/stats. */
  expiring_soon_days?: number | null
  urgent_days?: number | null
  low_stock_threshold?: number | null
}

/** Optional per-item overrides; null/undefined uses lab_settings. */
export interface ItemThresholdFields {
  expiring_soon_days?: number | null
  urgent_days?: number | null
  low_stock_threshold?: number | null
  working_expiry_days?: number | null
}

export interface Item {
  id: string
  name: string
  vendor: string | null
  vendor_sku: string | null
  requires_coa?: boolean
  requires_lot_validation?: boolean
  /** Nullable overrides; when null, use lab defaults. */
  expiring_soon_days?: number | null
  urgent_days?: number | null
  low_stock_threshold?: number | null
  working_expiry_days?: number | null
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
 * Waterfall barcode parser for lab reagent labels.
 *
 * Detects the barcode format from the raw scanned string and extracts
 * SKU, lot number, and expiry date where available. Used by both the
 * camera scanner (ZXing) and USB scanner input paths.
 *
 * **Format detection order:**
 * 1. **HIBC** (Health Industry Bar Code) — string starts with `+`
 *    Parses primary symbol (LIC + product code → SKU) and optional
 *    secondary symbol (`$$lot/date`). Handles YYDDD (Julian), YYMMDD,
 *    and MMDDYY date formats.
 * 2. **GS1-128 / DataMatrix** — string contains parenthesised AIs
 *    `(01)`, `(10)`, `(17)`, or a raw FNC1 stream starting with `01`
 *    followed by a 14-digit GTIN. Extracts AI 01 → SKU, AI 10 → lot,
 *    AI 17 → expiry.
 * 3. **Code 128 / plaintext fallback** — everything else. The entire
 *    trimmed string is treated as the SKU; lot and expiry are empty.
 *
 * **Return value contract:**
 * - `sku` is always a string (empty string if not extractable).
 * - `lot` is always a string (empty string if not present in the barcode).
 * - `expiry` is always a string in `YYYY-MM-DD` format if parsed,
 *   otherwise empty string.
 * - `format` indicates which parser branch was used.
 * - `raw` is the original unmodified input.
 *
 * **Known limitations (ZXing + iPad camera):**
 * - Long GS1-128 barcodes may not decode reliably on mobile cameras.
 * - Stacked double barcodes (two GS1 symbols on one label) only yield
 *   the first scan; the second arrives as a separate USB event.
 * - Neither limitation affects USB scanner input (Zebra DS confirmed).
 *
 * **Dynamsoft migration note:**
 * When migrating from ZXing to Dynamsoft, add one line at the top of
 * this function before format detection:
 * `const trimmed = raw.trim().replace(/\{GS\}/g, "\x1d")`
 * Dynamsoft uses `{GS}` as its FNC1 separator; this parser already
 * handles `\x1d` natively.
 *
 * @param raw - The raw string from the scanner (camera decode or USB input).
 * @returns ParsedBarcode with format, sku, lot, expiry, and raw fields.
 *
 * @example
 * // GS1 parenthesised
 * parseSmartBarcode("(01)00123456789012(10)LOT001(17)261231")
 * // → { format: "GS1", sku: "00123456789012", lot: "LOT001", expiry: "2026-12-31", raw: "..." }
 *
 * @example
 * // HIBC
 * parseSmartBarcode("+A123PRODUCTCODE/$$LOT42261231")
 * // → { format: "HIBC", sku: "A123PRODUCTCODE", lot: "LOT42", expiry: "2026-12-31", raw: "..." }
 *
 * @example
 * // Plain Code 128 fallback
 * parseSmartBarcode("SKU-98765")
 * // → { format: "CODE128", sku: "SKU-98765", lot: "", expiry: "", raw: "SKU-98765" }
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
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { data, error } = await supabase
    .from("items")
    .select(
      "id, name, vendor, vendor_sku, requires_coa, requires_lot_validation, expiring_soon_days, urgent_days, low_stock_threshold, working_expiry_days"
    )
    .eq("lab_id", labId)
    .order("name", { ascending: true })

  if (error) {
    console.error("Failed to fetch items:", error)
    return []
  }
  return data as Item[]
}

export const lookupItemByVendorSku = async (sku: string): Promise<Item | null> => {
  if (!sku) return null

  const labId = await resolveCurrentUserLabId()
  if (!labId) return null

  const { data, error } = await supabase
    .from("items")
    .select(
      "id, name, vendor, vendor_sku, requires_coa, requires_lot_validation, expiring_soon_days, urgent_days, low_stock_threshold, working_expiry_days"
    )
    .eq("lab_id", labId)
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
  /** When false, technicians see item threshold fields as read-only. */
  techsCanEditThresholds?: boolean
  /**
   * Display name of the laboratory. Appears on printed reports and report headers.
   * Falls back to the product name when the `lab_name` column is not yet populated
   * in Supabase so reports never render a blank masthead.
   */
  labName?: string
  requireCoaApproval?: boolean
}

export const LAB_SETTINGS_DEFAULTS: LabSettings = {
  lowStockThreshold: 5,
  expiringSoonDays: 30,
  urgentDays: 7,
  labTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  techDashboardWidget: "donut",
  techsCanEditThresholds: true,
  labName: "My Lab",
  requireCoaApproval: false,
}

export const fetchLabSettings = async (): Promise<LabSettings> => {
  const d = LAB_SETTINGS_DEFAULTS

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user?.id) return d

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, lab_id")
      .eq("id", session.user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[fetchLabSettings] Failed to load profile - using defaults.", {
        message: profileError?.message,
        details: profileError?.details,
        hint: profileError?.hint,
        code: profileError?.code,
      })
      return d
    }

    const isSuperAdmin = profile?.role === "super_admin"
    const labId = profile?.lab_id

    // super_admin users intentionally have no tenant context
    if (isSuperAdmin || !labId) return d

    const { data, error } = await supabase
      .from("lab_settings")
      .select(
        "low_stock_threshold, expiring_soon_days, urgent_days, lab_timezone, tech_dashboard_widget, techs_can_edit_thresholds"
      )
      .eq("lab_id", labId)
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
        .eq("lab_id", labId)
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
        techsCanEditThresholds: d.techsCanEditThresholds,
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
      techsCanEditThresholds: (data as { techs_can_edit_thresholds?: boolean }).techs_can_edit_thresholds ?? d.techsCanEditThresholds,
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
  const labId = await resolveCurrentUserLabId()
  if (!labId) {
    console.error("[updateLabSettings] No lab context — aborting.")
    return { success: false, error: "No lab context." }
  }

  const { error } = await supabase
    .from("lab_settings")
    .update({
      low_stock_threshold: settings.lowStockThreshold,
      expiring_soon_days: settings.expiringSoonDays,
      urgent_days: settings.urgentDays,
      tech_dashboard_widget: settings.techDashboardWidget,
      techs_can_edit_thresholds: settings.techsCanEditThresholds ?? true,
    })
    .eq("lab_id", labId)

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
        techs_can_edit_thresholds: settings.techsCanEditThresholds ?? true,
      })
      .eq("lab_id", labId)

    if (retry.error) {
      console.error("[updateLabSettings] Legacy retry failed — retrying without techs_can_edit_thresholds.", {
        message: retry.error?.message,
        details: retry.error?.details,
      })
      const retry2 = await supabase
        .from("lab_settings")
        .update({
          low_stock_threshold: settings.lowStockThreshold,
          expiring_soon_days: settings.expiringSoonDays,
          urgent_days: settings.urgentDays,
        })
        .eq("lab_id", labId)
      if (retry2.error) {
        console.error("[updateLabSettings] Second legacy retry failed.", {
          message: retry2.error?.message,
          details: retry2.error?.details,
        })
        return { success: false, error: retry2.error.message }
      }
      return { success: true }
    }
    return { success: true }
  }
  return { success: true }
}

export const createItem = async (
  name: string,
  vendor?: string,
  vendorSku?: string,
  requiresCoa?: boolean,
  requiresLotValidation?: boolean,
  thresholds?: ItemThresholdFields | null
): Promise<Item | null> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) {
    console.error("createItem: No lab context.")
    return null
  }
  const row: Record<string, any> = { name, lab_id: labId }
  if (vendor) row.vendor = vendor
  if (vendorSku) row.vendor_sku = vendorSku
  if (requiresCoa !== undefined) row.requires_coa = requiresCoa
  if (requiresLotValidation !== undefined) row.requires_lot_validation = requiresLotValidation

  if (thresholds) {
    row.expiring_soon_days = thresholds.expiring_soon_days ?? null
    row.urgent_days = thresholds.urgent_days ?? null
    row.low_stock_threshold = thresholds.low_stock_threshold ?? null
    row.working_expiry_days = thresholds.working_expiry_days ?? null
  }

  const { data, error } = await supabase
    .from("items")
    .insert([row])
    .select(
      "id, name, vendor, vendor_sku, requires_coa, requires_lot_validation, expiring_soon_days, urgent_days, low_stock_threshold, working_expiry_days"
    )
    .single()

  if (error) {
    console.error("Failed to create item:", error)
    return null
  }
  return data as Item
}

/** Calendar date `YYYY-MM-DD` plus whole days (no timezone drift vs lab date strings). */
export function addCalendarDays(dateStr: string, daysToAdd: number): string {
  if (!dateStr || !Number.isFinite(daysToAdd)) return dateStr
  const d = new Date(dateStr + "T12:00:00")
  d.setUTCDate(d.getUTCDate() + daysToAdd)
  return d.toISOString().slice(0, 10)
}

export const updateItemThresholds = async (
  itemId: string,
  thresholds: ItemThresholdFields
): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const row: Record<string, unknown> = {}
  if (thresholds.expiring_soon_days !== undefined) row.expiring_soon_days = thresholds.expiring_soon_days
  if (thresholds.urgent_days !== undefined) row.urgent_days = thresholds.urgent_days
  if (thresholds.low_stock_threshold !== undefined) row.low_stock_threshold = thresholds.low_stock_threshold
  if (thresholds.working_expiry_days !== undefined) row.working_expiry_days = thresholds.working_expiry_days

  const { error } = await supabase.from("items").update(row).eq("id", itemId).eq("lab_id", labId)

  if (error) {
    console.error("[updateItemThresholds] Failed:", error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

/** Suggested working expiry (capped by actual lot expiry) when `items.working_expiry_days` is set. */
export async function suggestWorkingExpiryDate(
  itemId: string,
  openedDate: string,
  actualExpiryDate: string
): Promise<string | null> {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return null

  const { data, error } = await supabase
    .from("items")
    .select("working_expiry_days")
    .eq("id", itemId)
    .eq("lab_id", labId)
    .maybeSingle()

  if (error || !data?.working_expiry_days || data.working_expiry_days < 1) return null

  const raw = addCalendarDays(openedDate, data.working_expiry_days)
  if (!actualExpiryDate) return raw
  return raw > actualExpiryDate ? actualExpiryDate : raw
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
  itemId?: string | null
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

export const createRequestInSupabase = async (
  input: RequestMutationInput
): Promise<{ error: any }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { error: "No lab context." }
  const { error } = await supabase
    .from("requests")
    .insert([
      {
        lab_id: labId,
        item_id: input.itemId ?? null,
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
  return { error }
}

export const updateRequestInSupabase = async (requestId: string, input: RequestMutationInput) => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { error: { message: "No lab context." } }
  return supabase
    .from("requests")
    .update({
      item_id: input.itemId ?? null,
      catalog_number: input.catalogNumber,
      item_name: input.itemName,
      vendor: input.vendor,
      order_qty: input.orderQty,
      unit_price: input.unitPrice,
      total_price: input.orderQty * input.unitPrice,
      notes: input.notes,
    })
    .eq("id", requestId)
    .eq("lab_id", labId)
}

export type ActivityActionType =
  | "Added"
  | "Opened"
  | "Used"
  | "Disposed"
  | "Ordered"
  | "Received"
  | "Edited"
  | "Deleted from Bench"
  | "Deleted from Storage"
  | "Approved Lot"
  | "Rejected Lot"
  | "Submitted COA"
  | "Submitted Lot Validation"
  | "Archived Lot"
  | "MFA Recovery Code Redeemed"
  | "MFA Recovery Code Redeem Failed"

export interface ActivityLogEntry {
  id: string
  createdAt: string
  date: string
  time: string
  user: string
  userInitials: string
  actionType: ActivityActionType
  itemName: string
  lotNumber: string
  details: string
}

export interface UsageReportRow {
  user_name: string
  user_initials: string
  item_name: string
  lot_number: string
  details: string
  created_at: string
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
  "Approved Lot": "bg-green-500/10 text-green-600 dark:text-green-400",
  "Rejected Lot": "bg-red-500/10 text-red-600 dark:text-red-400",
  "Submitted COA": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Submitted Lot Validation": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "Archived Lot": "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
}

export const fetchInventoryFromSupabase = async (): Promise<InventoryGroup[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { data, error } = await supabase
    .from("inventory_lots")
    .select(`*, items(name, vendor, expiring_soon_days, urgent_days, low_stock_threshold)`)
    .eq("lab_id", labId)

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
      validation_status: row.validation_status ?? "not_required",
    }

    if (!groups[name]) {
      groups[name] = {
        itemId: row.item_id,
        name,
        vendor: row.items?.vendor ?? null,
        lots: [],
        expiring_soon_days: row.items?.expiring_soon_days ?? null,
        urgent_days: row.items?.urgent_days ?? null,
        low_stock_threshold: row.items?.low_stock_threshold ?? null,
      }
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

  const initials = initialsFromDisplayName(name)

  return { userId: user.id, name, initials, email }
}

/**
 * Appends an immutable audit entry to `activity_logs`.
 *
 * This is the single authoritative function for writing to the ALCOA+
 * audit trail. It must be called AFTER a data-mutating operation
 * succeeds — never speculatively before the operation, and never inside
 * a transaction that might roll back.
 *
 * **Attribution model:**
 * The caller's identity is resolved server-side via `resolveCurrentUserIdentity()`,
 * which reads `profiles.full_name` and derives initials. The resulting
 * `user_name` and `user_initials` are stored as TEXT SNAPSHOTS on the
 * audit row — there is no `user_id` foreign key. This means audit
 * attribution is permanently preserved even if the user's account is
 * later deleted, satisfying the ALCOA+ "Attributable" and "Enduring"
 * principles.
 *
 * **Abort conditions (both silent — log errors, return without throw):**
 * - No authenticated session (`resolveCurrentUserIdentity()` returns null)
 * - No lab context (`resolveCurrentUserLabId()` returns null)
 *
 * Aborting silently rather than throwing prevents a log failure from
 * cascading into a broken UI state. The error is written to `console.error`
 * for Vercel log capture.
 *
 * **Immutability guarantee:**
 * The `activity_logs` table has RLS policies that permit INSERT only —
 * there are no UPDATE or DELETE policies. This cannot be overridden by
 * application code and is required for 21 CFR Part 11 §11.10(e).
 *
 * @param actionType - One of the allowed ActivityActionType values (see type definition).
 *   Represents the class of operation: "Added", "Opened", "Used", "Disposed",
 *   "Ordered", "Received", "Edited", "Deleted from Storage",
 *   "Deleted from Bench", "Approved Lot", "Rejected Lot",
 *   "Submitted Lot Validation", "Submitted COA", etc.
 * @param itemName - Display name of the reagent/item. May be empty string
 *   for actions not tied to a specific item.
 * @param lotNumber - Lot number string. May be empty string if not applicable.
 * @param details - Human-readable description of the specific action taken,
 *   including contextual identifiers (e.g. "Deducted 2 vials.", "Lot Approved
 *   by Jane Smith.", "Deleted due to: contamination").
 *
 * @returns void. Does not throw. Errors are logged to console.error only.
 *
 * @example
 * // After successfully updating lot quantity:
 * await logActivity("Used", "Reagent A", "LOT-001", "Deducted 2 vials.")
 *
 * @example
 * // After manager approves a lot:
 * await logActivity("Approved Lot", "", lotNumber, `Lot Approved by ${identity.name}`)
 */
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

  const labId = await resolveCurrentUserLabId()
  if (!labId) {
    console.error("[logActivity] No lab context — aborting.")
    return
  }

  const { error } = await supabase.from("activity_logs").insert([
    {
      lab_id: labId,
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
  isOwner: boolean
  isActive: boolean
  deactivatedAt: string | null
}

/**
 * Resolves the authenticated user's `lab_id` by querying the `profiles` table.
 *
 * This is the canonical way to get the current user's lab context in
 * client-side and server-action code. It reads the active Supabase session,
 * then looks up the user's `role` and `lab_id` from their `profiles` row.
 *
 * **Note on the JWT-side equivalent:** RLS policies use a separate DB-side
 * function `get_my_lab_id()` that reads `lab_id` from the JWT claim (stamped
 * by `custom_access_token_hook`). This application-side function instead
 * queries `profiles` directly. The two are kept consistent because the hook
 * sources the JWT `lab_id` claim from the same `profiles.lab_id` column.
 *
 * **Session handling:**
 * - Calls `supabase.auth.getSession()`. On a session/refresh error, invokes
 *   `signOutLocalOnRefreshFailure()` to clear a broken local session, then
 *   returns null.
 * - Returns null if there is no authenticated user.
 *
 * **Return value semantics:**
 * - Returns the user's `lab_id` UUID string for lab-scoped users (managers,
 *   technicians).
 * - Returns null for super_admin (explicitly checked — super_admin has no
 *   tenant context and must never be scoped to a lab).
 * - Returns null if the profiles lookup errors, or if `lab_id` is null
 *   (e.g. org_admin, who is org-scoped rather than lab-scoped).
 * - Returns null if there is no active session.
 *
 * All callers must treat a null return as "no lab context" and abort the
 * operation. This is a security boundary — proceeding without a lab_id would
 * result in unscoped database access, violating multi-tenant isolation.
 *
 * @returns The user's lab UUID string, or null if not available.
 *
 * @example
 * const labId = await resolveCurrentUserLabId()
 * if (!labId) return { success: false, error: "No lab context." }
 * // safe to use labId in lab-scoped queries
 */
export const resolveCurrentUserLabId = async (): Promise<string | null> => {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    await signOutLocalOnRefreshFailure(sessionError)
    return null
  }

  if (!session?.user?.id) return null

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, lab_id")
    .eq("id", session.user.id)
    .maybeSingle()

  if (error) {
    console.error("[resolveCurrentUserLabId] Failed to load profile:", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    })
    return null
  }

  // super_admin has no tenant context and must not be scoped to a lab
  if (profile?.role === "super_admin") return null
  return profile?.lab_id ?? null
}

export const fetchLabName = async (): Promise<string> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return "My Lab"

  const { data } = await supabase
    .from("labs")
    .select("name")
    .eq("id", labId)
    .maybeSingle()

  return data?.name ?? "My Lab"
}

export const fetchLabProfiles = async (): Promise<LabProfile[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { data: labRow, error: labError } = await supabase
    .from("labs")
    .select("owner_id")
    .eq("id", labId)
    .maybeSingle()

  if (labError) {
    console.error("[fetchLabProfiles] Failed to load lab owner:", {
      message: labError?.message,
      details: labError?.details,
      hint: labError?.hint,
      code: labError?.code,
    })
  }

  const ownerId: string | null = labRow?.owner_id ?? null

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, deactivated_at")
    .eq("lab_id", labId)
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

  // super_admin rows are filtered out here, so the Team Management UI can
  // never render a deactivate control for a super_admin.
  return (data || [])
    .filter((p: any) => p.role !== "super_admin")
    .map((p: any) => ({
      id: p.id,
      fullName: p.full_name || "",
      email: "",
      role: (p.role === "manager" ? "manager" : "technician") as "manager" | "technician",
      isOwner: Boolean(ownerId && p.id === ownerId),
      isActive: p.is_active !== false,
      deactivatedAt: p.deactivated_at ?? null,
    }))
}

export const updateUserRole = async (
  userId: string,
  newRole: "manager" | "technician"
): Promise<{ success: boolean; error?: string }> => {
  if ((newRole as string) === "super_admin") {
    return { success: false, error: "Cannot assign the super_admin role." }
  }

  const labId = await resolveCurrentUserLabId()
  if (!labId) {
    return { success: false, error: "Could not resolve current lab context." }
  }

  const { data: labRow, error: labFetchError } = await supabase
    .from("labs")
    .select("owner_id")
    .eq("id", labId)
    .maybeSingle()

  if (labFetchError) {
    console.error("[updateUserRole] Failed to read lab:", {
      message: labFetchError?.message,
      details: labFetchError?.details,
      hint: labFetchError?.hint,
      code: labFetchError?.code,
    })
    return { success: false, error: labFetchError.message }
  }
  if (labRow?.owner_id && userId === labRow.owner_id) {
    return { success: false, error: "Cannot change the lab owner's role." }
  }

  const { data: existing, error: fetchError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .eq("lab_id", labId)
    .maybeSingle()

  if (fetchError) {
    console.error("[updateUserRole] Failed to read profile:", {
      message: fetchError?.message,
      details: fetchError?.details,
      hint: fetchError?.hint,
      code: fetchError?.code,
    })
    return { success: false, error: fetchError.message }
  }
  if (!existing) {
    return { success: false, error: "User not found." }
  }
  if (existing.role === "super_admin") {
    return { success: false, error: "Cannot modify a super administrator." }
  }

  // Role column is locked from client UPDATE; governed via /api/users/set-role.
  const result = await setUserRole(userId, newRole)
  if (!result.ok) {
    return { success: false, error: setUserRoleErrorMessage(result.errorCode) }
  }
  return { success: true }
}

export function formatActivityLogTimestamp(
  createdAt: string,
  labTimezone: string = "UTC"
): { date: string; time: string } {
  let tz = labTimezone || "UTC"
  const d = new Date(createdAt)
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date())
  } catch {
    tz = "UTC"
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
  const timeBase = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d)
  const tzAbbr =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .format(d)
      .split(", ")[1]
      ?.split(" ")
      .pop() ?? tz
  const time = `${timeBase} ${tzAbbr}`
  return { date, time }
}

export const fetchLogsFromSupabase = async (): Promise<ActivityLogEntry[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { labTimezone } = await fetchLabSettings()
  const tz = labTimezone || "UTC"

  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("lab_id", labId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error(error)
    return []
  }

  return data.map((log: any) => {
    const { date, time } = formatActivityLogTimestamp(log.created_at, tz)
    return {
      id: log.id,
      createdAt: log.created_at,
      date,
      time,
      user: log.user_name,
      userInitials: log.user_initials,
      actionType: log.action_type,
      itemName: log.item_name,
      lotNumber: log.lot_number,
      details: log.details,
    }
  })
}

function formatInTimeZoneParts(timeZone: string, date: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

/**
 * Convert a wall-clock time in an IANA timezone (e.g. "America/Chicago") into a UTC Date.
 * Uses a small iterative correction to handle DST transitions without extra deps.
 */
export function zonedDateTimeToUtc(
  timeZone: string,
  opts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number; millisecond?: number }
): Date {
  const { year, month, day } = opts
  const hour = opts.hour ?? 0
  const minute = opts.minute ?? 0
  const second = opts.second ?? 0
  const millisecond = opts.millisecond ?? 0

  // Start with a UTC guess of the same components, then correct until the timezone-formatted
  // components match the desired wall clock time.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))

  for (let i = 0; i < 2; i++) {
    const got = formatInTimeZoneParts(timeZone, guess)
    const gotMs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second, 0)
    const wantMs = Date.UTC(year, month - 1, day, hour, minute, second, 0)
    const diffMs = wantMs - gotMs
    if (diffMs === 0) break
    guess = new Date(guess.getTime() + diffMs)
  }

  return guess
}

export function labDateRangeToUtcRange(
  labTimezone: string,
  fromDate: string,
  toDate: string
): { startIso: string; endIso: string } {
  const [fy, fm, fd] = fromDate.split("-").map(n => parseInt(n, 10))
  const [ty, tm, td] = toDate.split("-").map(n => parseInt(n, 10))
  const start = zonedDateTimeToUtc(labTimezone, { year: fy, month: fm, day: fd, hour: 0, minute: 0, second: 0, millisecond: 0 })
  const end = zonedDateTimeToUtc(labTimezone, { year: ty, month: tm, day: td, hour: 23, minute: 59, second: 59, millisecond: 999 })
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

export const fetchUsageLogsFromSupabase = async (params: {
  fromDate: string
  toDate: string
  labTimezone: string
}): Promise<UsageReportRow[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { startIso, endIso } = labDateRangeToUtcRange(params.labTimezone, params.fromDate, params.toDate)

  const { data, error } = await supabase
    .from("activity_logs")
    .select("user_name, user_initials, item_name, lot_number, details, created_at")
    .eq("lab_id", labId)
    .eq("action_type", "Used")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(2000)

  if (error) {
    console.error("[fetchUsageLogsFromSupabase] Failed:", error)
    return []
  }

  return (data || []) as UsageReportRow[]
}

export const fetchActiveLotsFromSupabase = async (): Promise<LotInUseEntry[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { data, error } = await supabase
    .from("active_lots")
    .select(`*, items(name)`)
    .eq("lab_id", labId)
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
  const labId = await resolveCurrentUserLabId()
  if (!labId) throw new Error("No lab context.")

  const { data: invLot, error: fetchErr } = await supabase
    .from("inventory_lots")
    .select("count, units, quantity_type, validation_status")
    .eq("id", inventoryLotId)
    .eq("lab_id", labId)
    .single()

  if (fetchErr || !invLot) throw new Error("Could not find inventory lot.")

  if (!["not_required", "approved", "archived"].includes(invLot.validation_status || "")) {
    throw new Error("This lot is not approved for bench use.")
  }

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
    .eq("lab_id", labId)

  const { error: activeErr } = await supabase.from("active_lots").insert([
    {
      lab_id: labId,
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

  const { data: itemInfo } = await supabase
    .from("items")
    .select("name")
    .eq("id", itemId)
    .eq("lab_id", labId)
    .maybeSingle()

  const openedItemName = itemInfo?.name || "Item"

  await logActivity("Opened", openedItemName, lotNumber, `Opened ${unitsToMove} units for bench use.`)
}

export const logUsageInSupabase = async (
  activeLotId: string,
  currentQtyString: string,
  deductAmount: number,
  itemName: string,
  lotNumber: string
) => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) {
    console.error("[logUsageInSupabase] No lab context — aborting.")
    return
  }

  const parts = currentQtyString.split(" ")
  const currentVal = parseInt(parts[0], 10)
  const label = parts.slice(1).join(" ")
  const newVal = currentVal - deductAmount

  if (newVal <= 0) {
    await supabase.from("active_lots").delete().eq("id", activeLotId).eq("lab_id", labId)
    await logActivity("Used", itemName, lotNumber, `Used remaining ${currentVal} ${label}. Lot cleared.`)
  } else {
    await supabase
      .from("active_lots")
      .update({
        quantity_left: `${newVal} ${label}`,
        status: newVal < 5 ? "Low Volume" : "Active",
      })
      .eq("id", activeLotId)
      .eq("lab_id", labId)

    await logActivity("Used", itemName, lotNumber, `Deducted ${deductAmount} ${label}.`)
  }
}

export const deleteActiveLotInSupabase = async (
  activeLotId: string,
  itemName: string,
  lotNumber: string,
  reason: string
) => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) throw new Error("No lab context.")

  const { error: deleteErr } = await supabase
    .from("active_lots")
    .delete()
    .eq("id", activeLotId)
    .eq("lab_id", labId)

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
  const labId = await resolveCurrentUserLabId()
  if (!labId) throw new Error("No lab context.")

  const { error } = await supabase
    .from("inventory_lots")
    .delete()
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (error) throw error

  await logActivity(
    "Deleted from Storage",
    itemName,
    lotNumber,
    `Deleted due to: ${reason}`
  )
}

export const deleteRequestInSupabase = async (requestId: string) => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) throw new Error("No lab context.")

  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)
    .eq("lab_id", labId)

  if (error) throw error
}

export interface DashboardStats {
  expiredCount: number
  /** Storage lots with 0..urgent_days until expiry (per-item thresholds). */
  urgentCount: number
  /** Storage lots with (urgent_days, expiring_soon_days] until expiry; disjoint from urgent. */
  expiringSoonCount: number
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

  let urgentLotCount = 0
  let expiringSoonLotCount = 0
  for (const g of inventory) {
    const urgentDays = g.urgent_days ?? settings.urgentDays
    const expiringSoonDays = g.expiring_soon_days ?? settings.expiringSoonDays
    for (const l of g.lots) {
      const days = daysUntilExpiry(l.expiry, tz)
      if (days < 0) continue
      if (days <= urgentDays) urgentLotCount++
      else if (days <= expiringSoonDays) expiringSoonLotCount++
    }
  }

  const benchUrgentDays = settings.urgentDays
  const benchExpiringSoonDays = settings.expiringSoonDays
  for (const l of activeLots) {
    const eff = getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate)
    const days = daysUntilExpiry(eff, tz)
    if (days < 0) continue
    if (days <= benchUrgentDays) urgentLotCount++
    else if (days <= benchExpiringSoonDays) expiringSoonLotCount++
  }

  const lowStock = inventory.filter((g) => {
    const thresh = g.low_stock_threshold ?? settings.lowStockThreshold
    const totalCount = g.lots.reduce((acc, lot) => acc + (lot.totalUnits || 0), 0)
    return totalCount <= thresh
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
    urgentCount: urgentLotCount,
    expiringSoonCount: expiringSoonLotCount,
    lowStockCount: lowStock,
    pendingRequests: pending,
    totalMonthlySpend: monthlySpend,
  }
}

// ── VALIDATION & COA ──

export type ValidationStatus =
  | "not_required"
  | "pending_coa"
  | "pending_validation"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "archived"

export interface ValidationQueueEntry {
  lotId: string
  itemId: string
  itemName: string
  lotNumber: string
  expiryDate: string
  receivedDate: string
  validationStatus: ValidationStatus
  has_coa_record: boolean
  has_validation_record: boolean
  requires_coa: boolean
  requires_lot_validation: boolean
}

export const fetchValidationQueue = async (): Promise<ValidationQueueEntry[]> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return []

  const { data, error } = await supabase
    .from("inventory_lots")
    .select("id, item_id, lot_number, expiry_date, received_date, validation_status, items(name, requires_coa, requires_lot_validation)")
    .eq("lab_id", labId)
    .in("validation_status", ["pending_coa", "pending_validation", "pending_approval"])
    .order("received_date", { ascending: false })

  if (error) {
    console.error("[fetchValidationQueue] Failed:", error)
    return []
  }

  const lotIds = (data || []).map((row: any) => row.id)
  const coaLotIds = new Set<string>()
  const validationLotIds = new Set<string>()

  if (lotIds.length > 0) {
    const [{ data: coaRows }, { data: validationRows }] = await Promise.all([
      supabase
        .from("coa_records")
        .select("lot_id")
        .eq("lab_id", labId)
        .in("lot_id", lotIds),
      supabase
        .from("lot_validation_records")
        .select("lot_id")
        .eq("lab_id", labId)
        .in("lot_id", lotIds),
    ])

    for (const row of coaRows || []) coaLotIds.add(row.lot_id)
    for (const row of validationRows || []) validationLotIds.add(row.lot_id)
  }

  return (data || []).map((row: any) => ({
    lotId: row.id,
    itemId: row.item_id,
    itemName: row.items?.name || "Unknown",
    lotNumber: row.lot_number,
    expiryDate: row.expiry_date,
    receivedDate: row.received_date,
    validationStatus: row.validation_status as ValidationStatus,
    has_coa_record: coaLotIds.has(row.id),
    has_validation_record: validationLotIds.has(row.id),
    requires_coa: Boolean(row.items?.requires_coa),
    requires_lot_validation: Boolean(row.items?.requires_lot_validation),
  }))
}

export const submitLotValidation = async (
  lotId: string,
  previousLotNumber: string,
  result: string,
  notes: string,
  fileUrl: string,
  fileName: string
): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const identity = await resolveCurrentUserIdentity()
  if (!identity) return { success: false, error: "Not authenticated." }

  const { error: insertError } = await supabase.from("lot_validation_records").insert([{
    lab_id: labId,
    lot_id: lotId,
    previous_lot_number: previousLotNumber,
    result,
    notes,
    file_url: fileUrl,
    file_name: fileName,
    submitted_by: identity.name,
    submitted_at: new Date().toISOString(),
  }])

  if (insertError) {
    console.error("[submitLotValidation] Insert failed:", insertError)
    return { success: false, error: insertError.message }
  }

  const { data: lotData } = await supabase
    .from("inventory_lots")
    .select("item_id, lot_number, items(requires_coa)")
    .eq("id", lotId)
    .eq("lab_id", labId)
    .single()

  // Lot validation always requires manager approval
  // regardless of COA status or lab settings
  let newStatus = "pending_approval"

  // Only exception: if item also requires COA and it
  // hasn't been submitted yet, stay on pending_coa
  const requiresCoa = (lotData?.items as any)?.requires_coa ?? false
  if (requiresCoa) {
    const { data: coaData } = await supabase
      .from("coa_records")
      .select("id")
      .eq("lot_id", lotId)
      .eq("lab_id", labId)
      .maybeSingle()
    if (!coaData) newStatus = "pending_coa"
  }

  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({ validation_status: newStatus })
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (updateError) {
    console.error("[submitLotValidation] Status update failed:", updateError)
    return { success: false, error: updateError.message }
  }

  await logActivity(
    "Submitted Lot Validation",
    "",
    lotData?.lot_number ?? lotId,
    `Lot Validation submitted by ${identity.name}`
  )

  return { success: true }
}

export const submitCOARecord = async (
  lotId: string,
  fileUrl: string,
  fileName: string,
  lotNumber: string,
  expiryDate: string,
  notes: string
): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const identity = await resolveCurrentUserIdentity()
  if (!identity) return { success: false, error: "Not authenticated." }

  const { error: insertError } = await supabase.from("coa_records").insert([{
    lab_id: labId,
    lot_id: lotId,
    file_url: fileUrl,
    file_name: fileName,
    lot_number: lotNumber,
    expiry_date: expiryDate,
    notes,
    uploaded_by: identity.name,
    uploaded_at: new Date().toISOString(),
  }])

  if (insertError) {
    console.error("[submitCOARecord] Insert failed:", insertError)
    return { success: false, error: insertError.message }
  }

  const { data: settingsData } = await supabase
    .from("lab_settings")
    .select("require_coa_approval")
    .eq("lab_id", labId)
    .maybeSingle()

  const requireApproval = settingsData?.require_coa_approval ?? false

  let newStatus: string
  if (requireApproval) {
    newStatus = "pending_approval"
  } else {
    const { data: lotData } = await supabase
      .from("inventory_lots")
      .select("item_id, items(requires_lot_validation)")
      .eq("id", lotId)
      .eq("lab_id", labId)
      .single()
  
    const requiresLotValidation = 
      (lotData?.items as any)?.requires_lot_validation ?? false
  
    if (requiresLotValidation) {
      // Check if lot validation already submitted
      const { data: validationData } = await supabase
        .from("lot_validation_records")
        .select("id")
        .eq("lot_id", lotId)
        .eq("lab_id", labId)
        .maybeSingle()
      
      // If validation already done → pending_approval
      // If validation not yet done → pending_validation (tech needs to submit it)
      newStatus = validationData ? "pending_approval" : "pending_validation"
    } else {
      newStatus = "approved"
    }
  }

  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({ validation_status: newStatus })
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (updateError) {
    console.error("[submitCOARecord] Status update failed:", updateError)
    return { success: false, error: updateError.message }
  }

  await logActivity(
    "Submitted COA",
    "",
    lotNumber,
    `COA uploaded by ${identity.name}`
  )

  return { success: true }
}

export const approveLot = async (lotId: string): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const identity = await resolveCurrentUserIdentity()
  if (!identity) return { success: false, error: "Not authenticated." }

  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({ validation_status: "approved" })
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (updateError) {
    console.error("[approveLot] Status update failed:", updateError)
    return { success: false, error: updateError.message }
  }

  await supabase
    .from("lot_validation_records")
    .update({ approved_by: identity.name, approved_at: new Date().toISOString() })
    .eq("lot_id", lotId)
    .eq("lab_id", labId)

  const { data: lotInfo } = await supabase
    .from("inventory_lots")
    .select("lot_number")
    .eq("id", lotId)
    .single()
  const lotNumber = lotInfo?.lot_number ?? lotId

  await logActivity(
    "Approved Lot",
    "",
    lotNumber,
    `Lot Approved by ${identity.name}`
  )

  return { success: true }
}

export const rejectLot = async (lotId: string, reason: string): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const identity = await resolveCurrentUserIdentity()
  if (!identity) return { success: false, error: "Not authenticated." }

  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({ validation_status: "rejected" })
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (updateError) {
    console.error("[rejectLot] Status update failed:", updateError)
    return { success: false, error: updateError.message }
  }

  await supabase
    .from("lot_validation_records")
    .update({ rejection_reason: reason })
    .eq("lot_id", lotId)
    .eq("lab_id", labId)

  const { data: lotInfo } = await supabase
    .from("inventory_lots")
    .select("lot_number")
    .eq("id", lotId)
    .single()
  const lotNumber = lotInfo?.lot_number ?? lotId

  await logActivity(
    "Rejected Lot",
    "",
    lotNumber,
    `Lot Rejected by ${identity.name}. Reason: ${reason}`
  )

  return { success: true }
}

export const archiveLotToHistory = async (lotId: string): Promise<{ success: boolean; error?: string }> => {
  const labId = await resolveCurrentUserLabId()
  if (!labId) return { success: false, error: "No lab context." }

  const identity = await resolveCurrentUserIdentity()
  if (!identity) return { success: false, error: "Not authenticated." }

  const { data: lotInfo } = await supabase
    .from("inventory_lots")
    .select("lot_number")
    .eq("id", lotId)
    .eq("lab_id", labId)
    .single()
  const lotNumber = lotInfo?.lot_number ?? lotId

  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({
      validation_status: "archived",
      validation_archived_at: new Date().toISOString(),
    })
    .eq("id", lotId)
    .eq("lab_id", labId)

  if (updateError) {
    console.error("[archiveLotToHistory] Status update failed:", updateError)
    return { success: false, error: updateError.message }
  }

  await logActivity(
    "Archived Lot",
    "",
    lotNumber,
    `Lot moved to history by ${identity.name}`
  )

  return { success: true }
}

export const uploadCOAFile = async (
  lotId: string,
  labId: string,
  file: File
): Promise<{ fileUrl: string; fileName: string } | null> => {
  // Change the path to include a timestamp to avoid conflicts
  const timestamp = Date.now()
  const path = `${labId}/${lotId}/${timestamp}_${file.name}`

  const { error } = await supabase.storage
    .from("coa-documents")
    .upload(path, file, { upsert: true })

  if (error) {
    console.error("[uploadCOAFile] Upload failed:", error)
    return null
  }

  const { data: urlData, error: urlError } = await supabase.storage
    .from("coa-documents")
    .createSignedUrl(path, 60 * 60 * 24 * 365) // 1 year expiry

  if (urlError || !urlData?.signedUrl) {
    console.error("[uploadCOAFile] URL generation failed:", urlError)
    return null
  }

  return { fileUrl: urlData.signedUrl, fileName: file.name }
}
