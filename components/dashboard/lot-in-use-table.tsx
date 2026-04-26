"use client"

import React, { useState, useRef, useEffect } from "react"
import { Printer, PackageOpen, AlertCircle, Scan, Minus, X, CheckCircle2, ShieldAlert, List, Trash2, History, AlertTriangle } from "lucide-react"
import BarcodeCameraScanner from "@/components/dashboard/barcode-camera-scanner"
import {
  LotInUseEntry,
  LOT_IN_USE_STYLES,
  daysUntilExpiry,
  getEarliestExpiry,
  getLabCurrentDateStr,
  parseSmartBarcode,
  lookupItemByVendorSku,
  InventoryGroup,
  LotEntry,
  LabSettings,
  logUsageInSupabase,
  openNewLotInSupabase,
  deleteActiveLotInSupabase,
  suggestWorkingExpiryDate,
  addCalendarDays,
  fetchUsageLogsFromSupabase,
  UsageReportRow,
  resolveCurrentUserLabId,
} from "@/lib/inventory-utils"
import { supabase } from "@/lib/supabase"

interface LotInUseTabProps {
  activeLots: LotInUseEntry[]
  inventory: InventoryGroup[]
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
  labSettings: LabSettings
  labName?: string
  /** Display name of the currently authenticated lab member (used in the print masthead). */
  currentUserName?: string
}

