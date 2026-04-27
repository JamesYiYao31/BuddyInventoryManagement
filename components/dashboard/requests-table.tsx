"use client"

import { useEffect, useState } from "react"
import { Plus, X, CheckCircle2, PackagePlus, DollarSign, Clock, ArrowRight, ShieldAlert, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { 
  ReorderRequest, REQUEST_STATUS_STYLES, CATALOG_DB, 
  logActivity, createRequestInSupabase, updateRequestInSupabase,
  deleteRequestInSupabase, resolveCurrentUserLabId
} from "@/lib/inventory-utils"

interface RequestsTabProps {
  requests: ReorderRequest[]
  refreshRequests: () => Promise<void> | void
  userRole: "manager" | "technician"
}

export default function RequestsTab({ requests, refreshRequests, userRole }: RequestsTabProps) {
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [showReceiveModal, setShowReceiveModal] = useState<ReorderRequest | null>(null)
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null)
  
  const [catalogInput, setCatalogInput] = useState("")
  const [itemName, setItemName] = useState("")
  const [vendor, setVendor] = useState("")
  const [linkedItemId, setLinkedItemId] = useState<string | null>(null)
  const [linkedItemCatalogNumber, setLinkedItemCatalogNumber] = useState<string>("")
  const [itemMatches, setItemMatches] = useState<Array<{ id: string; name: string; vendor: string | null; catalog_number: string | null }>>([])
  const [showItemMatches, setShowItemMatches] = useState(false)
  const [orderQty, setOrderQty] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const [notes, setNotes] = useState("")

  const [receiveLot, setReceiveLot] = useState("")
  const [receiveExpiry, setReceiveExpiry] = useState("")
  const [receiveQty, setReceiveQty] = useState(1)

  useEffect(() => {
    if (!showRequestModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRequestModal(false)
        resetRequestForm()
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showRequestModal])

  useEffect(() => {
    if (!showReceiveModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowReceiveModal(null)
        setReceiveQty(1)
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showReceiveModal])

  const resetRequestForm = () => {
    setCatalogInput("")
    setItemName("")
    setVendor("")
    setLinkedItemId(null)
    setLinkedItemCatalogNumber("")
    setItemMatches([])
    setShowItemMatches(false)
    setOrderQty(1)
    setUnitPrice(0)
    setNotes("")
    setEditingRequestId(null)
  }

  const handleCatalogChange = (cat: string) => {
    setCatalogInput(cat)
    const found = CATALOG_DB[cat]
    if (found) {
      setItemName(found.name); setVendor(found.vendor); setUnitPrice(found.price)
      setLinkedItemId(null)
      setLinkedItemCatalogNumber("")
      setShowItemMatches(false)
    } else {
      setItemName(""); setVendor(""); setUnitPrice(0)
      setLinkedItemId(null)
      setLinkedItemCatalogNumber("")
      setShowItemMatches(false)
    }
  }

  useEffect(() => {
    if (!showRequestModal || editingRequestId) return
    if (linkedItemId) return

    const q = itemName.trim()
    if (q.length < 2) {
      setItemMatches([])
      setShowItemMatches(false)
      return
    }

    const timer = setTimeout(async () => {
      const labId = await resolveCurrentUserLabId()
      if (!labId) return
      const { data, error } = await supabase
        .from("items")
        .select("id, name, vendor, catalog_number")
        .eq("lab_id", labId)
        .ilike("name", `%${q}%`)
        .order("name", { ascending: true })
        .limit(8)
      if (error) return
      const matches = (data || []) as Array<{ id: string; name: string; vendor: string | null; catalog_number: string | null }>
      setItemMatches(matches)
      setShowItemMatches(matches.length > 0)
    }, 300)

    return () => clearTimeout(timer)
  }, [showRequestModal, itemName, linkedItemId, editingRequestId])

  const handleSelectMatchedItem = (item: { id: string; name: string; vendor: string | null; catalog_number: string | null }) => {
    setLinkedItemId(item.id)
    setItemName(item.name)
    setVendor(item.vendor || "")
    setCatalogInput(item.catalog_number || "")
    setLinkedItemCatalogNumber(item.catalog_number || "")
    setShowItemMatches(false)
  }

  const submitRequest = async () => {
    if (!itemName) return alert("Please enter a valid item name.")
    const typedCatalog = catalogInput.trim()
    const shouldOfferCatalogSave = Boolean(
      linkedItemId &&
      !editingRequestId &&
      typedCatalog &&
      !linkedItemCatalogNumber
    )

    const payload = {
      itemId: linkedItemId,
      catalogNumber: typedCatalog,
      itemName,
      vendor,
      orderQty,
      unitPrice,
      notes,
    }

    const { error } = editingRequestId
      ? await updateRequestInSupabase(editingRequestId, payload)
      : await createRequestInSupabase(payload)
    
    if (error) return alert("Error: " + error.message)

    await logActivity(
      editingRequestId ? "Edited" : "Ordered",
      itemName,
      "N/A",
      editingRequestId
        ? `Updated request details to ${orderQty} units from ${vendor}`
        : `Requested ${orderQty} units from ${vendor}`
    )

    if (shouldOfferCatalogSave && linkedItemId) {
      const shouldSave = window.confirm(
        `Save this catalog number (${typedCatalog}) to the item catalog for future use?`
      )
      if (shouldSave) {
        const labId = await resolveCurrentUserLabId()
        if (labId) {
          const { data: currentItem } = await supabase
            .from("items")
            .select("catalog_number")
            .eq("id", linkedItemId)
            .eq("lab_id", labId)
            .maybeSingle()

          const existingCatalog = currentItem?.catalog_number?.trim() || ""
          if (!existingCatalog) {
            await supabase
              .from("items")
              .update({ catalog_number: typedCatalog })
              .eq("id", linkedItemId)
              .eq("lab_id", labId)
          }
        }
      }
    }

    await refreshRequests()
    setShowRequestModal(false)
    resetRequestForm()
  }

  const openEditModal = (request: ReorderRequest) => {
    setEditingRequestId(request.id)
    setCatalogInput(request.catalogNumber || "")
    setItemName(request.itemName || "")
    setVendor(request.vendor || "")
    setLinkedItemId(null)
    setLinkedItemCatalogNumber("")
    setItemMatches([])
    setShowItemMatches(false)
    setOrderQty(request.orderQty || 1)
    setUnitPrice(request.unitPrice || 0)
    setNotes(request.notes || "")
    setShowRequestModal(true)
  }

  const updateStatus = async (id: string, newStatus: ReorderRequest["status"]) => {
    if (userRole !== 'manager') return alert("Unauthorized: Only managers can approve requests.")
    const labId = await resolveCurrentUserLabId()
    if (!labId) return alert("Could not resolve lab context. Please refresh and try again.")
    const { error } = await supabase.from('requests').update({ status: newStatus }).eq('id', id).eq("lab_id", labId)
    if (error) alert("Error: " + error.message)
    else await refreshRequests()
  }

  const receiveToInventory = async () => {
    if (!showReceiveModal || !receiveLot) return alert("Lot number is required.")
    if (receiveQty < 1) return alert("Quantity must be at least 1.")
    const labId = await resolveCurrentUserLabId()
    if (!labId) return alert("Could not resolve lab context. Please refresh and try again.")

    const { data: itemData } = await supabase
      .from('items')
      .select('id')
      .eq('name', showReceiveModal.itemName)
      .eq("lab_id", labId)
      .single()
    let finalItemId = itemData?.id

    if (!finalItemId) {
      const { data: newItem } = await supabase
        .from('items')
        .insert([{ lab_id: labId, name: showReceiveModal.itemName, vendor: showReceiveModal.vendor, catalog_number: showReceiveModal.catalogNumber }])
        .select()
        .single()
      finalItemId = newItem?.id
    }

    const { error: lotError } = await supabase.from('inventory_lots').insert([{
        lab_id: labId,
        item_id: finalItemId,
        lot_number: receiveLot,
        expiry_date: receiveExpiry,
        received_date: new Date().toISOString().split('T')[0],
        quantity_type: "count_only",
        units: 0,
        unit_label: "units",
        count: receiveQty,
        count_label: "units",
        status: "In Storage"
      }])

    if (lotError) return alert("Inventory Error: " + lotError.message)

    await logActivity("Received", showReceiveModal.itemName, receiveLot, `Received ${receiveQty} units into inventory`)
    
    await supabase.from('requests').update({ status: "Received" }).eq('id', showReceiveModal.id).eq("lab_id", labId)

    await refreshRequests() // Updates Dashboard State automatically
    setShowReceiveModal(null)
    setReceiveQty(1)
  }

  const handleDeleteRequest = async (req: ReorderRequest) => {
    if (!window.confirm(`Are you sure you want to delete the request for "${req.itemName}"?`)) return
    try {
      await deleteRequestInSupabase(req.id)
      await logActivity("Disposed", req.itemName, "N/A", `Manager deleted purchase request (${req.orderQty} units from ${req.vendor})`)
      await refreshRequests()
    } catch {
      alert("Error deleting request.")
    }
  }

  return (
    <div className="relative flex w-full flex-col gap-6">
      {/* ── HEADER ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">Request reorders and track purchasing status.</p>
        </div>
        <button onClick={() => { resetRequestForm(); setShowRequestModal(true) }} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
          <Plus className="size-5" /> Create Reorder Request
        </button>
      </div>

      {/* ── METRICS ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="min-w-0 overflow-hidden bg-card border border-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
           <div className="p-3 bg-yellow-500/10 text-yellow-600 rounded-xl"><Clock className="size-6" /></div>
           <div className="min-w-0"><p className="truncate text-xs font-bold text-muted-foreground uppercase tracking-widest">Pending</p><p className="text-2xl font-black text-foreground">{requests.filter(r => r.status === "Pending").length}</p></div>
        </div>
        <div className="min-w-0 overflow-hidden bg-card border border-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
           <div className="p-3 bg-purple-500/10 text-purple-600 rounded-xl"><PackagePlus className="size-6" /></div>
           <div className="min-w-0"><p className="truncate text-xs font-bold text-muted-foreground uppercase tracking-widest">Ordered</p><p className="text-2xl font-black text-foreground">{requests.filter(r => r.status === "Ordered").length}</p></div>
        </div>
        {userRole === "manager" && (
          <div className="min-w-0 overflow-hidden bg-card border border-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
             <div className="p-3 bg-green-500/10 text-green-600 rounded-xl"><DollarSign className="size-6" /></div>
             <div className="min-w-0"><p className="truncate text-xs font-bold text-muted-foreground uppercase tracking-widest">Total Spend</p><p className="text-2xl font-black text-foreground">${requests.reduce((sum, r) => sum + r.totalPrice, 0).toFixed(2)}</p></div>
          </div>
        )}
      </div>

      {/* ── MAIN TABLE ── */}
      <div className="block sm:hidden space-y-3 p-4">
        {requests.length > 0 ? requests.map((req) => (
          <div key={req.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-foreground">{req.itemName}</p>
                <p className="text-xs text-muted-foreground">{req.vendor}</p>
              </div>
              <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${REQUEST_STATUS_STYLES[req.status]}`}>{req.status}</span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Catalog <span className="font-medium text-foreground">{req.catalogNumber || "N/A"}</span></div>
              <div>Qty <span className="font-medium text-foreground">{req.orderQty}</span></div>
              <div>Unit Price <span className="font-medium text-foreground">{req.unitPrice || "—"}</span></div>
              <div>Date <span className="font-medium text-foreground">{req.dateRequested}</span></div>
            </div>
            {req.notes && (
              <p className="mb-3 text-xs text-muted-foreground">{req.notes}</p>
            )}
            <div className="flex justify-end gap-2">
              {req.status === "Pending" && userRole === "manager" && (
                <button onClick={() => updateStatus(req.id, "Approved")} className="px-3 py-1.5 bg-blue-500/10 text-blue-600 font-bold text-xs rounded-lg hover:bg-blue-500/20 transition-all">Approve</button>
              )}
              {req.status === "Pending" && (
                <button onClick={() => openEditModal(req)} className="px-3 py-1.5 bg-muted text-foreground font-bold text-xs rounded-lg hover:bg-muted/80 transition-all">Edit</button>
              )}
              {req.status === "Approved" && userRole === "manager" && (
                <button onClick={() => updateStatus(req.id, "Ordered")} className="px-3 py-1.5 bg-purple-500/10 text-purple-600 font-bold text-xs rounded-lg hover:bg-purple-500/20 transition-all">Mark Ordered</button>
              )}
              {req.status === "Ordered" && (
                <button onClick={() => { setShowReceiveModal(req); setReceiveQty(req.orderQty || 1) }} className="px-3 py-1.5 bg-green-500 text-white font-bold text-xs rounded-lg shadow-sm hover:bg-green-600 transition-all">Receive Item</button>
              )}
              {req.status === "Received" && <CheckCircle2 className="size-5 text-green-500" />}
              {userRole === "manager" && (
                <button onClick={() => handleDeleteRequest(req)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all" title="Delete request">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>
        )) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">No purchase requests found.</div>
        )}
      </div>

      <div className="hidden sm:block rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr_1.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>Req ID</span><span>Item Name</span><span>Vendor</span><span>Qty</span><span>Total</span><span>Status</span><span className="text-right">Actions</span>
        </div>
        {requests.length > 0 ? requests.map((req) => (
          <div key={req.id} className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr_1.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors">
            <span className="font-mono text-xs text-muted-foreground">#{req.id.slice(0, 5)}</span>
            <div><p className="font-bold text-foreground">{req.itemName}</p><p className="text-[10px] font-mono text-muted-foreground uppercase">CAT: {req.catalogNumber || "N/A"}</p></div>
            <span className="font-medium text-muted-foreground">{req.vendor}</span>
            <span className="font-bold text-foreground">{req.orderQty}</span>
            <span className="font-bold text-foreground">${req.totalPrice.toFixed(2)}</span>
            <div><span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${REQUEST_STATUS_STYLES[req.status]}`}>{req.status}</span></div>
            <div className="flex justify-end gap-2">
              {req.status === "Pending" && (
                userRole === "manager" ? (
                  <button onClick={() => updateStatus(req.id, "Approved")} className="px-3 py-1.5 bg-blue-500/10 text-blue-600 font-bold text-xs rounded-lg hover:bg-blue-500/20 transition-all">Approve</button>
                ) : (
                  <span className="text-[10px] italic text-muted-foreground flex items-center gap-1"><ShieldAlert className="size-3"/> Awaiting Admin</span>
                )
              )}
              {req.status === "Pending" && (
                <button onClick={() => openEditModal(req)} className="px-3 py-1.5 bg-muted text-foreground font-bold text-xs rounded-lg hover:bg-muted/80 transition-all">Edit</button>
              )}
              {req.status === "Approved" && userRole === "manager" && (
                <button onClick={() => updateStatus(req.id, "Ordered")} className="px-3 py-1.5 bg-purple-500/10 text-purple-600 font-bold text-xs rounded-lg hover:bg-purple-500/20 transition-all">Mark Ordered</button>
              )}
              {req.status === "Ordered" && (
                <button onClick={() => { setShowReceiveModal(req); setReceiveQty(req.orderQty || 1) }} className="px-3 py-1.5 bg-green-500 text-white font-bold text-xs rounded-lg shadow-sm hover:bg-green-600 transition-all">Receive Item</button>
              )}
              {req.status === "Received" && <CheckCircle2 className="size-5 text-green-500 mr-2" />}
              {userRole === "manager" && (
                <button onClick={() => handleDeleteRequest(req)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all" title="Delete request">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>
        )) : (
          <div className="p-20 text-center text-muted-foreground">No purchase requests found.</div>
        )}
      </div>

      {/* ── MODAL: CREATE REORDER REQUEST (1.5x Giant Layout) ── */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="mx-2 flex w-full max-w-2xl md:max-w-3xl lg:max-w-7xl max-h-[90vh] flex-col rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 sm:mx-auto">
            <div className="flex justify-between items-center px-4 py-8 border-b border-border bg-muted/20 sm:px-12">
              <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                <div className="p-3 rounded-2xl bg-primary/10"><Plus className="size-8 text-primary" /></div>
                <span>{editingRequestId ? "Edit Reorder Request" : "Create Reorder Request"}</span>
              </div>
              <button onClick={() => { setShowRequestModal(false); resetRequestForm() }} className="p-2 rounded-full hover:bg-muted text-muted-foreground transition-all"><X className="size-7" /></button>
            </div>
            <div className="overflow-y-auto flex-1">
            <div className="grid grid-cols-1 gap-12 p-4 md:grid-cols-[2fr_1.5fr] xl:grid-cols-[2fr_1.5fr_2fr] sm:p-12">
              <div className="space-y-8 md:border-r md:border-border md:pr-12">
                <p className="text-xs font-black text-primary uppercase tracking-widest">1. Item Details</p>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Catalog Number</label>
                  <input value={catalogInput} onChange={e => handleCatalogChange(e.target.value)} placeholder="Catalog number" className="w-full h-14 border border-input bg-background rounded-2xl px-6 font-mono text-base outline-none focus:ring-4 focus:ring-primary/10" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Item Name *</label>
                  <input
                    value={itemName}
                    onChange={e => {
                      const v = e.target.value
                      setItemName(v)
                      if (!editingRequestId) {
                        setLinkedItemId(null)
                        setLinkedItemCatalogNumber("")
                      }
                    }}
                    onFocus={() => { if (!editingRequestId && itemMatches.length > 0) setShowItemMatches(true) }}
                    placeholder="Reagent name"
                    className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium outline-none"
                  />
                  {!editingRequestId && showItemMatches && itemMatches.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
                      {itemMatches.map(match => (
                        <button
                          key={match.id}
                          type="button"
                          onClick={() => handleSelectMatchedItem(match)}
                          className="w-full text-left px-5 py-3 hover:bg-muted/60 transition-colors border-b border-border/30 last:border-b-0"
                        >
                          <p className="text-sm font-semibold text-foreground">{match.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(match.vendor || "Unknown vendor")} · CAT: {match.catalog_number || "N/A"}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Vendor / Company</label>
                  <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Manufacturer" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium" />
                </div>
              </div>
              <div className="flex flex-col gap-4 xl:contents">
                <div className="space-y-8 xl:border-r xl:border-border xl:pr-12">
                  <p className="text-xs font-black text-primary uppercase tracking-widest">2. Order Metrics</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Order Qty</label><input type="number" min={1} value={orderQty} onChange={e => setOrderQty(Number(e.target.value))} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-xl font-bold" /></div>
                    <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Unit Price ($)</label><input type="number" value={unitPrice} onChange={e => setUnitPrice(Number(e.target.value))} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-bold" /></div>
                  </div>
                  {userRole === "manager" && (
                    <div className="p-6 bg-primary/5 rounded-3xl border border-primary/20 flex justify-between items-center mt-4">
                      <span className="text-xs font-bold uppercase text-primary tracking-widest">Estimated Total</span>
                      <span className="text-4xl font-black text-primary">${(orderQty * unitPrice).toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-8">
                  <p className="text-xs font-black text-primary uppercase tracking-widest">3. Additional Info</p>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Notes for Manager</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Urgent..." className="w-full h-48 border border-input bg-background rounded-3xl p-6 text-base resize-none outline-none focus:ring-4 focus:ring-primary/10" /></div>
                </div>
              </div>
            </div>
            </div>
            <div className="flex justify-end gap-5 border-t border-border bg-muted/20 px-4 py-10 sm:px-12">
              <button onClick={() => { setShowRequestModal(false); resetRequestForm() }} className="px-10 py-4 rounded-2xl border border-border bg-card font-bold text-base text-muted-foreground hover:bg-muted transition-all">Cancel</button>
              <button onClick={submitRequest} className="px-16 py-4 rounded-2xl bg-primary text-primary-foreground font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all">{editingRequestId ? "Save Changes" : "Submit Request"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RECEIVE INTO INVENTORY ── */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="mx-2 w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 sm:mx-auto">
             <div className="flex justify-between items-center border-b border-border bg-muted/20 px-4 py-8 sm:px-10">
              <h2 className="font-bold text-2xl text-foreground flex items-center gap-3"><PackagePlus className="size-8 text-green-500" /> Receive Order</h2>
              <button onClick={() => setShowReceiveModal(null)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
            </div>
            <div className="space-y-8 p-4 sm:p-10">
              <div className="bg-green-500/10 border border-green-500/20 p-8 rounded-[2rem] text-center">
                <p className="text-xs font-bold uppercase text-green-600 tracking-widest mb-2">Incoming Item</p>
                <p className="font-black text-3xl text-foreground">{showReceiveModal.itemName}</p>
                <p className="text-sm font-semibold text-muted-foreground mt-2">Choose how many units to add to inventory</p>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Physical Lot Number *</label><input value={receiveLot} onChange={e => setReceiveLot(e.target.value)} placeholder="Check bottle..." className="w-full h-14 border border-input bg-background rounded-2xl px-6 font-mono font-bold text-lg focus:ring-2 focus:ring-green-500/50" /></div>
                <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiration Date *</label><input type="date" value={receiveExpiry} onChange={e => setReceiveExpiry(e.target.value)} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-lg focus:ring-2 focus:ring-green-500/50" /></div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Quantity to Add</label>
                <input
                  type="number"
                  min={1}
                  value={receiveQty}
                  onChange={e => setReceiveQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-lg font-bold focus:ring-2 focus:ring-green-500/50"
                />
              </div>
            </div>
            <div className="flex gap-4 border-t border-border bg-muted/20 px-4 py-8 sm:px-10">
               <button onClick={() => setShowReceiveModal(null)} className="px-8 py-4 rounded-2xl border border-border bg-card font-bold text-base text-muted-foreground hover:bg-muted transition-all">Cancel</button>
               <button onClick={receiveToInventory} className="flex-1 h-14 rounded-2xl bg-green-500 text-white font-black text-lg hover:bg-green-600 flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 transition-all">Add to Inventory <ArrowRight className="size-5"/></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}