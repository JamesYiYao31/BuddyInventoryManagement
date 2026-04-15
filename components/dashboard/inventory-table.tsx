"use client"

import { supabase } from "@/lib/supabase"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Scan, Plus, Pencil, Camera, X, Trash2, ShieldAlert,
  CheckCircle2, Loader2, AlertTriangle, Search, Send
} from "lucide-react"
import {
  LotEntry, daysUntilExpiry, emptyLotForm, getLabCurrentDateStr,
  logActivity, InventoryGroup, LabSettings, Item,
  parseSmartBarcode, fetchAllItems, lookupItemByVendorSku, createItem
} from "@/lib/inventory-utils"
import { useToast } from "@/hooks/use-toast"

interface InventoryTabProps {
  inventory: InventoryGroup[]
  sortedFlatInventory: any[]
  labSettings: LabSettings
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
}

export default function InventoryTab({
  inventory, sortedFlatInventory, labSettings, refreshData, userRole
}: InventoryTabProps) {

  const { toast } = useToast()

  // ── 1. ITEMS CATALOG (from Supabase `items` table) ──
  const [allItems, setAllItems] = useState<Item[]>([])
  const loadItems = useCallback(async () => {
    const items = await fetchAllItems()
    setAllItems(items)
  }, [])
  useEffect(() => { loadItems() }, [loadItems])

  // ── 2. MODAL STATE ──
  const [showItemModal, setShowItemModal] = useState(false)
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  const [editingLot, setEditingLot] = useState<any>(null)
  const [selectedItemId, setSelectedItemId] = useState("")
  const [newItemName, setNewItemName] = useState("")
  const [lotForm, setLotForm] = useState(emptyLotForm(labSettings.labTimezone))
  const [scanBadge, setScanBadge] = useState<{ format: string; sku: string } | null>(null)
  const [pendingVendorSku, setPendingVendorSku] = useState("")
  const [saving, setSaving] = useState(false)

  // ── 3. BARCODE MODAL STATE ──
  const [barcodeInput, setBarcodeInput] = useState("")
  const [barcodeScanning, setBarcodeScanning] = useState(false)
  const [barcodeMatched, setBarcodeMatched] = useState<{ item: Item; lot: string; expiry: string; format: string; sku: string } | null>(null)
  const [barcodeError, setBarcodeError] = useState("")
  const [barcodeParsedSku, setBarcodeParsedSku] = useState("")
  const [barcodeParsedLot, setBarcodeParsedLot] = useState("")
  const [barcodeParsedExpiry, setBarcodeParsedExpiry] = useState("")
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showBarcodeModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showBarcodeModal])

  // ── 4. ITEM SEARCH/COMBOBOX STATE ──
  const [itemSearchQuery, setItemSearchQuery] = useState("")
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false)
  const itemSearchRef = useRef<HTMLInputElement>(null)
  const itemDropdownRef = useRef<HTMLDivElement>(null)

  const filteredItems = allItems.filter(item => {
    if (!itemSearchQuery) return true
    const q = itemSearchQuery.toLowerCase()
    return item.name.toLowerCase().includes(q) || (item.vendor || "").toLowerCase().includes(q)
  })

  const selectedItemObj = allItems.find(i => i.id === selectedItemId) || null
  const queryMatchesExisting = itemSearchQuery.trim() !== "" && filteredItems.some(
    i => i.name.toLowerCase() === itemSearchQuery.trim().toLowerCase()
  )
  const showCreateOption = itemSearchQuery.trim().length > 0 && !queryMatchesExisting && !selectedItemId

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(e.target as Node)) {
        setItemDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const visibleInventoryLots = sortedFlatInventory.filter(
    (lot: LotEntry) => (lot.totalUnits ?? 0) > 0
  )

  // ── 5. DYNAMIC STATUS FROM lab_settings THRESHOLDS ──
  type StatusBadge = { label: string; color: string }

  const getStatusBadges = (lot: LotEntry): StatusBadge[] => {
    const badges: StatusBadge[] = []
    const days = daysUntilExpiry(lot.expiry, labSettings.labTimezone)

    if (days < 0 && lot.expiry) {
      badges.push({ label: "Expired", color: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" })
      return badges
    }

    if (lot.expiry && days >= 0 && days <= labSettings.expiringSoonDays) {
      badges.push({ label: "Expiring Soon", color: "bg-red-500/10 text-red-600 dark:text-red-400" })
    }

    if ((lot.totalUnits ?? 0) <= labSettings.lowStockThreshold) {
      badges.push({ label: "Low Stock", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" })
    }

    if (badges.length === 0) {
      badges.push({ label: "In Storage", color: "bg-green-500/10 text-green-600 dark:text-green-400" })
    }

    return badges
  }

  // ── 6. REORDER MODAL STATE & ACTIONS ──
  const [showReorderModal, setShowReorderModal] = useState(false)
  const [reorderLot, setReorderLot] = useState<any>(null)
  const [reorderQty, setReorderQty] = useState(1)
  const [reorderSaving, setReorderSaving] = useState(false)

  const openReorderModal = (lot: any) => {
    setReorderLot(lot)
    setReorderQty(1)
    setShowReorderModal(true)
  }

  const submitReorder = async () => {
    if (!reorderLot || reorderQty < 1) return
    setReorderSaving(true)

    const catalogItem = allItems.find(i => i.id === reorderLot.itemId)
    const vendor = catalogItem?.vendor || reorderLot.vendor || ""
    const dateRequested = getLabCurrentDateStr(labSettings.labTimezone)

    const { error } = await supabase
      .from("requests")
      .insert([{
        item_id: reorderLot.itemId,
        item_name: reorderLot.itemName,
        vendor,
        catalog_number: catalogItem?.vendor_sku || "",
        order_qty: reorderQty,
        status: "Pending",
        date_requested: dateRequested,
        notes: `Reorder request for ${reorderQty} units.`
      }])

    setReorderSaving(false)
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message })
    } else {
      await logActivity("Ordered", reorderLot.itemName, "", `Reorder request for ${reorderQty} units`)
      toast({ title: "Request Sent", description: `Reorder for ${reorderLot.itemName} sent to manager.` })
      await refreshData()
    }
    setShowReorderModal(false)
    setReorderLot(null)
  }

  const deleteLot = async (lot: any) => {
    if (userRole !== "manager") return alert("Unauthorized: Only managers can delete inventory.")
    if (!confirm("Are you sure you want to delete this lot?")) return

    const { error } = await supabase.from("inventory_lots").delete().eq("id", lot.lotId)
    if (error) {
      alert(error.message)
    } else {
      await logActivity("Disposed", lot.itemName, lot.lot, "Manually deleted from inventory")
      await refreshData()
    }
  }

  // ── 7. BARCODE SCAN → PARSE → LOOKUP ──
  const resetBarcodeState = () => {
    setBarcodeInput("")
    setBarcodeScanning(false)
    setBarcodeMatched(null)
    setBarcodeError("")
    setBarcodeParsedSku("")
    setBarcodeParsedLot("")
    setBarcodeParsedExpiry("")
  }

  const triggerScan = async (code: string) => {
    if (!code.trim()) return
    setBarcodeScanning(true)
    setBarcodeError("")
    setBarcodeMatched(null)

    const parsed = parseSmartBarcode(code)
    setBarcodeParsedSku(parsed.sku)
    setBarcodeParsedLot(parsed.lot)
    setBarcodeParsedExpiry(parsed.expiry)

    const matchedItem = await lookupItemByVendorSku(parsed.sku)
    setBarcodeScanning(false)

    if (matchedItem) {
      setBarcodeMatched({
        item: matchedItem,
        lot: parsed.lot,
        expiry: parsed.expiry,
        format: parsed.format,
        sku: parsed.sku
      })
    } else if (parsed.sku) {
      setBarcodeError(
        `No item with vendor_sku "${parsed.sku}" found. You can create a new item in the next step.`
      )
    } else {
      setBarcodeError("Could not extract a SKU from this barcode. Try manual entry.")
    }
  }

  const applyBarcodeToForm = () => {
    if (barcodeMatched) {
      setSelectedItemId(barcodeMatched.item.id)
      setNewItemName("")
      setItemSearchQuery("")
      setPendingVendorSku("")
      setLotForm({
        ...emptyLotForm(labSettings.labTimezone),
        lot: barcodeMatched.lot,
        expiry: barcodeMatched.expiry,
        vendor: barcodeMatched.item.vendor || "",
      })
      setScanBadge({ format: barcodeMatched.format, sku: barcodeMatched.sku })
      setShowBarcodeModal(false)
      setShowItemModal(true)
      resetBarcodeState()
      toast({
        title: "Barcode matched",
        description: `${barcodeMatched.item.name} — review the details and confirm.`,
      })
    }
  }

  const openManualFromBarcode = () => {
    setShowBarcodeModal(false)
    setEditingLot(null)
    setSelectedItemId("")
    setNewItemName("")
    setItemSearchQuery("")
    setPendingVendorSku(barcodeParsedSku)
    setLotForm({
      ...emptyLotForm(labSettings.labTimezone),
      lot: barcodeParsedLot,
      expiry: barcodeParsedExpiry,
    })
    setScanBadge(null)
    setShowItemModal(true)
    resetBarcodeState()
    toast({
      variant: "destructive",
      title: "Barcode not recognized",
      description: "No matching item found. Type a name to create a new item, or select an existing one.",
    })
  }

  const openManualEntry = () => {
    setEditingLot(null)
    setSelectedItemId("")
    setNewItemName("")
    setItemSearchQuery("")
    setLotForm(emptyLotForm(labSettings.labTimezone))
    setScanBadge(null)
    setPendingVendorSku("")
    setShowItemModal(true)
  }

  // ── 8. SAVE (create-if-needed → insert lot) ──
  const saveItem = async () => {
    const hasItem = !!selectedItemId || !!newItemName.trim()
    if (!hasItem) return alert("You must select or create an item.")
    if (!lotForm.lot.trim()) return alert("Lot number is required.")
    if (!lotForm.totalUnits || lotForm.totalUnits < 1) return alert("Total units received must be at least 1.")

    setSaving(true)
    let finalItemId = selectedItemId
    let finalItemName = selectedItemObj?.name || ""

    // If user typed a new item name, create it first
    if (!selectedItemId && newItemName.trim()) {
      const created = await createItem(
        newItemName.trim(),
        lotForm.vendor || undefined,
        pendingVendorSku || undefined
      )
      if (!created) {
        setSaving(false)
        return alert("Failed to create new item. Check the console for details.")
      }
      finalItemId = created.id
      finalItemName = created.name
    }

    const { error: lotError } = await supabase.from("inventory_lots").insert([{
      item_id: finalItemId,
      lot_number: lotForm.lot.trim(),
      expiry_date: lotForm.expiry,
      received_date: lotForm.receivedDate,
      storage_location: lotForm.storage,
      quantity_type: "count_only",
      units: 0,
      unit_label: "units",
      count: lotForm.totalUnits,
      count_label: "units",
      notes: lotForm.notes,
      status: "In Storage"
    }])

    if (lotError) {
      setSaving(false)
      return alert("Error saving lot: " + lotError.message)
    }

    await logActivity(
      "Added", finalItemName, lotForm.lot,
      `Received ${lotForm.totalUnits} units into ${lotForm.storage}`
    )
    await refreshData()
    await loadItems()
    setSaving(false)
    setShowItemModal(false)
    setScanBadge(null)
    setPendingVendorSku("")
    toast({ title: "Saved", description: `${finalItemName} — Lot ${lotForm.lot} added to inventory.` })
  }

  const canSave = (!!selectedItemId || !!newItemName.trim()) && !!lotForm.lot.trim()

  // ── RENDER ──
  return (
    <div className="relative flex flex-col gap-6">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Inventory List</h1>
        <div className="flex gap-3">
          <button onClick={() => { resetBarcodeState(); setShowBarcodeModal(true) }} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>

          <button onClick={openManualEntry} className="flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-all">
            <Plus className="size-5" /> Add Manually
          </button>
        </div>
      </div>

      {/* ── MAIN TABLE ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>Item / Lot</span><span>Received</span><span>Expiry</span><span>Total units</span><span>Status</span><span></span>
        </div>
        {visibleInventoryLots.length > 0 ? (
          visibleInventoryLots.map((lot: LotEntry, idx: number, arr: LotEntry[]) => {
            const isFirst = idx === 0 || arr[idx - 1].itemName !== lot.itemName
            const badges = getStatusBadges(lot)
            const hasWarning = badges.some(b => b.label === "Low Stock" || b.label === "Expiring Soon")

            return (
              <div key={lot.lotId} className={`grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors ${isFirst && idx !== 0 ? "border-t-border border-t-2" : ""}`}>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-bold text-foreground truncate">{lot.itemName}</span>
                  <span className="font-mono text-sm font-semibold text-primary">Lot {lot.lot}</span>
                </div>
                <span className="text-muted-foreground/80">{lot.receivedDate}</span>
                <span className="font-medium text-foreground/90">{lot.expiry}</span>
                <span className="font-semibold text-foreground tabular-nums">{lot.totalUnits}</span>

                <div className="flex flex-col gap-1.5 items-start">
                  {badges.map(b => (
                    <span key={b.label} className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${b.color}`}>{b.label}</span>
                  ))}
                  {hasWarning && (
                    <button onClick={e => { e.stopPropagation(); openReorderModal(lot) }} className="text-[9px] font-black text-primary uppercase hover:underline ml-1">+ Reorder</button>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  {userRole === "manager" ? (
                    <>
                      <button onClick={() => { setEditingLot(lot); setLotForm(lot); setSelectedItemId(lot.itemId); setNewItemName(""); setItemSearchQuery(""); setScanBadge(null); setShowItemModal(true) }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-all"><Pencil className="size-4" /></button>
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

      {/* ══════════════════════════════════════════════════════════════════
          BARCODE SCAN MODAL
         ══════════════════════════════════════════════════════════════════ */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="flex justify-between items-center px-10 py-8 border-b border-border bg-muted/20">
              <div className="flex items-center gap-4 font-bold text-xl text-foreground"><Scan className="size-8 text-primary" /> Scan Barcode</div>
              <button onClick={() => { setShowBarcodeModal(false); resetBarcodeState() }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
            </div>
            <div className="p-10 space-y-8 text-center">

              {/* Awaiting scan input */}
              {!barcodeMatched && !barcodeScanning && !barcodeError && (
                <>
                  <div className="h-40 border-4 border-dashed border-border rounded-[2rem] flex flex-col items-center justify-center bg-muted/30 text-muted-foreground gap-3">
                    <Camera className="size-12 opacity-30" />
                    <p className="text-sm font-bold uppercase tracking-[0.2em] opacity-50">Awaiting Input</p>
                  </div>
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-widest block text-left ml-2">Scan or Paste Barcode</label>
                    <div className="flex gap-3">
                      <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === "Enter" && triggerScan(barcodeInput)} placeholder="Scan barcode here…" className="flex-1 h-16 border border-input bg-background rounded-2xl px-6 text-lg font-mono focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all" />
                      <button onClick={() => triggerScan(barcodeInput)} className="px-8 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:opacity-90 transition-all shadow-sm shadow-primary/20">Look up</button>
                    </div>
                  </div>
                  <button onClick={openManualEntry} className="text-sm font-semibold text-muted-foreground hover:text-primary underline underline-offset-8">Barcode unreadable? Click to enter manually</button>
                </>
              )}

              {/* Loading */}
              {barcodeScanning && (
                <div className="flex flex-col items-center gap-4 py-12">
                  <Loader2 className="size-10 text-primary animate-spin" />
                  <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Looking up vendor SKU…</p>
                </div>
              )}

              {/* No match — offer to create new item */}
              {barcodeError && !barcodeScanning && (
                <div className="space-y-6">
                  <div className="bg-destructive/5 border-2 border-destructive/20 p-8 rounded-[2rem] space-y-4 text-left">
                    <div className="flex items-center gap-3 font-bold text-destructive text-lg"><AlertTriangle className="size-6" /> Lookup Failed</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{barcodeError}</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={resetBarcodeState} className="flex-1 h-14 border border-border bg-card rounded-xl font-bold text-base text-muted-foreground hover:bg-muted transition-all">Try Again</button>
                    <button onClick={openManualFromBarcode} className="flex-1 h-14 bg-primary text-primary-foreground rounded-xl font-bold text-base shadow-lg hover:opacity-90">Create / Select Item</button>
                  </div>
                </div>
              )}

              {/* Match found */}
              {barcodeMatched && !barcodeScanning && (
                <div className="bg-primary/5 border-2 border-primary/20 p-8 rounded-[2rem] space-y-6 text-left">
                  <div className="flex items-center gap-3 font-bold text-primary text-lg"><CheckCircle2 className="size-6" /> Barcode Matched</div>
                  <div className="grid grid-cols-2 gap-6 text-sm">
                    <div>
                      <p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Item (from Database)</p>
                      <p className="font-bold text-xl">{barcodeMatched.item.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">vendor_sku: <span className="font-mono">{barcodeMatched.item.vendor_sku}</span></p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Vendor</p>
                      <p className="font-bold text-lg">{barcodeMatched.item.vendor || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Lot #</p>
                      <p className="font-mono font-bold text-xl">{barcodeMatched.lot || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Expiry</p>
                      <p className="font-mono font-bold text-xl">{barcodeMatched.expiry || "—"}</p>
                    </div>
                  </div>
                  <button onClick={applyBarcodeToForm} className="w-full h-14 bg-primary text-primary-foreground rounded-xl font-bold text-lg shadow-lg hover:opacity-90">Review & Edit Info</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ADD / EDIT ITEM MODAL
          Creatable combobox · Required lot · No manual status select
         ══════════════════════════════════════════════════════════════════ */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-7xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">

            {/* Modal header */}
            <div className="flex justify-between items-center px-12 py-8 border-b border-border bg-muted/20">
              <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                <div className="p-3 rounded-2xl bg-primary/10"><Plus className="size-8 text-primary" /></div>
                <span>{editingLot ? "Edit Lot Entry" : "Add New Item / Lot"}</span>
              </div>
              <button onClick={() => { setShowItemModal(false); setScanBadge(null); setPendingVendorSku("") }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-7" /></button>
            </div>

            {/* Scan badge */}
            {scanBadge && (
              <div className="mx-12 mt-6 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3">
                <CheckCircle2 className="size-5 text-primary shrink-0" />
                <p className="text-sm text-foreground">
                  <span className="font-bold">Scanned via {scanBadge.format}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="font-mono text-primary">{scanBadge.sku}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Review the pre-filled values, then confirm.</span>
                </p>
              </div>
            )}

            {/* Pending vendor_sku notice (when creating a new item from a failed scan) */}
            {pendingVendorSku && !scanBadge && (
              <div className="mx-12 mt-6 flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-5 py-3">
                <AlertTriangle className="size-5 text-yellow-600 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Scanned SKU <span className="font-mono font-bold text-foreground">{pendingVendorSku}</span> will be saved as the <span className="font-bold">vendor_sku</span> on the new item.
                </p>
              </div>
            )}

            {/* Form grid */}
            <div className="p-12 grid grid-cols-2 gap-12">

              {/* ── Column 1: Identity ── */}
              <div className="space-y-8 border-r border-border pr-12">
                <div className="space-y-4">
                  <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">1. Item & Lot</p>

                  {/* Creatable combobox */}
                  <div ref={itemDropdownRef} className="relative">
                    {/* State A: An existing item is selected (chip view) */}
                    {selectedItemId && selectedItemObj ? (
                      <div className="flex items-center gap-3 w-full h-14 border border-input bg-background rounded-2xl px-6">
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-medium truncate">{selectedItemObj.name}</p>
                          {selectedItemObj.vendor && <p className="text-xs text-muted-foreground truncate">{selectedItemObj.vendor}</p>}
                        </div>
                        <button
                          onClick={() => { setSelectedItemId(""); setItemSearchQuery(""); setTimeout(() => itemSearchRef.current?.focus(), 50) }}
                          className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all shrink-0"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : newItemName ? (
                      /* State B: User chose to create a new item (chip view, green accent) */
                      <div className="flex items-center gap-3 w-full h-14 border border-green-500/50 bg-green-500/5 rounded-2xl px-6">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-green-600 bg-green-500/10 px-2 py-0.5 rounded-md">New</span>
                            <p className="text-base font-medium truncate">{newItemName}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">Will be created on save</p>
                        </div>
                        <button
                          onClick={() => { setNewItemName(""); setItemSearchQuery(""); setTimeout(() => itemSearchRef.current?.focus(), 50) }}
                          className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all shrink-0"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      /* State C: Search input */
                      <div className="relative">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        <input
                          ref={itemSearchRef}
                          value={itemSearchQuery}
                          onChange={e => { setItemSearchQuery(e.target.value); setItemDropdownOpen(true) }}
                          onFocus={() => setItemDropdownOpen(true)}
                          placeholder="Type to search or create item…"
                          className="w-full h-14 border border-input bg-background rounded-2xl pl-12 pr-6 text-base font-medium outline-none focus:ring-4 focus:ring-primary/10"
                        />
                      </div>
                    )}

                    {/* Dropdown */}
                    {itemDropdownOpen && !selectedItemId && !newItemName && (
                      <div className="absolute z-10 mt-2 w-full max-h-64 overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
                        {filteredItems.map(item => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setSelectedItemId(item.id)
                              setNewItemName("")
                              setItemSearchQuery("")
                              setItemDropdownOpen(false)
                              if (item.vendor) {
                                setLotForm(prev => ({ ...prev, vendor: item.vendor || "" }))
                              }
                            }}
                            className="flex flex-col w-full text-left px-5 py-3 hover:bg-muted/60 transition-colors border-b border-border/30 last:border-b-0"
                          >
                            <span className="text-sm font-medium text-foreground">{item.name}</span>
                            {item.vendor && <span className="text-xs text-muted-foreground">{item.vendor}</span>}
                          </button>
                        ))}
                        {showCreateOption && (
                          <button
                            onClick={() => {
                              setNewItemName(itemSearchQuery.trim())
                              setSelectedItemId("")
                              setItemSearchQuery("")
                              setItemDropdownOpen(false)
                            }}
                            className="flex items-center gap-3 w-full text-left px-5 py-3.5 hover:bg-green-500/5 transition-colors border-t border-border bg-green-500/[0.02]"
                          >
                            <Plus className="size-4 text-green-600" />
                            <span className="text-sm font-bold text-green-600">Create &ldquo;{itemSearchQuery.trim()}&rdquo;</span>
                          </button>
                        )}
                        {filteredItems.length === 0 && !showCreateOption && (
                          <div className="px-5 py-4 text-sm text-muted-foreground text-center">No items match your search.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {!selectedItemId && !newItemName && (
                    <p className="text-xs text-muted-foreground ml-1">Type to search. If the item doesn&apos;t exist, you can create it.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">
                    Lot Number <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={lotForm.lot}
                    onChange={e => setLotForm({ ...lotForm, lot: e.target.value })}
                    placeholder="e.g. 1358-ABC"
                    className={`w-full h-14 border bg-background rounded-2xl px-6 text-base font-mono ${!lotForm.lot.trim() ? "border-destructive/50 focus:ring-destructive/20" : "border-input"}`}
                  />
                  {!lotForm.lot.trim() && (
                    <p className="text-xs text-destructive ml-1">Required — every lot must have a lot number.</p>
                  )}
                </div>
              </div>

              {/* ── Column 2: Logistics & Quantity ── */}
              <div className="space-y-8">
                <p className="text-xs font-black text-primary uppercase tracking-[0.2em]">2. Logistics & Quantity</p>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiry Date</label><input type="date" value={lotForm.expiry} onChange={e => setLotForm({ ...lotForm, expiry: e.target.value })} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Vendor</label><input value={lotForm.vendor} onChange={e => setLotForm({ ...lotForm, vendor: e.target.value })} placeholder="e.g. Sigma Aldrich" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Storage Location</label><input value={lotForm.storage} onChange={e => setLotForm({ ...lotForm, storage: e.target.value })} placeholder="e.g. Fridge C" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Total Units Received</label>
                    <input type="number" min={1} value={lotForm.totalUnits} onChange={e => setLotForm({ ...lotForm, totalUnits: Number(e.target.value) })} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-bold" />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-5 px-12 py-10 border-t border-border bg-muted/20">
              <button onClick={() => { setShowItemModal(false); setScanBadge(null); setPendingVendorSku("") }} className="px-10 py-4 rounded-2xl border border-border bg-card font-bold text-base text-muted-foreground hover:bg-muted transition-all">Cancel</button>
              <button
                onClick={saveItem}
                disabled={!canSave || saving}
                className="px-16 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-3"
              >
                {saving && <Loader2 className="size-5 animate-spin" />}
                {editingLot ? "Update Lot" : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          REORDER REQUEST MODAL
         ══════════════════════════════════════════════════════════════════ */}
      {showReorderModal && reorderLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-[2rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-8 py-6 border-b border-border bg-muted/20">
              <div className="flex items-center gap-3 font-bold text-lg text-foreground">
                <div className="p-2 rounded-xl bg-primary/10"><Send className="size-5 text-primary" /></div>
                Reorder Request
              </div>
              <button onClick={() => { setShowReorderModal(false); setReorderLot(null) }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-5" /></button>
            </div>
            <div className="p-8 space-y-6">
              <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Item</span>
                  <span className="font-bold text-foreground">{reorderLot.itemName}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Vendor</span>
                  <span className="text-sm text-foreground">{allItems.find(i => i.id === reorderLot.itemId)?.vendor || reorderLot.vendor || "—"}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Request Date</span>
                  <span className="text-sm font-mono text-foreground">{getLabCurrentDateStr(labSettings.labTimezone)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Quantity to Request</label>
                <input
                  type="number"
                  min={1}
                  value={reorderQty}
                  onChange={e => setReorderQty(Math.max(1, Number(e.target.value)))}
                  className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-xl font-bold text-center focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end gap-4 px-8 py-6 border-t border-border bg-muted/20">
              <button onClick={() => { setShowReorderModal(false); setReorderLot(null) }} className="px-6 py-3 rounded-xl border border-border bg-card font-bold text-sm text-muted-foreground hover:bg-muted transition-all">Cancel</button>
              <button
                onClick={submitReorder}
                disabled={reorderSaving || reorderQty < 1}
                className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-90 transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
              >
                {reorderSaving && <Loader2 className="size-4 animate-spin" />}
                <Send className="size-4" />
                Send to Manager
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
