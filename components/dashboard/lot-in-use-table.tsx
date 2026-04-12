"use client"

import { useState, useRef, useEffect } from "react"
import { Printer, PackageOpen, AlertCircle, Scan, Minus, Camera, X, CheckCircle2, ShieldAlert } from "lucide-react"
import { 
  LotInUseEntry, 
  LOT_IN_USE_STYLES, 
  daysUntilExpiry, 
  getEarliestExpiry, 
  InventoryGroup,
  logUsageInSupabase,
  openNewLotInSupabase
} from "@/lib/inventory-utils"

interface LotInUseTabProps {
  activeLots: LotInUseEntry[]
  inventory: InventoryGroup[]
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
}

export default function LotInUseTab({ activeLots, inventory, refreshData, userRole }: LotInUseTabProps) {
  // ── MODAL STATES ──
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanMode, setScanMode] = useState<"use" | "open">("use") 
  
  const [showUsageModal, setShowUsageModal] = useState<LotInUseEntry | null>(null)
  const [deductAmount, setDeductAmount] = useState<number>(1)
  const [usageLabel, setUsageLabel] = useState<string>("units")
  const [maxUsage, setMaxUsage] = useState<number>(999)
  
  const [showOpenModal, setShowOpenModal] = useState<any>(null)
  const [openAmount, setOpenAmount] = useState<number>(1)
  const [workingExpiry, setWorkingExpiry] = useState("")

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

  // ── LOGIC: OPEN NEW LOT (Freezer -> Bench) ──
  const handleConfirmOpen = async () => {
    if (!showOpenModal) return;
    
    const yieldPer = showOpenModal.quantityType === "units_and_count" ? showOpenModal.count : 1;
    const label = showOpenModal.quantityType === "units_and_count" ? showOpenModal.countLabel : showOpenModal.unitLabel;

    try {
      await openNewLotInSupabase(
        showOpenModal.lotId,
        showOpenModal.itemId || "",
        showOpenModal.lot,
        showOpenModal.expiry,
        workingExpiry || showOpenModal.expiry,
        openAmount,
        yieldPer,
        label
      );
      setShowOpenModal(null);
      setWorkingExpiry("");
      await refreshData();
    } catch (error: any) {
      alert(error.message);
    }
  };

  // ── SCAN LOGIC ──
  const handleScan = (code: string) => {
    if (scanMode === "use") {
      const found = (activeLots || []).find(l => l.lotNumber === code)
      if (found) {
        setShowScanModal(false);
        triggerManualUsage(found);
      } else {
        alert("Lot not found on the bench.");
      }
    } else {
      let foundInvLot = null;
      let foundInvName = "";
      for (const group of inventory) {
        const match = group.lots.find(l => l.lot === code);
        if (match) { foundInvLot = match; foundInvName = group.name; break; }
      }
      
      if (foundInvLot) {
        setShowScanModal(false);
        setOpenAmount(1);
        setShowOpenModal({ ...foundInvLot, itemName: foundInvName });
      } else {
        alert("Lot not found in Inventory Database.");
      }
    }
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
          <button onClick={handlePrint} className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all">
            <Printer className="size-5 text-muted-foreground" /> Print Report
          </button>
        </div>
      </div>

      {/* ── 2. PROFESSIONAL PRINT HEADER (Visible ONLY on Print) ── */}
      <div className="hidden print:block space-y-6 mb-10 border-b-2 border-zinc-900 pb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter text-zinc-900">Reagent Usage Report</h1>
            <p className="text-zinc-500 font-medium mt-1">BuddyLab Tracker | Clinical Laboratory Management</p>
          </div>
          <div className="text-right">
             <div className="text-sm font-bold uppercase text-zinc-400 tracking-widest">Document Status</div>
             <div className="text-lg font-black text-emerald-600">ACTIVE BENCH INVENTORY</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-8 pt-4">
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Technician</p>
            <p className="text-lg font-bold text-zinc-900">Current User ({userRole})</p>
          </div>
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generated Date</p>
            <p className="text-lg font-bold text-zinc-900">{new Date().toLocaleDateString()}</p>
          </div>
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Current Time</p>
            <p className="text-lg font-bold text-zinc-900">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>
      </div>

      {/* ── 3. MAIN TABLE ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm print:border-zinc-200 print:shadow-none">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground print:bg-zinc-100 print:text-zinc-900 print:border-zinc-900">
          <span>Item Name</span><span>Lot Number</span><span>Opened</span><span>Working Exp</span><span>Actual Exp</span><span>Qty Left</span><span>Status</span><span className="print:hidden"></span>
        </div>

        {(activeLots || []).length > 0 ? (
          activeLots.map((lot) => {
            const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
            const daysLeft = daysUntilExpiry(effectiveExpiry)
            const isExpired = daysLeft <= 0
            
            return (
              <div key={lot.id} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors print:border-zinc-200 print:text-zinc-900 ${isExpired ? "bg-destructive/5 print:bg-red-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <PackageOpen className="size-5 text-muted-foreground print:text-zinc-400" />
                  <span className="font-bold text-foreground print:text-zinc-900">{lot.itemName}</span>
                </div>
                <span className="font-mono text-muted-foreground print:text-zinc-600">{lot.lotNumber}</span>
                <span className="text-muted-foreground/80 print:text-zinc-600">{lot.openedDate}</span>
                <span className={`font-semibold ${daysLeft <= 7 ? 'text-red-500' : 'text-foreground print:text-zinc-900'}`}>{lot.workingExpiryDate}</span>
                <span className="font-semibold text-muted-foreground print:text-zinc-600">{lot.actualExpiryDate}</span>
                <span className="font-bold text-foreground print:text-zinc-900">{lot.quantityLeft}</span>
                <div>
                  <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold print:border print:bg-transparent ${isExpired ? LOT_IN_USE_STYLES["Expired"] : LOT_IN_USE_STYLES[lot.status as keyof typeof LOT_IN_USE_STYLES]}`}>
                    {isExpired ? "Expired" : lot.status}
                  </span>
                </div>
                <div className="flex justify-end print:hidden">
                   <button onClick={() => triggerManualUsage(lot)} className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                     <Minus className="size-5" />
                   </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="p-20 text-center text-muted-foreground">No active lots on the bench.</div>
        )}
      </div>

      {/* ── 4. PRINT FOOTER ── */}
      <div className="hidden print:block mt-20 pt-10 border-t border-zinc-200">
         <div className="flex justify-between items-end">
            <div className="space-y-1">
               <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">End of Report</p>
               <p className="text-xs text-zinc-500 italic">This document is a live record of clinical reagents currently active in the laboratory workspace.</p>
            </div>
            <div className="text-right">
               <div className="h-px w-48 bg-zinc-300 mb-2" />
               <p className="text-sm font-bold text-zinc-900">Reviewing Signature</p>
            </div>
         </div>
      </div>

      {/* ── MODALS (Hidden on Print) ── */}
      <div className="print:hidden">
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
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Containers to Transfer</label>
                        <div className="flex gap-4">
                          <input type="number" min={1} value={openAmount} onChange={(e) => setOpenAmount(Number(e.target.value))} className="flex-1 h-16 border-2 border-primary/20 bg-background rounded-2xl px-6 text-2xl font-black outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all" />
                          <div className="w-32 h-16 border border-input bg-muted/50 rounded-2xl flex items-center justify-center text-sm font-bold text-muted-foreground uppercase">{showOpenModal.unitLabel}</div>
                        </div>
                      </div>
                      <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl">
                        <p className="text-sm text-muted-foreground">Smart Yield Calculation:</p>
                        <p className="text-xl font-black text-primary mt-1 uppercase">
                          {showOpenModal.quantityType === "units_and_count" ? openAmount * showOpenModal.count : openAmount} {showOpenModal.quantityType === "units_and_count" ? showOpenModal.countLabel : showOpenModal.unitLabel}
                        </p>
                      </div>
                   </div>
                </div>

                {/* Column 3 */}
                <div className="space-y-6">
                   <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><div className="w-2 h-6 bg-primary rounded-full" /> 3. Expiry Control</h3>
                   <div className="space-y-6">
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Date Opened</label>
                         <input type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full h-16 border border-input bg-background rounded-2xl px-6 text-lg font-bold outline-none transition-all" />
                      </div>
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-primary uppercase tracking-widest ml-2">Set Working Expiry</label>
                         <input type="date" value={workingExpiry} onChange={(e) => setWorkingExpiry(e.target.value)} className="w-full h-16 border-2 border-primary bg-primary/5 rounded-2xl px-6 text-lg font-black text-primary outline-none focus:ring-8 focus:ring-primary/10 transition-all" />
                      </div>
                      <p className="text-xs text-muted-foreground italic">Setting a working expiry overrides the original bottle stability if it comes sooner.</p>
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