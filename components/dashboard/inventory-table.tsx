"use client"

import { useState, useRef, useEffect } from "react"
import { Scan, Plus, Pencil, Trash2, Camera, X, CheckCircle2 } from "lucide-react"
import { 
  LotEntry, InventoryGroup, LabSettings, STATUS_STYLES, 
  totalCountLabel, daysUntilExpiry, getLotStatus, emptyLotForm 
} from "@/lib/inventory-utils"

const KNOWN_ITEMS: Record<string, { name: string; vendor: string }> = {
  "100124": { name: "IAST Culture Bottle", vendor: "Thermo Fisher" },
  "2687598": { name: "FACS Clean", vendor: "BD Biosciences" },
  "26542": { name: "BioBall", vendor: "Merck" },
}

interface InventoryTabProps {
  inventory: InventoryGroup[]
  setInventory: React.Dispatch<React.SetStateAction<InventoryGroup[]>>
  sortedFlatInventory: any[]
  labSettings: LabSettings
  selectedItems: Set<string>
}

export default function InventoryTab({ inventory, setInventory, sortedFlatInventory, labSettings, selectedItems }: InventoryTabProps) {
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)
  const [showItemModal, setShowItemModal] = useState(false)
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  const [editingLot, setEditingLot] = useState<{ groupId: string; lotId: string } | null>(null)
  const [newItemName, setNewItemName] = useState("")
  const [isNewGroup, setIsNewGroup] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [lotForm, setLotForm] = useState(emptyLotForm())
  const [barcodeInput, setBarcodeInput] = useState("")
  const [barcodeResult, setBarcodeResult] = useState<{lot: string, expiry: string, itemCode: string, type: string, name?: string, vendor?: string, isExistingItem?: boolean} | null>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showBarcodeModal && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100)
  }, [showBarcodeModal])

  const parseBarcode = (rawCode: string) => {
    let parsed = { lot: "", expiry: "", itemCode: "", type: "1D" }
    if (rawCode.length < 10 && !rawCode.includes("(")) {
      parsed.lot = rawCode; return parsed
    }
    parsed.type = "2D/GS1"
    if (rawCode.includes("(10)")) parsed.lot = rawCode.split("(10)")[1]?.split("(")[0] || ""
    if (rawCode.includes("(01)")) parsed.itemCode = rawCode.split("(01)")[1]?.substring(0, 6) || ""
    if (rawCode.includes("(17)")) parsed.expiry = "2027-12-31" 
    return parsed
  }

  const triggerScan = (code: string) => {
    const res = parseBarcode(code)
    const known = KNOWN_ITEMS[res.itemCode]
    const existing = inventory.find(g => g.name === known?.name)
    setBarcodeResult({ ...res, name: known?.name, vendor: known?.vendor, isExistingItem: !!existing })
    if (existing) { setSelectedGroupId(existing.itemId); setIsNewGroup(false) }
    else { setNewItemName(known?.name || ""); setIsNewGroup(true) }
  }

  const applyBarcodeToForm = () => {
    setLotForm(p => ({ ...p, lot: barcodeResult?.lot || "", expiry: barcodeResult?.expiry || "", vendor: barcodeResult?.vendor || "" }))
    setShowBarcodeModal(false); setShowItemModal(true); setBarcodeResult(null)
  }

  const saveItem = () => {
    const newLot = { ...lotForm, lotId: Date.now().toString() } as LotEntry
    if (!isNewGroup && selectedGroupId) {
      setInventory(prev => prev.map(g => g.itemId === selectedGroupId ? { ...g, lots: editingLot ? g.lots.map(l => l.lotId === editingLot.lotId ? newLot : l) : [...g.lots, newLot] } : g))
    } else {
      setInventory(prev => [...prev, { itemId: Date.now().toString(), name: newItemName, lots: [newLot] }])
    }
    setShowItemModal(false); setEditingLot(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Inventory ({sortedFlatInventory.length} lots)</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowBarcodeModal(true)} className="flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-90"><Scan className="size-4" /> Scan Reagent</button>
          <button onClick={() => { setEditingLot(null); setIsNewGroup(true); setNewItemName(""); setLotForm(emptyLotForm()); setShowItemModal(true) }} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"><Plus className="size-4" /> Add Manually</button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[2fr_1.5fr_1.2fr_1.2fr_1.5fr_1.2fr_0.5fr] border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <span>Item Name</span><span>Lot Number</span><span>Received</span><span>Expiry</span><span>Quantity</span><span>Status</span><span></span>
        </div>
        {sortedFlatInventory.map((lot, idx, arr) => {
          const isFirst = idx === 0 || arr[idx-1].itemName !== lot.itemName
          const status = getLotStatus(lot, labSettings)
          const days = daysUntilExpiry(lot.expiry)
          return (
            <div key={lot.lotId} className={`grid grid-cols-[2fr_1.5fr_1.2fr_1.2fr_1.5fr_1.2fr_0.5fr] px-4 py-3 items-center border-t border-border/40 hover:bg-muted/10 cursor-pointer ${isFirst && idx !== 0 ? "border-t-2 border-border" : ""}`} onClick={() => setSelectedLotId(selectedLotId === lot.lotId ? null : lot.lotId)}>
              <span className="text-xs font-bold">{isFirst ? lot.itemName : ""}</span>
              <span className="text-xs font-mono">{lot.lot}</span>
              <span className="text-xs text-muted-foreground">{lot.receivedDate}</span>
              <span className={`text-xs ${days < 7 ? "text-destructive font-bold" : ""}`}>{lot.expiry}</span>
              <span className="text-xs">{totalCountLabel(lot)}</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[status]}`}>{status}</span>
              <div className="flex justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); setEditingLot({groupId: lot.itemId, lotId: lot.lotId}); setIsNewGroup(false); setSelectedGroupId(lot.itemId); setLotForm(lot); setShowItemModal(true) }} className="p-1 hover:text-primary"><Pencil className="size-3" /></button>
                <button onClick={(e) => { e.stopPropagation(); setInventory(prev => prev.map(g => g.itemId === lot.itemId ? { ...g, lots: g.lots.filter(l => l.lotId !== lot.lotId) } : g).filter(g => g.lots.length > 0)) }} className="p-1 hover:text-destructive"><Trash2 className="size-3" /></button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── BARCODE MODAL ── */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4">
            <div className="flex justify-between items-center"><h2 className="font-semibold">Scan Barcode</h2><button onClick={() => setShowBarcodeModal(false)}><X className="size-4" /></button></div>
            {!barcodeResult ? (
               <div className="space-y-4">
                 <div className="h-40 bg-muted rounded-xl flex items-center justify-center"><Camera className="size-10 text-muted-foreground" /></div>
                 <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && triggerScan(barcodeInput)} placeholder="Scan or type barcode..." className="w-full h-10 border border-input rounded-lg px-3 text-sm focus:ring-2 focus:ring-primary" />
               </div>
            ) : (
              <div className="bg-muted/30 p-4 rounded-xl space-y-3">
                <p className="text-xs font-bold text-success flex items-center gap-2"><CheckCircle2 className="size-4" /> Barcode Captured</p>
                <div className="text-xs space-y-1">
                  <p>Item: <b>{barcodeResult.name || "Unknown"}</b></p>
                  <p>Lot: <b>{barcodeResult.lot}</b></p>
                </div>
                <button onClick={applyBarcodeToForm} className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm">Review & Save</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADD/EDIT MODAL ── */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-6 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-6">
            <div className="flex justify-between items-center"><h2>{editingLot ? "Edit Lot" : "Add Lot"}</h2><button onClick={() => setShowItemModal(false)}><X className="size-4" /></button></div>
            <div className="space-y-4 text-xs">
              {!editingLot && (
                <div className="flex gap-2">
                  <button onClick={() => setIsNewGroup(true)} className={`flex-1 py-2 rounded-lg border ${isNewGroup ? "border-primary bg-primary/10" : ""}`}>New Item</button>
                  <button onClick={() => setIsNewGroup(false)} className={`flex-1 py-2 rounded-lg border ${!isNewGroup ? "border-primary bg-primary/10" : ""}`}>Existing</button>
                </div>
              )}
              {isNewGroup ? <input placeholder="Item Name" value={newItemName} onChange={e => setNewItemName(e.target.value)} className="w-full h-9 border rounded-lg px-3" /> : 
                <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)} className="w-full h-9 border rounded-lg px-3">{inventory.map(g => <option key={g.itemId} value={g.itemId}>{g.name}</option>)}</select>}
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Lot #" value={lotForm.lot} onChange={e => setLotForm(p => ({...p, lot: e.target.value}))} className="h-9 border rounded-lg px-3" />
                <input type="date" value={lotForm.expiry} onChange={e => setLotForm(p => ({...p, expiry: e.target.value}))} className="h-9 border rounded-lg px-3" />
              </div>
              <button onClick={saveItem} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold">Save to Inventory</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}