export default function LotInUseTab({ activeLots, inventory, refreshData, userRole, labSettings, labName, currentUserName }: LotInUseTabProps) {
  const OPENABLE_VALIDATION_STATUSES = new Set(["not_required", "approved"])
  const canOpenInventoryLot = (lot: LotEntry) => OPENABLE_VALIDATION_STATUSES.has(lot.validation_status || "not_required")

  // ── PRINT METADATA ──
  const reportLabName = labName || labSettings.labName || "My Lab"
  const printUserName = (currentUserName || "Unknown User").toUpperCase()
  const printGeneratedDate = getLabCurrentDateStr(labSettings.labTimezone)
  // ── MODAL STATES ──
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanMode, setScanMode] = useState<"use" | "open">("use") 
  
  const [showManualModal, setShowManualModal] = useState(false)
  const [manualMode, setManualMode] = useState<"use" | "open">("use")
  const [selectedManualLotId, setSelectedManualLotId] = useState("")

  const [showUsageModal, setShowUsageModal] = useState<LotInUseEntry | null>(null)
  const [deductAmount, setDeductAmount] = useState<number>(1)
  const [usageLabel, setUsageLabel] = useState<string>("units")
  const [maxUsage, setMaxUsage] = useState<number>(999)
  
  const [showOpenModal, setShowOpenModal] = useState<any>(null)
  const [openAmount, setOpenAmount] = useState<number>(1)
  const [openedDate, setOpenedDate] = useState("")
  const [workingExpiry, setWorkingExpiry] = useState("")
  const [showFefoWarningModal, setShowFefoWarningModal] = useState(false)
  const [fefoWarningData, setFefoWarningData] = useState<{
    itemName: string
    currentLotId: string
    currentLotNumber: string
    currentExpiryDate: string
    suggestedLotId: string
    suggestedLotNumber: string
    suggestedExpiryDate: string
  } | null>(null)

  const [showDeleteModal, setShowDeleteModal] = useState<LotInUseEntry | null>(null)
  const [deleteReasonType, setDeleteReasonType] = useState<string>("Expired")
  const [deleteCustomReason, setDeleteCustomReason] = useState("")

  // ── USAGE REPORT MODAL ──
  type UsageDatePreset = "today" | "last7" | "last30" | "custom"
  const [showUsageReportModal, setShowUsageReportModal] = useState(false)
  const [usagePreset, setUsagePreset] = useState<UsageDatePreset>("today")
  const [usageFrom, setUsageFrom] = useState<string>(getLabCurrentDateStr(labSettings.labTimezone))
  const [usageTo, setUsageTo] = useState<string>(getLabCurrentDateStr(labSettings.labTimezone))
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageRows, setUsageRows] = useState<UsageReportRow[]>([])
  const [usageError, setUsageError] = useState<string | null>(null)
  const [printingUsageReport, setPrintingUsageReport] = useState(false)

  // ── SCANNER STATE ──
  const [barcodeInput, setBarcodeInput] = useState("")
  const [scanInputMode, setScanInputMode] = useState<"usb" | "camera">("usb")
  const [scanCameraError, setScanCameraError] = useState("")
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showScanModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showScanModal, scanMode, scanInputMode])

  useEffect(() => {
    if (showScanModal) return
    setScanInputMode("usb")
    setScanCameraError("")
  }, [showScanModal])

  useEffect(() => {
    if (!showManualModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowManualModal(false)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showManualModal])

  useEffect(() => {
    if (!showScanModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowScanModal(false)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showScanModal])

  useEffect(() => {
    if (!showUsageModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowUsageModal(null)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showUsageModal])

  useEffect(() => {
    if (!showDeleteModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDeleteModal(null)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showDeleteModal])

  useEffect(() => {
    if (!showOpenModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowOpenModal(null)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showOpenModal])

  useEffect(() => {
    if (!showFefoWarningModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowFefoWarningModal(false)
        setFefoWarningData(null)
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showFefoWarningModal])

  useEffect(() => {
    if (!showUsageReportModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowUsageReportModal(false)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showUsageReportModal])

  const handlePrint = () => window.print()

  const formatUsageDateTime = (iso: string) => {
    const d = new Date(iso)
    return new Intl.DateTimeFormat(undefined, {
      timeZone: labSettings.labTimezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d)
  }

  const parseQuantityUsed = (details: string): string => {
    const raw = (details || "").trim()
    const m1 = raw.match(/Deducted\s+(\d+)\s+(.+?)(?:\.|$)/i)
    if (m1) return `${m1[1]} ${m1[2].trim()}`
    const m2 = raw.match(/Used\s+remaining\s+(\d+)\s+(.+?)(?:\.|$)/i)
    if (m2) return `${m2[1]} ${m2[2].trim()}`
    const m3 = raw.match(/(\d+)\s+([a-zA-Z][a-zA-Z\s]*)/i)
    if (m3) return `${m3[1]} ${m3[2].trim()}`
    return "—"
  }

  const resolvePresetDates = (preset: UsageDatePreset) => {
    const today = getLabCurrentDateStr(labSettings.labTimezone)
    if (preset === "today") return { from: today, to: today }
    if (preset === "last7") return { from: addCalendarDays(today, -6), to: today }
    if (preset === "last30") return { from: addCalendarDays(today, -29), to: today }
    return { from: usageFrom || today, to: usageTo || today }
  }

  const loadUsageReport = async (override?: Partial<{ preset: UsageDatePreset; from: string; to: string }>) => {
    const preset = override?.preset ?? usagePreset
    const { from, to } = preset === "custom"
      ? { from: override?.from ?? usageFrom, to: override?.to ?? usageTo }
      : resolvePresetDates(preset)

    if (!from || !to) return

    setUsageLoading(true)
    setUsageError(null)
    try {
      const rows = await fetchUsageLogsFromSupabase({
        fromDate: from,
        toDate: to,
        labTimezone: labSettings.labTimezone,
      })
      setUsageRows(rows)
    } catch (e: any) {
      setUsageRows([])
      setUsageError(e?.message || "Failed to load usage logs.")
    } finally {
      setUsageLoading(false)
    }
  }

  useEffect(() => {
    if (!showUsageReportModal) return
    void loadUsageReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUsageReportModal])

  useEffect(() => {
    if (!printingUsageReport) return
    const handleAfterPrint = () => setPrintingUsageReport(false)
    window.addEventListener("afterprint", handleAfterPrint)
    return () => window.removeEventListener("afterprint", handleAfterPrint)
  }, [printingUsageReport])

  const exportUsageCsv = () => {
    const escape = (v: string) => {
      const s = (v ?? "").replace(/\r?\n/g, " ").trim()
      if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }

    const header = ["Date/Time", "Item Name", "Lot Number", "Quantity Used", "Used By"]
    const lines = [
      header.join(","),
      ...usageRows.map(r => ([
        formatUsageDateTime(r.created_at),
        r.item_name || "",
        r.lot_number || "",
        parseQuantityUsed(r.details),
        r.user_name || "",
      ]).map(escape).join(",")),
    ]
    const csv = lines.join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const stamp = getLabCurrentDateStr(labSettings.labTimezone)
    a.href = url
    a.download = `usage-report-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handlePrintUsageReport = () => {
    setPrintingUsageReport(true)
    setTimeout(() => window.print(), 50)
  }

  // ── LOGIC: DEDUCTION ──
  const handleConfirmDeduction = async () => {
    if (!showUsageModal) return;
    try {
      await logUsageInSupabase(
        showUsageModal.id,
        showUsageModal.quantityLeft,
        deductAmount,
        showUsageModal.itemName,
        showUsageModal.lotNumber
      );
      setShowUsageModal(null);
      await refreshData();
    } catch (error) {
      alert("Error updating usage.");
    }
  };

  // ── LOGIC: DELETE FROM BENCH ──
  const DELETE_REASONS = ["Expired", "Contaminated / Bad Lot", "QC Failure", "Other"] as const

  const handleConfirmDelete = async () => {
    if (!showDeleteModal) return
    const reason = deleteReasonType === "Other" ? deleteCustomReason.trim() : deleteReasonType
    if (!reason) return alert("Please provide a reason for deletion.")
    try {
      await deleteActiveLotInSupabase(
        showDeleteModal.id,
        showDeleteModal.itemName,
        showDeleteModal.lotNumber,
        reason
      )
      setShowDeleteModal(null)
      setDeleteReasonType("Expired")
      setDeleteCustomReason("")
      await refreshData()
    } catch {
      alert("Error deleting lot from bench.")
    }
  }

  // ── LOGIC: OPEN NEW LOT (Storage -> Bench) ──
  const clampWorkingExpiry = (working: string, actual: string): string => {
    if (!working) return actual
    if (!actual) return working
    return working > actual ? actual : working
  }

  const handleConfirmOpen = async (skipFefoCheck: boolean = false) => {
    if (!showOpenModal) return

    if (openAmount < 1) return alert("Enter at least 1 unit to move to the bench.")
    if (openAmount > showOpenModal.totalUnits) return alert("Cannot move more units than are in storage for this lot.")

    if (!skipFefoCheck && showOpenModal.itemId && showOpenModal.expiry) {
      const labId = await resolveCurrentUserLabId()
      if (labId) {
        const { data: earlierLots, error: earlierLotsError } = await supabase
          .from("inventory_lots")
          .select("id, lot_number, expiry_date")
          .eq("lab_id", labId)
          .eq("item_id", showOpenModal.itemId)
          .eq("status", "In Storage")
          .neq("id", showOpenModal.lotId)
          .lt("expiry_date", showOpenModal.expiry)
          .in("validation_status", ["approved", "not_required"])
          .order("expiry_date", { ascending: true })
          .limit(1)

        if (!earlierLotsError && earlierLots && earlierLots.length > 0) {
          const suggested = earlierLots[0]
          setFefoWarningData({
            itemName: showOpenModal.itemName,
            currentLotId: showOpenModal.lotId,
            currentLotNumber: showOpenModal.lot,
            currentExpiryDate: showOpenModal.expiry,
            suggestedLotId: suggested.id,
            suggestedLotNumber: suggested.lot_number,
            suggestedExpiryDate: suggested.expiry_date,
          })
          setShowFefoWarningModal(true)
          return
        }
      }
    }

    const opened = openedDate || getLabCurrentDateStr(labSettings.labTimezone)
    let workingCandidate = workingExpiry.trim()
    if (!workingCandidate && showOpenModal.itemId) {
      const suggested = await suggestWorkingExpiryDate(
        showOpenModal.itemId,
        opened,
        showOpenModal.expiry
      )
      if (suggested) workingCandidate = suggested
    }

    const finalWorkingExpiry = clampWorkingExpiry(
      workingCandidate || showOpenModal.expiry,
      showOpenModal.expiry
    )

    try {
      await openNewLotInSupabase(
        showOpenModal.lotId,
        showOpenModal.itemId || "",
        showOpenModal.lot,
        showOpenModal.expiry,
        finalWorkingExpiry,
        openAmount,
        opened
      )
      setShowOpenModal(null)
      setOpenedDate("")
      setWorkingExpiry("")
      await refreshData()
    } catch (error: any) {
      alert(error.message)
    }
  }

  // ── LOGIC: MANUAL BROWSE SELECT ──
  const handleManualSubmit = () => {
    if (!selectedManualLotId) return;
    
    if (manualMode === "use") {
      // Find the active lot on the bench
      const found = activeLots.find(l => l.id === selectedManualLotId);
      if (found) {
        setShowManualModal(false);
        setSelectedManualLotId("");
        triggerManualUsage(found);
      }
    } else {
      // Find the storage lot in inventory
      let foundLot = null;
      let foundName = "";
      for (const group of inventory) {
        const match = group.lots.find(l => l.lotId === selectedManualLotId && canOpenInventoryLot(l));
        if (match) { foundLot = match; foundName = group.name; break; }
      }
      if (foundLot) {
        setShowManualModal(false);
        setSelectedManualLotId("");
        setOpenAmount(1);
        setOpenedDate(getLabCurrentDateStr(labSettings.labTimezone));
        setWorkingExpiry("");
        setShowOpenModal({ ...foundLot, itemName: foundName });
      }
    }
  };

  // ── SCAN LOGIC ──
  const failToManual = () => {
    alert("Lot not found in current context")
    setShowScanModal(false)
    setManualMode(scanMode)
    setSelectedManualLotId("")
    setShowManualModal(true)
  }

  const handleScan = async (code: string) => {
    const parsed = parseSmartBarcode(code)
    const parsedLot = (parsed.lot || "").trim() || code.trim()
    const parsedSku = (parsed.sku || "").trim()

    if (!parsedLot && !parsedSku) return failToManual()

    if (scanMode === "use") {
      // Primary match: lot number strictly equals parsed lot
      if (parsedLot) {
        const found = (activeLots || []).find(l => l.lotNumber === parsedLot)
        if (found) {
          setShowScanModal(false)
          triggerManualUsage(found)
          return
        }
      }

      // Fallback match (lazy barcode): no lot, but SKU exists → lookup item → match by itemId
      if (!parsedLot && parsedSku) {
        const catalogItem = await lookupItemByVendorSku(parsedSku)
        if (catalogItem) {
          const foundByItem = (activeLots || []).find(l => l.itemId === catalogItem.id)
          if (foundByItem) {
            setShowScanModal(false)
            triggerManualUsage(foundByItem)
            return
          }
        }
      }

      return failToManual()
    }

    // scanMode === "open" (Storage search)
    if (parsedLot) {
      let blockedInvLot: any = null
      let foundInvLot: any = null
      let foundInvName = ""
      for (const group of inventory) {
        const blockedMatch = group.lots.find(l => l.lot === parsedLot && !canOpenInventoryLot(l))
        if (blockedMatch) blockedInvLot = blockedMatch
        const match = group.lots.find(l => l.lot === parsedLot && canOpenInventoryLot(l))
        if (match) { foundInvLot = match; foundInvName = group.name; break; }
      }

      if (foundInvLot) {
        setShowScanModal(false)
        setOpenAmount(1)
        setOpenedDate(getLabCurrentDateStr(labSettings.labTimezone))
        setWorkingExpiry("")
        setShowOpenModal({ ...foundInvLot, itemName: foundInvName })
        return
      }

      if (blockedInvLot) {
        alert("This lot is not approved for bench use.")
        return
      }
    }

    return failToManual()
  };

  const triggerManualUsage = (lot: LotInUseEntry) => {
    const qtyParts = lot.quantityLeft.split(" ");
    setMaxUsage(parseInt(qtyParts[0]) || 0);
    setUsageLabel(qtyParts.slice(1).join(" ") || "units");
    setDeductAmount(1);
    setShowUsageModal(lot);
  }

  const handleOpenSuggestedFefoLot = () => {
    if (!fefoWarningData) return
    let suggestedLot: LotEntry | null = null
    let suggestedItemName = fefoWarningData.itemName
    for (const group of inventory) {
      const match = group.lots.find(l => l.lotId === fefoWarningData.suggestedLotId && canOpenInventoryLot(l))
      if (match) {
        suggestedLot = match
        suggestedItemName = group.name
        break
      }
    }
    if (!suggestedLot) {
      setShowFefoWarningModal(false)
      setFefoWarningData(null)
      alert("Suggested lot is no longer available to open.")
      return
    }

    setShowFefoWarningModal(false)
    setFefoWarningData(null)
    setOpenAmount(1)
    setOpenedDate(getLabCurrentDateStr(labSettings.labTimezone))
    setWorkingExpiry("")
    setShowOpenModal({ ...suggestedLot, itemName: suggestedItemName })
  }

  return (
    <div className="relative flex flex-col gap-6">
      
      {/* ── 1. SCREEN HEADER (Hidden on Print) ── */}
      <div className={`flex flex-wrap items-center justify-between gap-4 print:hidden ${printingUsageReport ? "hidden" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lot in Use</h1>
          <p className="text-sm text-muted-foreground mt-1">Active reagents currently on the bench.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
          <button onClick={() => { setScanMode("use"); setShowScanModal(true); setBarcodeInput(""); setScanInputMode("usb"); setScanCameraError(""); }} className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>
          <button onClick={() => { setManualMode("use"); setShowManualModal(true); setSelectedManualLotId(""); }} className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-all">
            <List className="size-5" /> Manual Select
          </button>
          <button
            onClick={() => {
              const today = getLabCurrentDateStr(labSettings.labTimezone)
              setUsagePreset("today")
              setUsageFrom(today)
              setUsageTo(today)
              setUsageRows([])
              setUsageError(null)
              setShowUsageReportModal(true)
            }}
            className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all"
          >
            <History className="size-5 text-muted-foreground" /> Usage Report
          </button>
          <button onClick={handlePrint} className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all">
            <Printer className="size-5 text-muted-foreground" /> Print Report
          </button>
        </div>
      </div>

      {/* ── 2. PROFESSIONAL PRINT HEADER (Visible ONLY on Print) ── */}
      <div className={`hidden space-y-5 mb-6 border-b-2 border-zinc-900 pb-6 ${printingUsageReport ? "print:hidden" : "print:block"}`}>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 print:text-2xl">Reagent Usage Report</h1>
            <p className="text-zinc-500 font-medium mt-1">{reportLabName} | Clinical Laboratory Management</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-black text-emerald-600">ACTIVE BENCH INVENTORY</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 pt-2">
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Current User</p>
            <p className="text-lg font-bold text-zinc-900">{printUserName}</p>
          </div>
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generated Date</p>
            <p className="text-lg font-bold text-zinc-900">{printGeneratedDate}</p>
          </div>
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Lab Timezone</p>
            <p className="text-lg font-bold text-zinc-900">{labSettings.labTimezone}</p>
          </div>
        </div>
      </div>

      {/*
        ── 3. MAIN TABLE ──
        Rendered as a real <table> so that:
          (a) <thead> and <tfoot> repeat automatically on every printed page, and
          (b) column widths align flawlessly across <th> / <td> pairs on paper.
      */}
      <div className="block sm:hidden space-y-3 p-4">
        {(activeLots || []).length > 0 ? (
          activeLots.map((lot) => {
            const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
            const daysLeft = daysUntilExpiry(effectiveExpiry, labSettings.labTimezone)
            const isExpired = daysLeft < 0
            return (
              <div key={lot.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{lot.itemName}</p>
                    <p className="text-xs font-mono text-primary">Lot {lot.lotNumber}</p>
                  </div>
                  <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${isExpired ? LOT_IN_USE_STYLES["Expired"] : LOT_IN_USE_STYLES[lot.status as keyof typeof LOT_IN_USE_STYLES]}`}>
                    {isExpired ? "Expired" : lot.status}
                  </span>
                </div>
                <div className="mb-3 space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Opened</span>
                    <span className="text-foreground font-medium">{lot.openedDate || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Working Exp</span>
                    <span className={`font-medium ${daysLeft <= 7 ? "text-red-500" : "text-foreground"}`}>{lot.workingExpiryDate || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Actual Exp</span>
                    <span className="text-foreground font-medium">{lot.actualExpiryDate || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Qty Left</span>
                    <span className="text-foreground font-bold">{lot.quantityLeft}</span>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => triggerManualUsage(lot)} className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all" title="Deduct usage">
                    <Minus className="size-5" />
                  </button>
                  <button onClick={() => { setDeleteReasonType("Expired"); setDeleteCustomReason(""); setShowDeleteModal(lot); }} className="flex items-center justify-center size-8 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all" title="Delete from bench">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">No active lots on the bench.</div>
        )}
      </div>

      <div className={`hidden sm:block rounded-2xl border border-border bg-card overflow-hidden shadow-sm print:border-none print:rounded-none print:shadow-none print:overflow-visible print-table-wrapper ${printingUsageReport ? "print:hidden" : ""}`}>
        <table className="w-full border-collapse text-sm print:text-[11px] print:text-zinc-900 print:border-collapse print:border-2 print:border-black">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[6%] print:hidden" />
          </colgroup>

          <thead>
            <tr className="border-b border-border bg-muted/30 text-[11px] font-bold uppercase tracking-widest text-muted-foreground print:bg-zinc-100 print:text-zinc-900">
              <th className="text-left px-6 py-4 print:border print:border-black print:px-2 print:py-1">Item Name</th>
              <th className="text-left px-6 py-4 print:border print:border-black print:px-2 print:py-1">Lot Number</th>
              <th className="text-center px-6 py-4 print:border print:border-black print:px-2 print:py-1">Opened Date</th>
              <th className="text-center px-6 py-4 print:border print:border-black print:px-2 print:py-1">Working Exp</th>
              <th className="text-center px-6 py-4 print:border print:border-black print:px-2 print:py-1">Actual Exp</th>
              <th className="text-center px-6 py-4 print:border print:border-black print:px-2 print:py-1">Qty Left</th>
              <th className="text-center px-6 py-4 print:border print:border-black print:px-2 print:py-1">Status</th>
              <th className="text-right px-6 py-4 print:hidden">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {(activeLots || []).length > 0 ? (
              activeLots.map((lot, idx) => {
                const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
                const daysLeft = daysUntilExpiry(effectiveExpiry, labSettings.labTimezone)
                const isExpired = daysLeft < 0

                return (
                  <React.Fragment key={lot.id}>
                    <tr
                      className={`border-t border-border/50 hover:bg-muted/20 transition-colors print:text-zinc-900 ${isExpired ? "bg-destructive/5 print:bg-red-50" : ""}`}
                    >
                      <td className="text-left align-middle px-6 py-4 print:border print:border-black print:px-2 print:py-1">
                        <div className="flex items-center gap-3">
                          <PackageOpen className="size-5 text-muted-foreground print:hidden" />
                          <span className="font-bold text-foreground print:text-zinc-900">{lot.itemName}</span>
                        </div>
                      </td>
                      <td className="text-left align-middle px-6 py-4 font-mono text-muted-foreground print:border print:border-black print:px-2 print:py-1 print:text-zinc-700">
                        {lot.lotNumber}
                      </td>
                      <td className="text-center align-middle px-6 py-4 text-muted-foreground/80 print:border print:border-black print:px-2 print:py-1 print:text-zinc-700 tabular-nums">
                        {lot.openedDate || "—"}
                      </td>
                      <td className={`text-center align-middle px-6 py-4 font-semibold tabular-nums print:border print:border-black print:px-2 print:py-1 ${daysLeft <= 7 ? 'text-red-500 print:text-red-700' : 'text-foreground print:text-zinc-900'}`}>
                        {lot.workingExpiryDate || "—"}
                      </td>
                      <td className="text-center align-middle px-6 py-4 font-semibold text-muted-foreground tabular-nums print:border print:border-black print:px-2 print:py-1 print:text-zinc-700">
                        {lot.actualExpiryDate || "—"}
                      </td>
                      <td className="text-center align-middle px-6 py-4 font-bold text-foreground tabular-nums print:border print:border-black print:px-2 print:py-1 print:text-zinc-900">
                        {lot.quantityLeft}
                      </td>
                      <td className="text-center align-middle px-6 py-4 print:border print:border-black print:px-2 print:py-1">
                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold print:rounded-none print:px-0 print:py-0 print:bg-transparent ${isExpired ? LOT_IN_USE_STYLES["Expired"] : LOT_IN_USE_STYLES[lot.status as keyof typeof LOT_IN_USE_STYLES]}`}>
                          {isExpired ? "Expired" : lot.status}
                        </span>
                      </td>
                      <td className="text-right align-middle px-6 py-4 print:hidden">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => triggerManualUsage(lot)} className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all" title="Deduct usage">
                            <Minus className="size-5" />
                          </button>
                          <button onClick={() => { setDeleteReasonType("Expired"); setDeleteCustomReason(""); setShowDeleteModal(lot); }} className="flex items-center justify-center size-8 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all" title="Delete from bench">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {idx === activeLots.length - 1 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-4 text-center text-zinc-900 font-black uppercase tracking-widest">
                          End of Report
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })
            ) : (
              <tr>
                <td colSpan={8} className="p-20 text-center text-muted-foreground print:border print:border-black print:px-2 print:py-1 print:p-10 print:text-zinc-600">
                  No active lots on the bench.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

     {/* ── PRINT SIGNATURE FOOTER — fixed to bottom of every printed page ── */}
<div className={`hidden print-footer-fixed ${printingUsageReport ? "print:hidden" : "print:block"}`} style={{ paddingLeft: "1cm", paddingRight: "1cm" }}>
  <div className="border-t-2 border-zinc-900 pt-3 pb-2 flex justify-end items-end">
    <span className="text-xs font-bold text-zinc-700 uppercase tracking-widest mr-3">Reviewed by:</span>
    <span className="inline-block border-b border-zinc-900 w-64 h-4" />
  </div>
</div>
      {/* ── MODALS (Hidden on Print) ── */}
      <div className="print:hidden">
        
        {/* UNIFIED MANUAL SELECTION MODAL */}
        {showManualModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
                <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <List className="size-8 text-primary" />
                  </div>
                  Manual Selection
                </div>
                <button onClick={() => setShowManualModal(false)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
              </div>
              
              <div className="p-10 space-y-8">
                <div className="flex p-1.5 bg-muted rounded-2xl border border-border">
                  <button onClick={() => { setManualMode("use"); setSelectedManualLotId(""); }} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${manualMode === "use" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}>Log Usage </button>
                  <button onClick={() => { setManualMode("open"); setSelectedManualLotId(""); }} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${manualMode === "open" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}>Open New Lot </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">
                    {manualMode === "use" ? "Select Reagent from Bench" : "Select Reagent from Storage"}
                  </label>
                  {manualMode === "open" && (
                    <p className="text-xs text-muted-foreground ml-2">
                      Only lots with validation status Approved or Not Required can be opened to bench.
                    </p>
                  )}
                  <select 
                    value={selectedManualLotId} 
                    onChange={e => setSelectedManualLotId(e.target.value)} 
                    className="w-full h-16 border border-input bg-background rounded-2xl px-6 text-lg font-medium outline-none focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="">— Select an Item —</option>
                    {manualMode === "use" ? (
                      activeLots.map(lot => (
                        <option key={lot.id} value={lot.id}>
                          {lot.itemName} (Lot: {lot.lotNumber}) - {lot.quantityLeft} left
                        </option>
                      ))
                    ) : (
                      inventory.map(group => (
                        <optgroup key={group.itemId} label={group.name}>
                          {group.lots.filter((lot: LotEntry) => lot.totalUnits > 0 && canOpenInventoryLot(lot)).map(lot => (
                            <option key={lot.lotId} value={lot.lotId}>
                              Lot: {lot.lot} | Exp: {lot.expiry} | Stock: {lot.totalUnits} units
                            </option>
                          ))}
                        </optgroup>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-5 px-10 py-8 border-t border-border bg-muted/20">
                 <button onClick={() => setShowManualModal(false)} className="px-8 py-4 rounded-2xl border border-border bg-card font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                 <button onClick={handleManualSubmit} disabled={!selectedManualLotId} className="px-12 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                   {manualMode === "use" ? "Proceed to Deduct" : "Proceed to Bench"}
                 </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanner Modal */}
        {showScanModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
                <div className="flex items-center gap-4 font-bold text-xl text-foreground"><Scan className="size-8 text-primary" /> Scan Action</div>
                <button onClick={() => setShowScanModal(false)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
              </div>
              <div className="p-10 space-y-8 text-center">
                <div className="flex p-1.5 bg-muted rounded-2xl border border-border">
                  <button onClick={() => setScanMode("use")} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${scanMode === "use" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}>Log Usage</button>
                  <button onClick={() => setScanMode("open")} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${scanMode === "open" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}>Open New Lot</button>
                </div>
                <div className="flex p-1.5 bg-muted rounded-2xl border border-border">
                  <button
                    onClick={() => { setScanInputMode("usb"); setScanCameraError("") }}
                    className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${scanInputMode === "usb" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}
                  >
                    USB Scanner
                  </button>
                  <button
                    onClick={() => { setScanInputMode("camera"); setScanCameraError("") }}
                    className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${scanInputMode === "camera" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}
                  >
                    Camera
                  </button>
                </div>
                {scanInputMode === "camera" && (
                  <div className="space-y-3">
                    <BarcodeCameraScanner
                      active={showScanModal && scanInputMode === "camera"}
                      onResult={(code) => { void handleScan(code) }}
                      onError={(msg) => setScanCameraError(msg)}
                    />
                    {scanCameraError && (
                      <p className="text-left text-sm text-muted-foreground">{scanCameraError}</p>
                    )}
                  </div>
                )}
                <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScan(barcodeInput)} placeholder="Enter Lot Number..." className="w-full h-16 border border-input bg-background rounded-2xl px-6 text-lg text-center focus:ring-4 focus:ring-primary/10 outline-none transition-all" />
                <button onClick={() => handleScan(barcodeInput)} className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:opacity-90 shadow-lg shadow-primary/20">Lookup Lot</button>
              </div>
            </div>
          </div>
        )}

        {/* Usage Modal */}
        {showUsageModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
                <div className="flex items-center gap-4 font-bold text-2xl text-foreground"><Minus className="size-8 text-primary" /> Log Usage</div>
                <button onClick={() => setShowUsageModal(null)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
              </div>
              <div className="p-10 space-y-8">
                <div className="bg-primary/5 border-2 border-primary/20 p-8 rounded-[2rem] text-center">
                  <p className="font-black text-3xl text-foreground">{showUsageModal.itemName}</p>
                  <p className="text-sm font-mono text-muted-foreground mt-2">Lot: {showUsageModal.lotNumber} | Qty: {showUsageModal.quantityLeft}</p>
                </div>
                <div className="space-y-4">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Amount to Deduct</label>
                  <div className="flex gap-4">
                    <input type="number" min={1} max={maxUsage} value={deductAmount} onChange={(e) => setDeductAmount(Number(e.target.value))} className="flex-1 h-16 border border-input bg-background rounded-2xl px-6 text-2xl font-black outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all" />
                    <div className="w-32 h-16 border border-input bg-muted/50 rounded-2xl flex items-center justify-center text-lg font-bold text-muted-foreground uppercase">{usageLabel}</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-5 px-10 py-8 border-t border-border bg-muted/20">
                 <button onClick={() => setShowUsageModal(null)} className="px-8 py-4 rounded-2xl border border-border bg-card font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                 <button onClick={handleConfirmDeduction} className="px-12 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all">Confirm Deduction</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete from Bench Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-destructive/5">
                <div className="flex items-center gap-4 font-bold text-2xl text-destructive"><Trash2 className="size-8" /> Delete from Bench</div>
                <button onClick={() => setShowDeleteModal(null)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
              </div>
              <div className="p-10 space-y-8">
                <div className="bg-destructive/5 border-2 border-destructive/20 p-8 rounded-[2rem] text-center">
                  <p className="font-black text-3xl text-foreground">{showDeleteModal.itemName}</p>
                  <p className="text-sm font-mono text-muted-foreground mt-2">Lot: {showDeleteModal.lotNumber}</p>
                </div>
                <div className="space-y-4">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Reason for Deletion <span className="text-destructive">*</span></label>
                  <div className="grid grid-cols-2 gap-3">
                    {DELETE_REASONS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { setDeleteReasonType(r); if (r !== "Other") setDeleteCustomReason(""); }}
                        className={`px-4 py-3 rounded-2xl border-2 text-sm font-bold transition-all ${
                          deleteReasonType === r
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground hover:border-muted-foreground/40"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {deleteReasonType === "Other" && (
                    <input
                      value={deleteCustomReason}
                      onChange={e => setDeleteCustomReason(e.target.value)}
                      placeholder="Describe the reason..."
                      className="w-full h-16 border border-input bg-background rounded-2xl px-6 text-lg outline-none focus:ring-4 focus:ring-destructive/10 focus:border-destructive transition-all animate-in slide-in-from-top-2"
                      autoFocus
                    />
                  )}
                </div>
                <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-2xl border border-border">
                  <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">This will permanently remove the lot from the bench and log the reason to the audit trail.</p>
                </div>
              </div>
              <div className="flex justify-end gap-5 px-10 py-8 border-t border-border bg-muted/20">
                <button onClick={() => setShowDeleteModal(null)} className="px-8 py-4 rounded-2xl border border-border bg-card font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleteReasonType === "Other" && !deleteCustomReason.trim()}
                  className="px-12 py-4 rounded-2xl bg-destructive text-destructive-foreground font-black text-lg shadow-xl shadow-destructive/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                >
                  Confirm Deletion
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Open New Lot Modal (1.5x Giant Pro) */}
        {showOpenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-7xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
               <div className="flex justify-between items-center px-10 py-10 border-b border-border bg-muted/20">
                <div className="flex items-center gap-4 font-bold text-3xl text-foreground">
                  <div className="p-3 bg-primary/10 rounded-2xl"><PackageOpen className="size-10 text-primary" /></div>
                  Open New Lot to Bench
                </div>
                <button onClick={() => setShowOpenModal(null)} className="p-3 rounded-full hover:bg-muted text-muted-foreground"><X className="size-8" /></button>
              </div>

              <div className="p-12 grid grid-cols-3 gap-12">
                {/* Column 1 */}
                <div className="space-y-6">
                   <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><div className="w-2 h-6 bg-primary rounded-full" /> 1. Source Details</h3>
                   <div className="p-8 bg-muted/50 rounded-[2rem] border border-border space-y-4">
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Item Name</label>
                        <p className="text-xl font-black text-foreground leading-tight">{showOpenModal.itemName}</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Lot Number</label>
                        <p className="text-lg font-mono font-bold text-primary">{showOpenModal.lot}</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Storage Expiry</label>
                        <p className="text-lg font-bold text-destructive">{showOpenModal.expiry}</p>
                      </div>
                   </div>
                </div>

                {/* Column 2 */}
                <div className="space-y-6">
                   <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><div className="w-2 h-6 bg-primary rounded-full" /> 2. Bench Allocation</h3>
                   <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Units to bench</label>
                        <input type="number" min={1} max={showOpenModal.totalUnits} value={openAmount} onChange={(e) => setOpenAmount(Number(e.target.value))} className="w-full h-16 border-2 border-primary/20 bg-background rounded-2xl px-6 text-2xl font-black outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all" />
                      </div>
                      <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl">
                        <p className="text-sm text-muted-foreground">In storage for this lot:</p>
                        <p className="text-xl font-black text-primary mt-1 tabular-nums">{showOpenModal.totalUnits} units</p>
                        <p className="text-sm text-muted-foreground mt-2">Moving to bench:</p>
                        <p className="text-lg font-bold text-foreground tabular-nums">{openAmount} units</p>
                      </div>
                   </div>
                </div>

                {/* Column 3 */}
                <div className="space-y-6">
                   <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><div className="w-2 h-6 bg-primary rounded-full" /> 3. Expiry Control</h3>
                   <div className="space-y-6">
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Date Opened</label>
                         <input type="date" value={openedDate} onChange={(e) => setOpenedDate(e.target.value)} className="w-full h-16 border border-input bg-background rounded-2xl px-6 text-lg font-bold outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all" />
                      </div>
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-primary uppercase tracking-widest ml-2">Set Working Expiry</label>
                         <input
                           type="date"
                           value={workingExpiry}
                           max={showOpenModal.expiry}
                           onChange={(e) => {
                             const val = e.target.value
                             if (showOpenModal.expiry && val > showOpenModal.expiry) {
                               setWorkingExpiry(showOpenModal.expiry)
                             } else {
                               setWorkingExpiry(val)
                             }
                           }}
                           className="w-full h-16 border-2 border-primary bg-primary/5 rounded-2xl px-6 text-lg font-black text-primary outline-none focus:ring-8 focus:ring-primary/10 transition-all"
                         />
                      </div>
                      {workingExpiry && showOpenModal.expiry && workingExpiry >= showOpenModal.expiry && (
                        <p className="text-xs text-destructive font-semibold ml-2">Capped to manufacturer expiry ({showOpenModal.expiry}).</p>
                      )}
                      <p className="text-xs text-muted-foreground italic">Working expiry cannot exceed the manufacturer&apos;s actual expiry date.</p>
                   </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-5 px-12 py-10 border-t border-border bg-muted/20">
                 <button onClick={() => setShowOpenModal(null)} className="px-10 py-5 rounded-2xl border border-border bg-card font-bold text-lg text-muted-foreground hover:bg-muted transition-all">Cancel</button>
                 <button onClick={() => { void handleConfirmOpen() }} className="px-20 py-5 rounded-2xl bg-primary text-primary-foreground font-black text-xl shadow-2xl shadow-primary/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3">
                   <CheckCircle2 className="size-6" /> Start Tracking on Bench
                 </button>
              </div>
            </div>
          </div>
        )}

        {/* FEFO soft warning modal */}
        {showFefoWarningModal && fefoWarningData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-amber-500/10">
                <div className="flex items-center gap-4 font-bold text-2xl text-amber-700">
                  <AlertTriangle className="size-8" />
                  Earlier Expiry Lot Available
                </div>
                <button
                  onClick={() => { setShowFefoWarningModal(false); setFefoWarningData(null) }}
                  className="p-2 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X className="size-6" />
                </button>
              </div>

              <div className="p-10 space-y-6">
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
                  <p className="text-base text-foreground leading-relaxed">
                    Lot <span className="font-mono font-bold">{fefoWarningData.suggestedLotNumber}</span> of{" "}
                    <span className="font-bold">{fefoWarningData.itemName}</span> expires on{" "}
                    <span className="font-bold">{fefoWarningData.suggestedExpiryDate}</span> and should be opened first.
                  </p>
                  <p className="text-base text-foreground leading-relaxed">
                    You are about to open Lot <span className="font-mono font-bold">{fefoWarningData.currentLotNumber}</span> which expires on{" "}
                    <span className="font-bold">{fefoWarningData.currentExpiryDate}</span>.
                  </p>
                  <p className="text-base font-semibold text-foreground">Are you sure you want to open this lot instead?</p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 px-10 py-8 border-t border-border bg-muted/20">
                <button
                  onClick={() => { setShowFefoWarningModal(false); setFefoWarningData(null) }}
                  className="px-6 py-3 rounded-xl bg-transparent text-muted-foreground font-bold text-sm hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowFefoWarningModal(false); void handleConfirmOpen(true) }}
                  className="px-6 py-3 rounded-xl border border-border bg-card text-foreground font-bold text-sm hover:bg-muted transition-all"
                >
                  Continue Anyway
                </button>
                <button
                  onClick={handleOpenSuggestedFefoLot}
                  className="px-6 py-3 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-all"
                >
                  Open Suggested Lot Instead
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          USAGE REPORT PRINT LAYOUT (only when printing)
         ══════════════════════════════════════════════ */}
      {printingUsageReport && (
        <div className="hidden print:block print:font-sans">
          <div className="space-y-5 mb-6 border-b-2 border-zinc-900 pb-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-zinc-900">Reagent Usage Report</h1>
                <p className="text-zinc-500 font-medium mt-1">{reportLabName} | Clinical Laboratory Management</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-emerald-600">USAGE</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6 pt-2">
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generated By</p>
                <p className="text-lg font-bold text-zinc-900">{(currentUserName || "Unknown User").toUpperCase()}</p>
              </div>
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generated Date</p>
                <p className="text-lg font-bold text-zinc-900">{getLabCurrentDateStr(labSettings.labTimezone)}</p>
              </div>
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Date Range</p>
                <p className="text-lg font-bold text-zinc-900">{usageFrom} – {usageTo}</p>
              </div>
            </div>
          </div>

          <div className="print:w-full print:bg-white print:text-black print-table-wrapper">
            <table className="w-full border-collapse text-[11px] text-black font-sans">
              <colgroup>
                <col style={{ width: "20%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "2px solid black" }}>
                  <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Date/Time</th>
                  <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Item Name</th>
                  <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Lot Number</th>
                  <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Qty Used</th>
                  <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Used By</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.length > 0 ? (
                  usageRows.map((r, idx) => (
                    <React.Fragment key={`${r.created_at}-${idx}`}>
                      <tr className="align-top print:border-b print:border-black">
                        <td className="text-left px-3 print:py-4 font-semibold text-black tabular-nums">{formatUsageDateTime(r.created_at)}</td>
                        <td className="text-left px-3 print:py-4 font-semibold text-black">{r.item_name}</td>
                        <td className="text-left px-3 print:py-4 text-zinc-700 font-mono">{r.lot_number}</td>
                        <td className="text-center px-3 print:py-4 text-zinc-700 tabular-nums">{parseQuantityUsed(r.details)}</td>
                        <td className="text-left px-3 print:py-4 text-black">{r.user_name}</td>
                      </tr>
                      {idx === usageRows.length - 1 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-zinc-900 font-black uppercase tracking-widest">
                            End of Report
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-zinc-600">
                      No usage recorded for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="print-footer-fixed" style={{ paddingLeft: "1cm", paddingRight: "1cm" }}>
            <div className="border-t-2 border-zinc-900 pt-3 pb-2 flex justify-between items-end">
              <div className="text-xs font-bold text-zinc-700 uppercase tracking-widest">
                Generated by: {(currentUserName || "Unknown User")} · {getLabCurrentDateStr(labSettings.labTimezone)}
              </div>
              <div className="flex items-end">
                <span className="text-xs font-bold text-zinc-700 uppercase tracking-widest mr-3">Reviewed by:</span>
                <span className="inline-block border-b border-zinc-900 w-64 h-4" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          USAGE REPORT MODAL (screen only)
         ══════════════════════════════════════════════ */}
      {showUsageReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4 print:hidden">
          <div className="w-full max-w-6xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
              <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                <History className="size-7 text-primary" />
                Usage Report
              </div>
              <button
                onClick={() => setShowUsageReportModal(false)}
                className="p-2 rounded-full hover:bg-muted text-muted-foreground"
                aria-label="Close"
              >
                <X className="size-6" />
              </button>
            </div>

            <div className="p-10 space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">
                    Date range
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUsagePreset("today")
                        const { from, to } = resolvePresetDates("today")
                        setUsageFrom(from); setUsageTo(to)
                        void loadUsageReport({ preset: "today", from, to })
                      }}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
                        usagePreset === "today" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUsagePreset("last7")
                        const { from, to } = resolvePresetDates("last7")
                        setUsageFrom(from); setUsageTo(to)
                        void loadUsageReport({ preset: "last7", from, to })
                      }}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
                        usagePreset === "last7" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Last 7 days
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUsagePreset("last30")
                        const { from, to } = resolvePresetDates("last30")
                        setUsageFrom(from); setUsageTo(to)
                        void loadUsageReport({ preset: "last30", from, to })
                      }}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
                        usagePreset === "last30" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Last 30 days
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsagePreset("custom")}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
                        usagePreset === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Custom range
                    </button>
                  </div>
                </div>

                <div className="text-xs font-semibold text-muted-foreground">
                  {usageRows.length} usage entr{usageRows.length === 1 ? "y" : "ies"} found
                </div>
              </div>

              {usagePreset === "custom" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">From</label>
                    <input
                      type="date"
                      value={usageFrom}
                      onChange={(e) => setUsageFrom(e.target.value)}
                      className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-semibold outline-none focus:ring-4 focus:ring-primary/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">To</label>
                    <input
                      type="date"
                      value={usageTo}
                      onChange={(e) => setUsageTo(e.target.value)}
                      className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-semibold outline-none focus:ring-4 focus:ring-primary/10"
                    />
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void loadUsageReport({ preset: "custom", from: usageFrom, to: usageTo })}
                      className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md hover:opacity-90 transition-all"
                      disabled={!usageFrom || !usageTo || usageLoading}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      <th className="text-left px-6 py-4">Date &amp; Time</th>
                      <th className="text-left px-6 py-4">Item Name</th>
                      <th className="text-left px-6 py-4">Lot Number</th>
                      <th className="text-center px-6 py-4">Quantity Used</th>
                      <th className="text-left px-6 py-4">Used By</th>
                      <th className="text-left px-6 py-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageLoading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                          Loading usage…
                        </td>
                      </tr>
                    ) : usageError ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-destructive font-semibold">
                          {usageError}
                        </td>
                      </tr>
                    ) : usageRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground font-semibold">
                          No usage recorded for this period.
                        </td>
                      </tr>
                    ) : (
                      usageRows.map((r, idx) => (
                        <tr key={`${r.created_at}-${idx}`} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-6 py-4 font-semibold text-foreground tabular-nums">{formatUsageDateTime(r.created_at)}</td>
                          <td className="px-6 py-4 font-bold text-foreground">{r.item_name}</td>
                          <td className="px-6 py-4 font-mono text-muted-foreground">{r.lot_number}</td>
                          <td className="px-6 py-4 text-center font-bold text-foreground tabular-nums">{parseQuantityUsed(r.details)}</td>
                          <td className="px-6 py-4 font-semibold text-foreground">{r.user_name}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{r.details}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-3 px-10 py-8 border-t border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setShowUsageReportModal(false)}
                className="px-8 py-3 rounded-2xl border border-border bg-card font-bold text-muted-foreground hover:bg-muted transition-all"
              >
                Close
              </button>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={exportUsageCsv}
                  disabled={usageRows.length === 0 || usageLoading}
                  className="px-6 py-3 rounded-2xl border border-border bg-card font-bold text-foreground hover:bg-muted transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={handlePrintUsageReport}
                  disabled={usageLoading}
                  className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold shadow-md hover:opacity-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  Print / Export PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}