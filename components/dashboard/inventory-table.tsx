"use client"

import { supabase } from "@/lib/supabase"
import { useState, useRef, useEffect } from "react"
import { Scan, Plus, Pencil, Camera, X, CheckCircle2, Settings2, Trash2, ShieldAlert } from "lucide-react"
import { 
  LotEntry, STATUS_STYLES, daysUntilExpiry, emptyLotForm,
  logActivity, InventoryGroup, LabSettings 
} from "@/lib/inventory-utils"

const KNOWN_ITEMS: Record<string, { name: string; vendor: string }> = {
  "100124": { name: "IAST Culture Bottle", vendor: "Thermo Fisher" },
  "26542": { name: "BioBall", vendor: "Merck" },
}

interface InventoryTabProps {
  inventory: InventoryGroup[]
  sortedFlatInventory: any[]
  labSettings: LabSettings
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
}

export default function InventoryTab({ inventory, sortedFlatInventory, labSettings, refreshData, userRole }: InventoryTabProps) {
  
  // ── 1. CRITERIA STATE ──
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

  const visibleInventoryLots = sortedFlatInventory.filter((lot: LotEntry) => (lot.totalUnits ?? 0) > 0)

  // ── 3. DYNAMIC STATUS LOGIC ──
  const getDynamicStatus = (lot: LotEntry) => {
    const days = daysUntilExpiry(lot.expiry)
    if (days <= 0) return "Expired"
    if (days <= thresholds.urgentDays) return "Expiring Soon"
    if (days <= thresholds.warningDays) return "Watchlist"
    return "In Storage"
  }

  // ── 4. ACTIONS ──
  const handleAutoReorder = async (lot: any) => {
    const confirmOrder = confirm(`Auto-generate reorder request for ${lot.itemName}?`);
    if (!confirmOrder) return;

    const { error } = await supabase
      .from('requests')
      .insert([{
        item_id: lot.itemId,
        item_name: lot.itemName,
        vendor: lot.vendor,
        catalog_number: lot.lot, 
        order_qty: 1, 
        status: "Pending",
        notes: "Auto-generated due to low stock/watchlist levels."
      }]);

    if (error) alert("Error creating request: " + error.message);
    else {
      await logActivity("Ordered", lot.itemName, lot.lot, "Auto-generated reorder request")
      alert("Reorder request sent to manager!");
      await refreshData()
    }
  };

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

  const deleteLot = async (lot: any) => {
    if (userRole !== 'manager') return alert("Unauthorized: Only managers can delete inventory.")
    if(!confirm('Are you sure you want to delete this lot?')) return
    
    const { error } = await supabase.from('inventory_lots').delete().eq('id', lot.lotId)
    if (error) alert(error.message)
    else {
      await logActivity("Disposed", lot.itemName, lot.lot, "Manually deleted from inventory")
      await refreshData()
    }
  }

  const saveItem = async () => {
    if (!lotForm.lot) return alert("Lot number is required")
    if (!lotForm.totalUnits || lotForm.totalUnits < 1) return alert("Total units received must be at least 1.")
    let finalItemId = selectedGroupId
    let finalItemName = newItemName

    if (isNewGroup) {
      const { data: newItem, error: itemError } = await supabase.from('items').insert([{ name: newItemName, vendor: lotForm.vendor }]).select().single()
      if (itemError) return alert("Error creating item: " + itemError.message)
      finalItemId = newItem.id
    } else {
      const existing = inventory.find((g: any) => g.itemId === selectedGroupId)
      finalItemName = existing?.name || "Unknown"
    }

    const { error: lotError } = await supabase.from('inventory_lots').insert([{
        item_id: finalItemId, 
        lot_number: lotForm.lot, 
        expiry_date: lotForm.expiry, 
        received_date: lotForm.receivedDate,
        storage_location: lotForm.storage, 
        quantity_type: "count_only",
        units: 0,
        unit_label: "units",
        count: lotForm.totalUnits,
        count_label: "units",
        notes: lotForm.notes, 
        status: lotForm.status
      }])

    if (lotError) return alert("Error saving lot: " + lotError.message)

    await logActivity("Added", finalItemName, lotForm.lot, `Received ${lotForm.totalUnits} units into ${lotForm.storage}`)
    await refreshData()
    setShowItemModal(false)
  }

  return (
    <div className="relative flex flex-col gap-6">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Inventory List</h1>
        <div className="flex gap-3">
          {/* Settings is hidden from Techs */}
          {userRole === 'manager' && (
            <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-bold transition-all ${showSettings ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card border-border text-foreground hover:bg-muted"}`}>
              <Settings2 className="size-5" /> Criteria
            </button>
          )}
          
          <button onClick={() => setShowBarcodeModal(true)} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>
          
          {/* FIXED: Removed the Manager requirement here so Techs can add items */}
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
        <div className="grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>Item / Lot</span><span>Received</span><span>Expiry</span><span>Total units</span><span>Status</span><span></span>
        </div>
        {visibleInventoryLots.length > 0 ? (
          visibleInventoryLots.map((lot: LotEntry, idx: number, arr: LotEntry[]) => {
            const isFirst = idx === 0 || arr[idx - 1].itemName !== lot.itemName
            const status = getDynamicStatus(lot)
            
            const statusColor = status === "Expiring Soon" ? "bg-red-500/10 text-red-600 dark:text-red-400" : 
                               status === "Watchlist" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" : 
                               status === "Expired" ? "bg-zinc-500/10 text-zinc-600" : "bg-green-500/10 text-green-600 dark:text-green-400"

            return (
              <div key={lot.lotId} className={`grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors ${isFirst && idx !== 0 ? "border-t-border border-t-2" : ""}`}>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-bold text-foreground truncate">{lot.itemName}</span>
                  <span className="font-mono text-sm font-semibold text-primary">Lot {lot.lot}</span>
                </div>
                <span className="text-muted-foreground/80">{lot.receivedDate}</span>
                <span className="font-medium text-foreground/90">{lot.expiry}</span>
                <span className="font-semibold text-foreground tabular-nums">{lot.totalUnits}</span>
                
                <div className="flex flex-col gap-1 items-start">
                   <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${statusColor}`}>{status}</span>
                   {(status === "Watchlist" || status === "Expiring Soon") && (
                     <button onClick={(e) => { e.stopPropagation(); handleAutoReorder(lot); }} className="text-[9px] font-black text-primary uppercase hover:underline ml-1">+ Reorder</button>
                   )}
                </div>

                <div className="flex justify-end gap-2">
                  {userRole === 'manager' ? (
                    <>
                      <button onClick={() => { setEditingLot(lot); setLotForm(lot); setSelectedGroupId(lot.itemId); setIsNewGroup(false); setShowItemModal(true); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-all"><Pencil className="size-4" /></button>
                      <button onClick={() => deleteLot(lot)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-all"><Trash2 className="size-4" /></button>
                    </>
                  ) : (
                    <span title="Manager Only">
                    <ShieldAlert className="size-4 text-muted-foreground/30" />
                  </span>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <div className="p-20 text-center text-muted-foreground">No items match the selected filters.</div>
        )}
      </div>

      {/* ── MODALS (Giant 1.5x Style) ── */}
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
                      <button onClick={() => triggerScan(barcodeInput)} className="px-8 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:opacity-90 transition-all shadow-sm shadow-primary/20">Look up</button>
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
              <div className="space-y-8 border-r border-border pr-12">
                <div className="space-y-4">
                  <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">1. Identity</p>
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

              <div className="space-y-8 border-r border-border pr-12">
                <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">2. Logistics</p>
                <div className="space-y-5">
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiry Date</label><input type="date" value={lotForm.expiry} onChange={e => setLotForm({...lotForm, expiry: e.target.value})} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Vendor</label><input value={lotForm.vendor} onChange={e => setLotForm({...lotForm, vendor: e.target.value})} placeholder="e.g. Sigma Aldrich" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Storage Location</label><input value={lotForm.storage} onChange={e => setLotForm({...lotForm, storage: e.target.value})} placeholder="e.g. Fridge C" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                </div>
              </div>

              <div className="space-y-8">
                <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">3. Quantity & Status</p>
                <div className="p-6 bg-muted/40 rounded-3xl border border-border space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Total units received</label>
                    <input type="number" min={1} value={lotForm.totalUnits} onChange={e => setLotForm({...lotForm, totalUnits: Number(e.target.value)})} className="w-full h-12 border border-input bg-background rounded-xl px-4 text-base font-bold" />
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
