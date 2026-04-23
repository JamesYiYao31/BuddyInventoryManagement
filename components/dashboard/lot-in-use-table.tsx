"use client"

import React, { useState, useRef, useEffect } from "react"
import { Printer, PackageOpen, AlertCircle, Scan, Minus, Camera, X, CheckCircle2, ShieldAlert, List, Trash2 } from "lucide-react"
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
  deleteActiveLotInSupabase
} from "@/lib/inventory-utils"

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

  const [showDeleteModal, setShowDeleteModal] = useState<LotInUseEntry | null>(null)
  const [deleteReasonType, setDeleteReasonType] = useState<string>("Expired")
  const [deleteCustomReason, setDeleteCustomReason] = useState("")

  // ── SCANNER STATE ──
  const [barcodeInput, setBarcodeInput] = useState("")
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showScanModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showScanModal, scanMode])

  const handlePrint = () => window.print()

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

  const handleConfirmOpen = async () => {
    if (!showOpenModal) return;

    if (openAmount < 1) return alert("Enter at least 1 unit to move to the bench.");
    if (openAmount > showOpenModal.totalUnits) return alert("Cannot move more units than are in storage for this lot.");

    const finalWorkingExpiry = clampWorkingExpiry(
      workingExpiry || showOpenModal.expiry,
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
        openedDate || getLabCurrentDateStr(labSettings.labTimezone)
      );
      setShowOpenModal(null);
      setOpenedDate("");
      setWorkingExpiry("");
      await refreshData();
    } catch (error: any) {
      alert(error.message);
    }
  };

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
        const match = group.lots.find(l => l.lotId === selectedManualLotId);
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
    const parsedLot = (parsed.lot || "").trim()
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
      let foundInvLot: any = null
      let foundInvName = ""
      for (const group of inventory) {
        const match = group.lots.find(l => l.lot === parsedLot)
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
    }

    return failToManual()
  };

  const triggerManualUsage = (lot: LotInUseEntry) => {
    const qtyParts = lot.quantityLeft.split(" ");
    setMaxUsage(parseInt(qtyParts[0]) || 0);
    setUsageLabel(qtyParts.slice(1).join(" ") || "units");
    setDeductAmount(1);
    setShowUsageModal(lot);
  };

  return (
    <div className="relative flex flex-col gap-6">
      
      {/* ── 1. SCREEN HEADER (Hidden on Print) ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lot in Use</h1>
          <p className="text-sm text-muted-foreground mt-1">Active reagents currently on the bench.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => { setScanMode("use"); setShowScanModal(true); setBarcodeInput(""); }} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>
          <button onClick={() => { setManualMode("use"); setShowManualModal(true); setSelectedManualLotId(""); }} className="flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-all">
            <List className="size-5" /> Manual Select
          </button>
          <button onClick={handlePrint} className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all">
            <Printer className="size-5 text-muted-foreground" /> Print Report
          </button>
        </div>
      </div>

      {/* ── 2. PROFESSIONAL PRINT HEADER (Visible ONLY on Print) ── */}
      <div className="hidden print:block space-y-5 mb-6 border-b-2 border-zinc-900 pb-6">
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
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm print:border-none print:rounded-none print:shadow-none print:overflow-visible print-table-wrapper">
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
<div className="hidden print:block print-footer-fixed" style={{ paddingLeft: "1cm", paddingRight: "1cm" }}>
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
                          {group.lots.filter((lot: LotEntry) => lot.totalUnits > 0).map(lot => (
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
                <div className="h-40 border-4 border-dashed border-border rounded-[2rem] flex flex-col items-center justify-center bg-muted/30 gap-3">
                  <Camera className="size-12 text-muted-foreground/30" />
                  <p className="text-sm font-bold tracking-widest text-muted-foreground/70 uppercase">Ready to Scan</p>
                </div>
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
                 <button onClick={handleConfirmOpen} className="px-20 py-5 rounded-2xl bg-primary text-primary-foreground font-black text-xl shadow-2xl shadow-primary/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3">
                   <CheckCircle2 className="size-6" /> Start Tracking on Bench
                 </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}