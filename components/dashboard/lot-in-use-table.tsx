"use client"

import { useState, useRef, useEffect } from "react"
import { Printer, PackageOpen, AlertCircle, Scan, Minus, Camera, X, CheckCircle2 } from "lucide-react"
import { LotInUseEntry, LOT_IN_USE_STYLES, daysUntilExpiry, getEarliestExpiry, InventoryGroup } from "@/lib/inventory-utils"

interface LotInUseTabProps {
  activeLots: LotInUseEntry[]
  inventory: InventoryGroup[] // We need access to inventory to open new lots!
}

export default function LotInUseTab({ activeLots, inventory }: LotInUseTabProps) {
  // ── MODAL STATES ──
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanMode, setScanMode] = useState<"use" | "open">("use") 
  
  // Usage Modal State
  const [showUsageModal, setShowUsageModal] = useState<LotInUseEntry | null>(null)
  const [deductAmount, setDeductAmount] = useState<number>(1)
  const [usageLabel, setUsageLabel] = useState<string>("units")
  const [maxUsage, setMaxUsage] = useState<number>(999)
  
  // Open Modal State
  const [showOpenModal, setShowOpenModal] = useState<any>(null)
  const [openAmount, setOpenAmount] = useState<number>(1)

  // ── SCANNER STATE ──
  const [barcodeInput, setBarcodeInput] = useState("")
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showScanModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showScanModal, scanMode])

  const handlePrint = () => window.print()

  // ── SMART SCAN LOGIC ──
  const handleScan = (code: string) => {
    if (scanMode === "use") {
      // Look for the lot currently on the bench
      const found = activeLots.find(l => l.lotNumber === code)
      if (found) {
        setShowScanModal(false)
        
        // SMART DETECT: Extract the number and the label from "15 vials" or "8 %"
        const qtyParts = found.quantityLeft.split(" ")
        const currentQty = parseInt(qtyParts[0]) || 0
        const currentLabel = qtyParts.slice(1).join(" ") || "units"
        
        setMaxUsage(currentQty)
        setUsageLabel(currentLabel)
        setDeductAmount(1) 
        setShowUsageModal(found)
      } else {
        alert("Lot not found on the bench. Did you mean to 'Open New Lot'?")
      }
    } else {
      // Look for the lot in the main inventory freezer
      let foundInvLot = null
      let foundInvName = ""
      for (const group of inventory) {
        const match = group.lots.find(l => l.lot === code)
        if (match) { foundInvLot = match; foundInvName = group.name; break }
      }
      
      if (foundInvLot) {
        setShowScanModal(false)
        setOpenAmount(1)
        setShowOpenModal({ ...foundInvLot, itemName: foundInvName })
      } else {
        alert("Lot not found in Inventory Database.")
      }
    }
  }

  // ── MANUAL USAGE CLICK ──
  const triggerManualUsage = (lot: LotInUseEntry) => {
    const qtyParts = lot.quantityLeft.split(" ")
    setMaxUsage(parseInt(qtyParts[0]) || 0)
    setUsageLabel(qtyParts.slice(1).join(" ") || "units")
    setDeductAmount(1)
    setShowUsageModal(lot)
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      
      {/* ── HEADER ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-foreground">Lot in Use</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Currently opened and active reagents on the bench.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setScanMode("use"); setShowScanModal(true); setBarcodeInput(""); }} className="flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-md hover:opacity-90">
            <Scan className="size-4" /> Scan Reagent
          </button>
          <button onClick={handlePrint} className="flex items-center gap-2 rounded-lg border border-border bg-card text-foreground px-4 py-2 text-sm font-semibold hover:bg-muted">
            <Printer className="size-4 text-muted-foreground" /> Print Report
          </button>
        </div>
      </div>

      {/* ── PRINT HEADER ── */}
      <div className="hidden print:block mb-6">
        <h1 className="text-3xl font-bold text-black">Reagent Used Report</h1>
        <p className="text-gray-500">Generated on: {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
        <p className="text-gray-500 mt-1">Showing {(activeLots || []).length} active items.</p>
      </div>

      {/* ── MAIN TABLE ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm print:border-none print:shadow-none">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground print:bg-gray-100 print:text-black">
          <span>Item Name</span><span>Lot Number</span><span>Opened</span><span>Working Expiry</span><span>Actual Expiry</span><span>Qty Left</span><span>Status</span><span className="print:hidden"></span>
        </div>

        {(activeLots || []).length > 0 ? (
          activeLots.map((lot) => {
            const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
            const daysLeft = daysUntilExpiry(effectiveExpiry)
            const isExpired = daysLeft <= 0
            const isUrgent = daysLeft > 0 && daysLeft <= 7
            
            const isWorkingBottleneck = effectiveExpiry === lot.workingExpiryDate
            const isActualBottleneck = effectiveExpiry === lot.actualExpiryDate

            return (
              <div key={lot.id} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-xs hover:bg-muted/20 transition-colors print:border-gray-200 print:text-black ${isExpired ? "bg-destructive/5" : ""}`}>
                <div className="flex items-center gap-3">
                  <PackageOpen className="size-4 text-muted-foreground print:hidden" />
                  <span className="font-bold text-foreground print:text-black">{lot.itemName}</span>
                </div>
                <span className="font-mono text-muted-foreground print:text-black">{lot.lotNumber}</span>
                <span className="text-muted-foreground/80 print:text-black">{lot.openedDate}</span>
                
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${isExpired && isWorkingBottleneck ? 'text-zinc-500 line-through' : isUrgent && isWorkingBottleneck ? 'text-red-500' : 'text-foreground print:text-black'}`}>
                    {lot.workingExpiryDate}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${isExpired && isActualBottleneck ? 'text-zinc-500 line-through' : isUrgent && isActualBottleneck ? 'text-red-500' : 'text-muted-foreground print:text-black'}`}>
                    {lot.actualExpiryDate}
                  </span>
                  {(isUrgent || isExpired) && <AlertCircle className={`size-3.5 print:hidden ${isExpired ? 'text-zinc-500' : 'text-red-500'}`} />}
                </div>

                <span className="font-bold text-foreground print:text-black">{lot.quantityLeft}</span>
                
                <div>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-bold print:border print:border-gray-300 print:text-black print:bg-transparent ${isExpired ? LOT_IN_USE_STYLES["Expired"] : LOT_IN_USE_STYLES[lot.status]}`}>
                    {isExpired ? "Expired" : lot.status}
                  </span>
                </div>

                <div className="flex justify-end print:hidden">
                   <button onClick={() => triggerManualUsage(lot)} className="flex items-center justify-center size-7 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all" title="Log Usage">
                     <Minus className="size-3.5" />
                   </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="p-20 text-center text-muted-foreground text-sm">No active lots match the selected filters.</div>
        )}
      </div>

      {/* ── MODAL: MULTI-PURPOSE SCANNER ── */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 font-bold text-sm text-foreground"><Scan className="size-4 text-primary" /> Scan Action</div>
              <button onClick={() => setShowScanModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
            </div>
            
            <div className="p-6 space-y-6 text-center">
              {/* TOGGLE: Use vs Open */}
              <div className="flex p-1 bg-muted rounded-lg border border-border">
                <button onClick={() => setScanMode("use")} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${scanMode === "use" ? "bg-card shadow-sm text-foreground ring-1 ring-border" : "text-muted-foreground"}`}>Log Usage</button>
                <button onClick={() => setScanMode("open")} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${scanMode === "open" ? "bg-card shadow-sm text-foreground ring-1 ring-border" : "text-muted-foreground"}`}>Open New Lot</button>
              </div>

              <div className="h-28 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center bg-muted/30 gap-2">
                <Camera className="size-8 text-muted-foreground/40" />
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                  {scanMode === "use" ? "Scan bench reagent..." : "Scan freezer inventory..."}
                </p>
              </div>
              <div className="flex gap-2">
                <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScan(barcodeInput)} placeholder="Scan or type lot..." className="flex-1 h-10 border border-input bg-background rounded-xl px-3 text-sm focus:ring-1 focus:ring-primary outline-none" />
                <button onClick={() => handleScan(barcodeInput)} className="px-4 bg-primary text-primary-foreground rounded-xl font-bold text-xs hover:opacity-90">Lookup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: SMART DEDUCTION / LOG USAGE ── */}
      {showUsageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden animate-in zoom-in-95">
             <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-muted/20">
              <h2 className="font-bold text-sm text-foreground">Log Reagent Usage</h2>
              <button onClick={() => setShowUsageModal(null)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl">
                <p className="text-[10px] font-bold uppercase text-primary tracking-widest mb-1">Item Detected</p>
                <p className="font-bold text-base text-foreground">{showUsageModal.itemName}</p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">Lot: {showUsageModal.lotNumber}</p>
                <div className="mt-3 pt-3 border-t border-primary/10 flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Current Bench Qty:</span>
                  <span className="text-sm font-bold text-foreground">{showUsageModal.quantityLeft}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Amount to Deduct</label>
                <div className="flex gap-2">
                  {/* Min is 1, Max is whatever they have left on the bench! */}
                  <input type="number" min={1} max={maxUsage} value={deductAmount} onChange={(e) => setDeductAmount(Number(e.target.value))} className="flex-1 h-12 border border-input bg-background rounded-xl px-4 text-base font-bold outline-none focus:ring-1 focus:ring-primary" />
                  
                  {/* Automatically locked to the correct unit type */}
                  <div className="w-24 h-12 border border-input bg-muted rounded-xl flex items-center justify-center text-sm font-semibold text-muted-foreground">
                    {usageLabel}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Defaulted to 1 {usageLabel}. Edit if you used more.</p>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-border bg-muted/20">
               <button onClick={() => setShowUsageModal(null)} className="flex-1 h-10 rounded-xl border border-border bg-card font-bold text-xs text-muted-foreground hover:bg-muted">Cancel</button>
               <button onClick={() => { setShowUsageModal(null); alert(`Deducted ${deductAmount} ${usageLabel} successfully!`) }} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90">Confirm Deduction</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: OPEN NEW LOT (Moves from Inventory -> Bench) ── */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden animate-in zoom-in-95">
             <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 font-bold text-sm text-foreground">
                <PackageOpen className="size-4 text-primary" /> Open New Lot
              </div>
              <button onClick={() => setShowOpenModal(null)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="bg-muted/40 border border-border p-4 rounded-xl text-sm">
                <p className="text-muted-foreground mb-1">Opening from freezer/storage:</p>
                <p className="font-bold text-foreground text-lg">{showOpenModal.itemName}</p>
                <p className="font-mono text-muted-foreground">Lot: {showOpenModal.lot}</p>
                <p className="text-xs font-semibold text-destructive mt-1">Actual Expiry: {showOpenModal.expiry}</p>
              </div>
              
              {/* SMART YIELD CALCULATOR */}
              <div className="space-y-2 border border-primary/20 bg-primary/5 p-4 rounded-xl">
                 <label className="text-[10px] font-bold text-primary uppercase tracking-widest">Bench Allocation</label>
                 <div className="flex items-center gap-2">
                   <span className="text-xs text-muted-foreground">Transferring</span>
                   <input type="number" min={1} value={openAmount} onChange={(e) => setOpenAmount(Number(e.target.value))} className="w-16 h-8 text-center border border-input rounded-md text-xs font-bold" />
                   <span className="text-xs font-bold text-foreground">{showOpenModal.quantityType === "count_only" ? showOpenModal.countLabel : showOpenModal.unitLabel}</span>
                 </div>
                 <p className="text-[10px] text-muted-foreground mt-2">
                   This will add <span className="font-bold text-foreground">{showOpenModal.quantityType === "units_and_count" ? openAmount * showOpenModal.count : openAmount} {showOpenModal.quantityType === "units_only" ? showOpenModal.unitLabel : showOpenModal.countLabel}</span> to your active bench tracking.
                 </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Date Opened</label>
                  <input type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full h-10 border border-input bg-background rounded-xl px-3 text-xs outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-primary">Working Expiry</label>
                  <input type="date" className="w-full h-10 border border-primary/50 bg-primary/5 rounded-xl px-3 text-xs outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Setting a working expiry overrides the actual expiry if it comes sooner.</p>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-border bg-muted/20">
               <button onClick={() => setShowOpenModal(null)} className="px-6 h-10 rounded-xl border border-border bg-card font-bold text-xs text-muted-foreground hover:bg-muted">Cancel</button>
               <button onClick={() => { setShowOpenModal(null); alert("Lot moved to bench!") }} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90">Start Using on Bench</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}