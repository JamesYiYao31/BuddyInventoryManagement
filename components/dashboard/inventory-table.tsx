"use client"

import { useState, useRef, useEffect } from "react"
import { Scan, Plus, Pencil, Camera, X, CheckCircle2, Settings2, Trash2 } from "lucide-react"
import { 
  LotEntry, STATUS_STYLES, totalCountLabel, daysUntilExpiry, emptyLotForm 
} from "@/lib/inventory-utils"

const KNOWN_ITEMS: Record<string, { name: string; vendor: string }> = {
  "100124": { name: "IAST Culture Bottle", vendor: "Thermo Fisher" },
  "26542": { name: "BioBall", vendor: "Merck" },
}

export default function InventoryTab({ inventory, setInventory, sortedFlatInventory, labSettings }: any) {
  
  // ── 1. CRITERIA STATE (Synced to Lab Settings) ──
  const [thresholds, setThresholds] = useState({ 
    urgentDays: labSettings?.expiryUrgentDays || 7, 
    warningDays: labSettings?.expiryWarnDays || 30 
  })
  const [showSettings, setShowSettings] = useState(false)

  // ── 2. MODAL STATE ──
  const [showItemModal, setShowItemModal] = useState(false)
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  const [editingLot, setEditingLot] = useState<any>(null)
  
  const [isNewGroup, setIsNewGroup] = useState(true)
  const [newItemName, setNewItemName] = useState("")
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [lotForm, setLotForm] = useState(emptyLotForm())

  const [barcodeInput, setBarcodeInput] = useState("")
  const [barcodeResult, setBarcodeResult] = useState<any>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showBarcodeModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showBarcodeModal])

  // ── 3. DYNAMIC STATUS LOGIC ──
  const getDynamicStatus = (lot: LotEntry) => {
    const days = daysUntilExpiry(lot.expiry)
    if (days <= 0) return "Expired"
    if (days <= thresholds.urgentDays) return "Expiring Soon"
    if (days <= thresholds.warningDays) return "Watchlist"
    return "In Storage"
  }

  // ── 4. ACTIONS ──
  const triggerScan = (code: string) => {
    const parseBarcode = (rawCode: string) => {
      let parsed = { lot: "", expiry: "", itemCode: "", type: "1D" }
      if (rawCode.length < 10 && !rawCode.includes("(")) { parsed.lot = rawCode; return parsed }
      parsed.type = "2D/GS1"
      if (rawCode.includes("(10)")) parsed.lot = rawCode.split("(10)")[1]?.split("(")[0] || ""
      if (rawCode.includes("(01)")) parsed.itemCode = rawCode.split("(01)")[1]?.substring(0, 6) || ""
      if (rawCode.includes("(17)")) parsed.expiry = "2027-12-31" 
      return parsed
    }
    const res = parseBarcode(code)
    const known = KNOWN_ITEMS[res.itemCode]
    const existing = inventory.find((g: any) => g.name === known?.name)
    setBarcodeResult({ ...res, name: known?.name, vendor: known?.vendor, isExistingItem: !!existing })
    if (existing) { setSelectedGroupId(existing.itemId); setIsNewGroup(false) }
    else { setNewItemName(known?.name || ""); setIsNewGroup(true) }
  }

  const applyBarcodeToForm = () => {
    setLotForm((p: any) => ({ ...p, lot: barcodeResult?.lot || "", expiry: barcodeResult?.expiry || "", vendor: barcodeResult?.vendor || "" }))
    setShowBarcodeModal(false); setShowItemModal(true); setBarcodeResult(null)
  }

  const openManualEntry = () => {
    setShowBarcodeModal(false); setEditingLot(null); setIsNewGroup(true); setLotForm(emptyLotForm()); setShowItemModal(true)
  }

  const saveItem = () => {
    const newLot = { ...lotForm, lotId: Date.now().toString() } as LotEntry
    if (!isNewGroup && selectedGroupId) {
      setInventory((prev: any) => prev.map((g: any) => g.itemId === selectedGroupId ? { ...g, lots: editingLot ? g.lots.map((l: any) => l.lotId === editingLot.lotId ? newLot : l) : [...g.lots, newLot] } : g))
    } else {
      setInventory((prev: any) => [...prev, { itemId: Date.now().toString(), name: newItemName, lots: [newLot] }])
    }
    setShowItemModal(false)
  }

  return (
    <div className="relative flex flex-col gap-6">
      
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Inventory List</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-bold transition-all ${showSettings ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card border-border text-foreground hover:bg-muted"}`}>
            <Settings2 className="size-5" /> Criteria
          </button>
          <button onClick={() => setShowBarcodeModal(true)} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>
          <button onClick={openManualEntry} className="flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-all">
            <Plus className="size-5" /> Add Manually
          </button>
        </div>
      </div>

      {/* ── CRITERIA PANEL ── */}
      {showSettings && (
        <div className="rounded-2xl border border-border bg-muted/30 p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in slide-in-from-top-2 w-fit">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Urgent (Red)</label>
            <div className="flex items-center gap-3">
              <input type="number" value={thresholds.urgentDays} onChange={(e) => setThresholds({...thresholds, urgentDays: Number(e.target.value)})} className="w-20 h-10 border border-input bg-background rounded-xl px-3 text-sm font-bold focus:ring-2 focus:ring-primary outline-none" />
              <span className="text-xs text-muted-foreground">days or less</span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Warning (Yellow)</label>
            <div className="flex items-center gap-3">
              <input type="number" value={thresholds.warningDays} onChange={(e) => setThresholds({...thresholds, warningDays: Number(e.target.value)})} className="w-20 h-10 border border-input bg-background rounded-xl px-3 text-sm font-bold focus:ring-2 focus:ring-primary outline-none" />
              <span className="text-xs text-muted-foreground">days or less</span>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN TABLE ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[2fr_1.5fr_1.2fr_1.2fr_1.5fr_1.2fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>Item Name</span><span>Lot Number</span><span>Received</span><span>Expiry</span><span>Quantity</span><span>Status</span><span></span>
        </div>
        {sortedFlatInventory.length > 0 ? (
          sortedFlatInventory.map((lot: any, idx: number, arr: any[]) => {
            const isFirst = idx === 0 || arr[idx - 1].itemName !== lot.itemName
            const status = getDynamicStatus(lot)
            
            const statusColor = status === "Expiring Soon" ? "bg-red-500/10 text-red-600 dark:text-red-400" : 
                               status === "Watchlist" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" : 
                               status === "Expired" ? "bg-zinc-500/10 text-zinc-600" : "bg-green-500/10 text-green-600 dark:text-green-400"

            return (
              <div key={lot.lotId} className={`grid grid-cols-[2fr_1.5fr_1.2fr_1.2fr_1.5fr_1.2fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors ${isFirst && idx !== 0 ? "border-t-border border-t-2" : ""}`}>
                <span className="font-bold text-foreground">{isFirst ? lot.itemName : ""}</span>
                <span className="font-mono text-muted-foreground">{lot.lot}</span>
                <span className="text-muted-foreground/80">{lot.receivedDate}</span>
                <span className="font-medium text-foreground/90">{lot.expiry}</span>
                <span className="font-semibold text-foreground">{totalCountLabel(lot)}</span>
                <span className={`inline-flex w-fit px-3 py-1 rounded-full text-[10px] font-bold ${statusColor}`}>{status}</span>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEditingLot(lot); setLotForm(lot); setSelectedGroupId(lot.itemId); setIsNewGroup(false); setShowItemModal(true); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-all"><Pencil className="size-4" /></button>
                  <button onClick={() => { if(confirm('Delete lot?')) setInventory((prev: any) => prev.map((g: any) => g.itemId === lot.itemId ? { ...g, lots: g.lots.filter((l: any) => l.lotId !== lot.lotId) } : g).filter((g: any) => g.lots.length > 0)) }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-all"><Trash2 className="size-4" /></button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="p-20 text-center text-muted-foreground">No items match the selected filters.</div>
        )}
      </div>

      {/* ── POP-OUT: SCAN BARCODE (1.5x BIGGER) ── */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
              <div className="flex items-center gap-4 font-bold text-xl text-foreground"><Scan className="size-8 text-primary" /> Scan Barcode</div>
              <button onClick={() => setShowBarcodeModal(false)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
            </div>
            <div className="p-10 space-y-8 text-center">
              {!barcodeResult ? (
                <>
                  <div className="h-40 border-4 border-dashed border-border rounded-[2rem] flex flex-col items-center justify-center bg-muted/30 text-muted-foreground gap-3">
                    <Camera className="size-12 opacity-30" />
                    <p className="text-sm font-bold uppercase tracking-[0.2em] opacity-50">Awaiting Input</p>
                  </div>
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-widest block text-left ml-2">Manual Entry / Lot Number</label>
                    <div className="flex gap-3">
                      <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && triggerScan(barcodeInput)} placeholder="00124985..." className="flex-1 h-16 border border-input bg-background rounded-2xl px-6 text-lg focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all" />
                      <button onClick={() => triggerScan(barcodeInput)} className="px-8 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:opacity-90 transition-all shadow-sm">Look up</button>
                    </div>
                  </div>
                  <button onClick={openManualEntry} className="text-sm font-semibold text-muted-foreground hover:text-primary underline underline-offset-8">Barcode unreadable? Click to enter manually</button>
                </>
              ) : (
                <div className="bg-primary/5 border-2 border-primary/20 p-8 rounded-[2rem] space-y-6 text-left">
                  <div className="flex items-center gap-3 font-bold text-primary text-lg"><CheckCircle2 className="size-6" /> Barcode Captured</div>
                  <div className="grid grid-cols-2 gap-6 text-sm">
                    <div><p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Item Recognized</p><p className="font-bold text-xl">{barcodeResult.name || "Unknown Item"}</p></div>
                    <div><p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Lot #</p><p className="font-mono font-bold text-xl">{barcodeResult.lot}</p></div>
                  </div>
                  <button onClick={applyBarcodeToForm} className="w-full h-14 bg-primary text-primary-foreground rounded-xl font-bold text-lg shadow-lg hover:opacity-90">Review & Edit Info</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── POP-OUT: ADD MANUALLY (1.5x BIGGER & WIDE) ── */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-7xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center px-12 py-8 border-b border-border bg-muted/20">
              <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                <div className="p-3 rounded-2xl bg-primary/10"><Plus className="size-8 text-primary" /></div>
                <span>{editingLot ? "Edit Lot Entry" : "Add New Item / Lot"}</span>
              </div>
              <button onClick={() => setShowItemModal(false)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-7" /></button>
            </div>

            <div className="p-12 grid grid-cols-3 gap-12">
              {/* Column 1: Identity */}
              <div className="space-y-8 border-r border-border pr-12">
                <div className="space-y-4">
                  <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">1. Reagent Identity</p>
                  <div className="flex p-1.5 bg-muted rounded-2xl border border-border">
                    <button onClick={() => setIsNewGroup(true)} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${isNewGroup ? "bg-card shadow-lg text-foreground border border-border" : "text-muted-foreground"}`}>New Item</button>
                    <button onClick={() => setIsNewGroup(false)} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${!isNewGroup ? "bg-card shadow-lg text-foreground border border-border" : "text-muted-foreground"}`}>Existing</button>
                  </div>
                  {isNewGroup ? (
                    <input value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Reagent Name *" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium outline-none focus:ring-4 focus:ring-primary/10" />
                  ) : (
                    <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium">
                      <option value="">— Select from Database —</option>
                      {inventory.map((g: any) => <option key={g.itemId} value={g.itemId}>{g.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Lot Number *</label>
                  <input value={lotForm.lot} onChange={e => setLotForm({...lotForm, lot: e.target.value})} placeholder="e.g. 1358-ABC" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-mono" />
                </div>
              </div>

              {/* Column 2: Logistics */}
              <div className="space-y-8 border-r border-border pr-12">
                <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">2. Dates & Vendor</p>
                <div className="space-y-5">
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiry Date</label><input type="date" value={lotForm.expiry} onChange={e => setLotForm({...lotForm, expiry: e.target.value})} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Vendor</label><input value={lotForm.vendor} onChange={e => setLotForm({...lotForm, vendor: e.target.value})} placeholder="e.g. Sigma Aldrich" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Storage Location</label><input value={lotForm.storage} onChange={e => setLotForm({...lotForm, storage: e.target.value})} placeholder="e.g. Fridge C" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                </div>
              </div>

              {/* Column 3: Quantity & Status */}
              <div className="space-y-8">
                <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">3. Quantity & Status</p>
                <div className="p-6 bg-muted/40 rounded-3xl border border-border space-y-6">
                  <div className="flex gap-2">
                    {["units_and_count", "units_only", "count_only"].map((v) => (
                      <button key={v} onClick={() => setLotForm({...lotForm, quantityType: v as any})} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${lotForm.quantityType === v ? "bg-primary text-primary-foreground shadow-lg" : "bg-card text-muted-foreground"}`}>{v.replace(/_/g, ' ')}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {(lotForm.quantityType === "units_and_count" || lotForm.quantityType === "units_only") && (
                      <>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Outer Qty</label>
                          <input type="number" value={lotForm.units} onChange={e => setLotForm({...lotForm, units: Number(e.target.value)})} placeholder="0" className="w-full h-12 border border-input bg-background rounded-xl px-4 text-base font-bold" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Unit Type</label>
                          <input value={lotForm.unitLabel} onChange={e => setLotForm({...lotForm, unitLabel: e.target.value})} placeholder="box" className="w-full h-12 border border-input bg-background rounded-xl px-4 text-base" />
                        </div>
                      </>
                    )}
                    {(lotForm.quantityType === "units_and_count" || lotForm.quantityType === "count_only") && (
                      <>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Inner Count</label>
                          <input type="number" value={lotForm.count} onChange={e => setLotForm({...lotForm, count: Number(e.target.value)})} placeholder="0" className="w-full h-12 border border-input bg-background rounded-xl px-4 text-base font-bold" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Count Type</label>
                          <input value={lotForm.countLabel} onChange={e => setLotForm({...lotForm, countLabel: e.target.value})} placeholder="vials" className="w-full h-12 border border-input bg-background rounded-xl px-4 text-base" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Initial Status</label>
                  <select value={lotForm.status} onChange={e => setLotForm({...lotForm, status: e.target.value as any})} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-bold text-primary">
                    <option>In Storage</option><option>Low Stock</option><option>Expiring Soon</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-5 px-12 py-10 border-t border-border bg-muted/20">
              <button onClick={() => setShowItemModal(false)} className="px-10 py-4 rounded-2xl border border-border bg-card font-bold text-base text-muted-foreground hover:bg-muted transition-all">Cancel</button>
              <button onClick={saveItem} className="px-16 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all">Save to Inventory</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}