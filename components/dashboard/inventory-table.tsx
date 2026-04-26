"use client"

import { supabase } from "@/lib/supabase"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
  Scan, Plus, Pencil, X, Trash2, ShieldAlert, AlertCircle,
  CheckCircle2, Loader2, AlertTriangle, Search, Send, ChevronDown, ChevronUp
} from "lucide-react"
import BarcodeCameraScanner from "@/components/dashboard/barcode-camera-scanner"
import {
  LotEntry, daysUntilExpiry, emptyLotForm, getLabCurrentDateStr,
  logActivity, InventoryGroup, LabSettings, Item, ReorderRequest,
  parseSmartBarcode, fetchAllItems, lookupItemByVendorSku, createItem,
  deleteInventoryLotInSupabase, resolveCurrentUserLabId, submitCOARecord, uploadCOAFile, submitLotValidation,
  ItemThresholdFields, updateItemThresholds,
} from "@/lib/inventory-utils"
import { useToast } from "@/hooks/use-toast"

interface InventoryTabProps {
  inventory: InventoryGroup[]
  sortedFlatInventory: any[]
  labSettings: LabSettings
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
  requests?: ReorderRequest[]
}

function parseOptionalPositiveInt(raw: string): number | null {
  const t = raw.trim()
  if (t === "") return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 1) return null
  return n
}

function parseOptionalNonNegativeInt(raw: string): number | null {
  const t = raw.trim()
  if (t === "") return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export default function InventoryTab({
  inventory, sortedFlatInventory, labSettings, refreshData, userRole, requests = []
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
  const [requiresCoa, setRequiresCoa] = useState(false)
  const [requiresLotValidation, setRequiresLotValidation] = useState(false)

  const [thresholdsSectionOpen, setThresholdsSectionOpen] = useState(false)
  const [thresholdExpiringSoon, setThresholdExpiringSoon] = useState("")
  const [thresholdUrgent, setThresholdUrgent] = useState("")
  const [thresholdLowStock, setThresholdLowStock] = useState("")
  const [thresholdWorkingDays, setThresholdWorkingDays] = useState("")

  // ── 3. BARCODE MODAL STATE ──
  const [barcodeInput, setBarcodeInput] = useState("")
  const [barcodeInputMode, setBarcodeInputMode] = useState<"usb" | "camera">("usb")
  const [barcodeScanning, setBarcodeScanning] = useState(false)
  const [barcodeMatched, setBarcodeMatched] = useState<{ item: Item; lot: string; expiry: string; format: string; sku: string } | null>(null)
  const [barcodeError, setBarcodeError] = useState("")
  const [barcodeCameraError, setBarcodeCameraError] = useState("")
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

  const pendingItemNames = useMemo(() => {
    const names = new Set<string>()
    for (const r of requests) {
      if (r.status === "Pending") names.add(r.itemName.toLowerCase())
    }
    return names
  }, [requests])

  const itemById = useMemo(() => {
    const map = new Map<string, Item>()
    for (const item of allItems) map.set(item.id, item)
    return map
  }, [allItems])

  const labAllowsTechThresholdEdits = labSettings.techsCanEditThresholds !== false
  const thresholdInputsDisabled = userRole === "technician" && !labAllowsTechThresholdEdits
  const canPersistThresholds = userRole === "manager" || labAllowsTechThresholdEdits

  const resetThresholdForm = useCallback(() => {
    setThresholdsSectionOpen(false)
    setThresholdExpiringSoon("")
    setThresholdUrgent("")
    setThresholdLowStock("")
    setThresholdWorkingDays("")
  }, [])

  useEffect(() => {
    if (!showItemModal || !selectedItemObj) return
    setThresholdExpiringSoon(
      selectedItemObj.expiring_soon_days != null ? String(selectedItemObj.expiring_soon_days) : ""
    )
    setThresholdUrgent(selectedItemObj.urgent_days != null ? String(selectedItemObj.urgent_days) : "")
    setThresholdLowStock(
      selectedItemObj.low_stock_threshold != null ? String(selectedItemObj.low_stock_threshold) : ""
    )
    setThresholdWorkingDays(
      selectedItemObj.working_expiry_days != null ? String(selectedItemObj.working_expiry_days) : ""
    )
  }, [showItemModal, selectedItemObj])

  // ── 5. DYNAMIC STATUS FROM lab_settings THRESHOLDS (+ optional item overrides) ──
  type StatusBadge = { label: string; color: string }

  const getStatusBadges = (lot: LotEntry): StatusBadge[] => {
    const badges: StatusBadge[] = []
    const itemCfg = itemById.get(lot.itemId)
    const expiringSoonDays = itemCfg?.expiring_soon_days ?? labSettings.expiringSoonDays
    const urgentDays = itemCfg?.urgent_days ?? labSettings.urgentDays
    const lowStockThreshold = itemCfg?.low_stock_threshold ?? labSettings.lowStockThreshold
    const days = daysUntilExpiry(lot.expiry, labSettings.labTimezone)

    if (days < 0 && lot.expiry) {
      badges.push({ label: "Expired", color: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" })
      return badges
    }

    if (lot.expiry && days >= 0 && days <= expiringSoonDays) {
      const isUrgent = days <= urgentDays
      badges.push({
        label: isUrgent ? "Urgent" : "Expiring Soon",
        color: isUrgent
          ? "bg-red-500/10 text-red-700 dark:text-red-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400",
      })
    }

    if ((lot.totalUnits ?? 0) <= lowStockThreshold) {
      badges.push({ label: "Low Stock", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" })
    }

    if (badges.length === 0) {
      badges.push({ label: "In Storage", color: "bg-green-500/10 text-green-600 dark:text-green-400" })
    }

    return badges
  }

  const VALIDATION_BADGE_MAP: Record<string, { label: string; color: string }> = {
    "pending_coa": { label: "Pending COA", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
    "pending_validation": { label: "Pending Validation", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
    "pending_approval": { label: "Pending Approval", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    "approved": { label: "Approved", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
    "rejected": { label: "Rejected", color: "bg-red-500/10 text-red-600 dark:text-red-400" },
  }

  /** Same `validation_status` field as COA, labels/colors for the Lot Validation subsection only. */
  const LOT_VALIDATION_SECTION_BADGE_MAP: Record<string, { label: string; color: string }> = {
    pending_coa: {
      label: "Pending COA",
      color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    },
    pending_validation: {
      label: "Pending Validation",
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    },
    pending_approval: {
      label: "Pending Approval",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    approved: {
      label: "Approved",
      color: "bg-green-500/10 text-green-600 dark:text-green-400",
    },
    rejected: {
      label: "Rejected",
      color: "bg-red-500/10 text-red-600 dark:text-red-400",
    },
  }

  // ── 6. REORDER MODAL STATE & ACTIONS ──
  const [showReorderModal, setShowReorderModal] = useState(false)
  const [reorderLot, setReorderLot] = useState<any>(null)
  const [reorderQty, setReorderQty] = useState(1)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [reorderCatalogNumber, setReorderCatalogNumber] = useState("")
  const [reorderCatalogFromItem, setReorderCatalogFromItem] = useState("")

  const openReorderModal = async (lot: any) => {
    setReorderLot(lot)
    setReorderQty(1)
    setReorderCatalogNumber("")
    setReorderCatalogFromItem("")
    const labId = await resolveCurrentUserLabId()
    if (labId && lot.itemId) {
      const { data } = await supabase
        .from("items")
        .select("catalog_number")
        .eq("id", lot.itemId)
        .eq("lab_id", labId)
        .maybeSingle()
      const cat = data?.catalog_number?.trim() || ""
      setReorderCatalogNumber(cat)
      setReorderCatalogFromItem(cat)
    }
    setShowReorderModal(true)
  }

  const submitReorder = async () => {
    if (!reorderLot || reorderQty < 1) return
    setReorderSaving(true)

    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setReorderSaving(false)
      return alert("Could not resolve lab context. Please refresh and try again.")
    }

    const catalogItem = allItems.find(i => i.id === reorderLot.itemId)
    const vendor = catalogItem?.vendor || reorderLot.vendor || ""
    const dateRequested = getLabCurrentDateStr(labSettings.labTimezone)
    const typedCatalog = reorderCatalogNumber.trim()
    const shouldOfferCatalogSave = Boolean(
      reorderLot.itemId &&
      typedCatalog &&
      !reorderCatalogFromItem
    )

    const { error } = await supabase
      .from("requests")
      .insert([{
        lab_id: labId,
        item_id: reorderLot.itemId,
        item_name: reorderLot.itemName,
        vendor,
        catalog_number: typedCatalog,
        order_qty: reorderQty,
        status: "Pending",
        date_requested: dateRequested,
        notes: `Reorder request for ${reorderQty} units.`
      }])

    setReorderSaving(false)
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message })
    } else {
      if (shouldOfferCatalogSave) {
        const shouldSave = window.confirm(
          `Save this catalog number (${typedCatalog}) to the item catalog for future use?`
        )
        if (shouldSave) {
          const { data: currentItem } = await supabase
            .from("items")
            .select("catalog_number")
            .eq("id", reorderLot.itemId)
            .eq("lab_id", labId)
            .maybeSingle()

          const existingCatalog = currentItem?.catalog_number?.trim() || ""
          if (!existingCatalog) {
            await supabase
              .from("items")
              .update({ catalog_number: typedCatalog })
              .eq("id", reorderLot.itemId)
              .eq("lab_id", labId)
          }
        }
      }

      await logActivity("Ordered", reorderLot.itemName, "", `Reorder request for ${reorderQty} units`)
      toast({ title: "Request Sent", description: `Reorder for ${reorderLot.itemName} sent to manager.` })
      await refreshData()
    }
    setShowReorderModal(false)
    setReorderLot(null)
  }

  // ── INVENTORY DELETE MODAL STATE ──
  const [showInventoryDeleteModal, setShowInventoryDeleteModal] = useState<any>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null)
  const [currentLabId, setCurrentLabId] = useState<string | null>(null)
  const [expandCoaFile, setExpandCoaFile] = useState<File | null>(null)
  const [expandSharedNotes, setExpandSharedNotes] = useState("")
  const [expandCoaSaving, setExpandCoaSaving] = useState(false)
  const [expandValidationFile, setExpandValidationFile] = useState<File | null>(null)
  const [expandValidationSaving, setExpandValidationSaving] = useState(false)
  const [existingValidationByLotId, setExistingValidationByLotId] = useState<Record<string, { id: string; file_url?: string | null; file_name?: string | null } | null>>({})

  useEffect(() => {
    if (!showBarcodeModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowBarcodeModal(false)
        resetBarcodeState()
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showBarcodeModal])

  useEffect(() => {
    if (!showItemModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowItemModal(false)
        setScanBadge(null)
        setPendingVendorSku("")
        resetThresholdForm()
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showItemModal, resetThresholdForm])

  useEffect(() => {
    if (!showInventoryDeleteModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInventoryDeleteModal(null)
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showInventoryDeleteModal])

  useEffect(() => {
    if (!showReorderModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowReorderModal(false)
        setReorderLot(null)
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showReorderModal])

  const openDeleteModal = (lot: any) => {
    if (userRole !== "manager") return alert("Unauthorized: Only managers can delete inventory.")
    setDeleteReason("")
    setShowInventoryDeleteModal(lot)
  }

  const resetExpandedForms = () => {
    setExpandCoaFile(null)
    setExpandSharedNotes("")
    setExpandValidationFile(null)
  }

  const toggleExpandedLot = (lotId: string) => {
    setExpandedLotId(prev => {
      const next = prev === lotId ? null : lotId
      resetExpandedForms()
      return next
    })
  }

  const handleExpandedRowToggle = async (lot: LotEntry) => {
    const nextLotId = expandedLotId === lot.lotId ? null : lot.lotId
    toggleExpandedLot(lot.lotId)
    if (!nextLotId) return

    const labId = currentLabId || await resolveCurrentUserLabId()
    if (!labId) return

    const { data: existingValidation } = await supabase
      .from("lot_validation_records")
      .select("id, file_url, file_name")
      .eq("lot_id", lot.lotId)
      .eq("lab_id", labId)
      .maybeSingle()

    setExistingValidationByLotId(prev => ({ ...prev, [lot.lotId]: existingValidation || null }))
  }

  useEffect(() => {
    const loadLabId = async () => {
      const labId = await resolveCurrentUserLabId()
      setCurrentLabId(labId)
    }
    loadLabId()
  }, [])

  const handleExpandedCoaSubmit = async (lot: LotEntry) => {
    if (!expandCoaFile) return
    setExpandCoaSaving(true)
    const labId = currentLabId || await resolveCurrentUserLabId()
    if (!labId) {
      setExpandCoaSaving(false)
      toast({ variant: "destructive", title: "Error", description: "No lab context." })
      return
    }
    const uploaded = await uploadCOAFile(lot.lotId, labId, expandCoaFile)
    if (!uploaded) {
      setExpandCoaSaving(false)
      toast({ variant: "destructive", title: "Error", description: "COA upload failed." })
      return
    }
    const result = await submitCOARecord(
      lot.lotId,
      uploaded.fileUrl,
      uploaded.fileName,
      lot.lot,
      lot.expiry,
      expandSharedNotes
    )
    setExpandCoaSaving(false)
    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: result.error || "Failed to submit COA." })
      return
    }
    toast({ title: "COA Submitted", description: `Lot ${lot.lot} COA submitted.` })
    await refreshData()
    await loadItems()
  }

  const handleExpandedValidationSubmit = async (lot: LotEntry) => {
    if (!expandValidationFile) {
      toast({ variant: "destructive", title: "Please upload a supporting document." })
      return
    }
    setExpandValidationSaving(true)
    const labId = currentLabId || await resolveCurrentUserLabId()
    if (!labId) {
      setExpandValidationSaving(false)
      toast({ variant: "destructive", title: "Error", description: "No lab context." })
      return
    }
    const uploaded = await uploadCOAFile(lot.lotId, labId, expandValidationFile)
    if (!uploaded) {
      setExpandValidationSaving(false)
      toast({ variant: "destructive", title: "Error", description: "Validation file upload failed." })
      return
    }
    const result = await submitLotValidation(
      lot.lotId,
      "",
      "acceptable",
      expandSharedNotes,
      uploaded.fileUrl,
      uploaded.fileName
    )
    setExpandValidationSaving(false)
    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: result.error || "Failed to submit validation." })
      return
    }
    setExistingValidationByLotId(prev => ({
      ...prev,
      [lot.lotId]: { id: lot.lotId, file_url: uploaded.fileUrl, file_name: uploaded.fileName },
    }))
    toast({ title: "Validation Submitted", description: `Lot ${lot.lot} validation submitted.` })
    await refreshData()
  }

  const handleConfirmInventoryDelete = async () => {
    if (!showInventoryDeleteModal) return
    const reason = deleteReason.trim()
    if (!reason) return alert("Please provide a reason for deletion.")
    try {
      await deleteInventoryLotInSupabase(
        showInventoryDeleteModal.lotId,
        showInventoryDeleteModal.itemName,
        showInventoryDeleteModal.lot,
        reason
      )
      setShowInventoryDeleteModal(null)
      setDeleteReason("")
      await refreshData()
    } catch {
      alert("Error deleting lot from inventory.")
    }
  }

  // ── 7. BARCODE SCAN → PARSE → LOOKUP ──
  const resetBarcodeState = () => {
    setBarcodeInput("")
    setBarcodeInputMode("usb")
    setBarcodeScanning(false)
    setBarcodeMatched(null)
    setBarcodeError("")
    setBarcodeCameraError("")
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
    const parsedLot = (parsed.lot || "").trim() || code.trim()
    setBarcodeParsedSku(parsed.sku)
    setBarcodeParsedLot(parsedLot)
    setBarcodeParsedExpiry(parsed.expiry)

    const matchedItem = await lookupItemByVendorSku(parsed.sku)
    setBarcodeScanning(false)

    if (matchedItem) {
      setBarcodeMatched({
        item: matchedItem,
        lot: parsedLot,
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
    setRequiresCoa(false)
    setRequiresLotValidation(false)
    resetThresholdForm()
    setShowItemModal(true)
  }

  // ── 8. SAVE (create-if-needed → insert/update lot) ──
  const saveItem = async () => {
    const hasItem = !!selectedItemId || !!newItemName.trim()
    if (!hasItem) return alert("You must select or create an item.")
    if (!lotForm.lot.trim()) return alert("Lot number is required.")
    if (!lotForm.totalUnits || lotForm.totalUnits < 1) return alert("Total units received must be at least 1.")

    setSaving(true)
    let finalItemId = selectedItemId
    let finalItemName = selectedItemObj?.name || ""

    // If user typed a new item name, create it first
    let newItemRequiresCoa = false
    let newItemRequiresLotValidation = false
    if (!selectedItemId && newItemName.trim()) {
      const thresholdPayload: ItemThresholdFields | null = canPersistThresholds
        ? {
            expiring_soon_days: parseOptionalPositiveInt(thresholdExpiringSoon),
            urgent_days: parseOptionalPositiveInt(thresholdUrgent),
            low_stock_threshold: parseOptionalNonNegativeInt(thresholdLowStock),
            working_expiry_days: parseOptionalPositiveInt(thresholdWorkingDays),
          }
        : null
      const created = await createItem(
        newItemName.trim(),
        lotForm.vendor || undefined,
        pendingVendorSku || undefined,
        requiresCoa,
        requiresLotValidation,
        thresholdPayload
      )
      if (!created) {
        setSaving(false)
        return alert("Failed to create new item. Check the console for details.")
      }
      finalItemId = created.id
      finalItemName = created.name
      newItemRequiresCoa = requiresCoa
      newItemRequiresLotValidation = requiresLotValidation
    }

    // Determine validation_status for this lot
    const existingItemObj = selectedItemId ? allItems.find(i => i.id === selectedItemId) : null
    const itemRequiresCoa = selectedItemId ? (existingItemObj?.requires_coa ?? false) : newItemRequiresCoa
    const itemRequiresLotValidation = selectedItemId ? (existingItemObj?.requires_lot_validation ?? false) : newItemRequiresLotValidation
    let lotValidationStatus = "not_required"
    if (itemRequiresCoa) {
      lotValidationStatus = "pending_coa"
    } else if (itemRequiresLotValidation) {
      lotValidationStatus = "pending_validation"
    }

    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setSaving(false)
      return alert("Could not resolve lab context. Please refresh and try again.")
    }

    // Add flow guard: prevent duplicate lot_number for the same item within the same lab.
    if (!editingLot) {
      const { data: existingLot } = await supabase
        .from("inventory_lots")
        .select("id")
        .eq("lab_id", labId)
        .eq("item_id", finalItemId)
        .eq("lot_number", lotForm.lot.trim())
        .maybeSingle()

      if (existingLot) {
        setSaving(false)
        return alert("This lot number already exists for this item. Edit the existing lot instead.")
      }
    }

    const lotPayload = {
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
      status: "In Storage",
      validation_status: lotValidationStatus,
    }

    const lotMutation = editingLot
      ? supabase
          .from("inventory_lots")
          .update(lotPayload)
          .eq("id", editingLot.lotId)
          .eq("lab_id", labId)
      : supabase
          .from("inventory_lots")
          .insert([{ lab_id: labId, ...lotPayload }])

    const { error: lotError } = await lotMutation

    if (lotError) {
      setSaving(false)
      return alert("Error saving lot: " + lotError.message)
    }

    if (selectedItemId && canPersistThresholds) {
      const thresholdPayload: ItemThresholdFields = {
        expiring_soon_days: parseOptionalPositiveInt(thresholdExpiringSoon),
        urgent_days: parseOptionalPositiveInt(thresholdUrgent),
        low_stock_threshold: parseOptionalNonNegativeInt(thresholdLowStock),
        working_expiry_days: parseOptionalPositiveInt(thresholdWorkingDays),
      }
      const tr = await updateItemThresholds(selectedItemId, thresholdPayload)
      if (!tr.success) {
        setSaving(false)
        return alert("Lot saved but item thresholds could not be updated: " + (tr.error || "Unknown error"))
      }
    }

    await logActivity(
      editingLot ? "Edited" : "Added",
      finalItemName,
      lotForm.lot,
      editingLot
        ? `Updated lot details (${lotForm.totalUnits} units in ${lotForm.storage})`
        : `Received ${lotForm.totalUnits} units into ${lotForm.storage}`
    )
    await refreshData()
    await loadItems()
    setSaving(false)
    setShowItemModal(false)
    setScanBadge(null)
    setPendingVendorSku("")
    setRequiresCoa(false)
    setRequiresLotValidation(false)
    resetThresholdForm()
    toast({
      title: "Saved",
      description: editingLot
        ? `${finalItemName} — Lot ${lotForm.lot} updated.`
        : `${finalItemName} — Lot ${lotForm.lot} added to inventory.`,
    })
  }

  const canSave = (!!selectedItemId || !!newItemName.trim()) && !!lotForm.lot.trim()

  // ── RENDER ──
  return (
    <div className="relative flex w-full flex-col gap-6">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Inventory List</h1>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
          <button onClick={() => { resetBarcodeState(); setShowBarcodeModal(true) }} className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-md hover:opacity-90 transition-all">
            <Scan className="size-5" /> Scan Reagent
          </button>

          <button onClick={openManualEntry} className="w-full justify-center sm:w-auto flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-all">
            <Plus className="size-5" /> Add Manually
          </button>
        </div>
      </div>

      <div className="block sm:hidden space-y-3 p-4">
        {inventory.length > 0 ? (
          inventory.map((group) => {
            const groupLots = (group.lots || []).filter((lot: LotEntry) => (lot.totalUnits ?? 0) > 0)
            if (groupLots.length === 0) return null

            return (
              <div key={group.itemId} className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{group.name}</p>
                    <p className="text-xs text-muted-foreground">{group.vendor || "—"}</p>
                  </div>
                  {userRole === "manager" && (
                    <button
                      type="button"
                      onClick={openManualEntry}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-all"
                    >
                      <Plus className="size-3.5" />
                      Add Item
                    </button>
                  )}
                </div>

                {groupLots.map((lot: LotEntry) => {
                  const badges = getStatusBadges(lot)
                  const hasWarning = badges.some(b => b.label === "Low Stock" || b.label === "Expiring Soon")
                  const itemConfig = itemById.get(lot.itemId)
                  const requiresCoaForLot = Boolean(itemConfig?.requires_coa)
                  const requiresValidationForLot = Boolean(itemConfig?.requires_lot_validation)

                  return (
                    <div key={lot.lotId} className="mt-2 rounded-xl border border-border/50 bg-muted/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-mono font-bold text-primary">Lot {lot.lot}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">Exp: {lot.expiry || "—"}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {badges.map(b => (
                            <span key={b.label} className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${b.color}`}>{b.label}</span>
                          ))}
                          {lot.validation_status && (
                            <>
                              {requiresCoaForLot && requiresValidationForLot && (lot.validation_status === "pending_coa" || lot.validation_status === "pending_validation") ? (
                                <>
                                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP["pending_coa"].color}`}>
                                    {VALIDATION_BADGE_MAP["pending_coa"].label}
                                  </span>
                                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP["pending_validation"].color}`}>
                                    {VALIDATION_BADGE_MAP["pending_validation"].label}
                                  </span>
                                </>
                              ) : VALIDATION_BADGE_MAP[lot.validation_status] ? (
                                <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP[lot.validation_status].color}`}>
                                  {VALIDATION_BADGE_MAP[lot.validation_status].label}
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-sm font-bold text-foreground">{lot.totalUnits} units</p>
                        <div className="flex gap-2">
                          {hasWarning && !pendingItemNames.has((group.name || "").toLowerCase()) && (
                            <button onClick={() => openReorderModal(lot)} className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-black uppercase hover:bg-primary/20 transition-all">Reorder</button>
                          )}
                          {userRole === "manager" ? (
                            <>
                              <button onClick={() => { setEditingLot(lot); setLotForm(lot); setSelectedItemId(lot.itemId); setNewItemName(""); setItemSearchQuery(""); setScanBadge(null); setShowItemModal(true) }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-all"><Pencil className="size-4" /></button>
                              <button onClick={() => openDeleteModal(lot)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-all"><Trash2 className="size-4" /></button>
                            </>
                          ) : (
                            <span title="Manager Only" className="p-2"><ShieldAlert className="size-4 text-muted-foreground/30" /></span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">No items match the selected filters.</div>
        )}
      </div>

      {/* ── MAIN TABLE ── */}
      <div className="hidden sm:block rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>Item / Lot</span><span>Received</span><span>Expiry</span><span>Total units</span><span>Status</span><span></span>
        </div>
        {visibleInventoryLots.length > 0 ? (
          visibleInventoryLots.map((lot: LotEntry, idx: number, arr: LotEntry[]) => {
            const isFirst = idx === 0 || arr[idx - 1].itemName !== lot.itemName
            const badges = getStatusBadges(lot)
            const hasWarning = badges.some(b => b.label === "Low Stock" || b.label === "Expiring Soon")
            const itemConfig = itemById.get(lot.itemId)
            const requiresCoaForLot = Boolean(itemConfig?.requires_coa)
            const requiresValidationForLot = Boolean(itemConfig?.requires_lot_validation)
            const isExpanded = expandedLotId === lot.lotId

            return (
              <div key={lot.lotId} className={`${isFirst && idx !== 0 ? "border-t-border border-t-2" : ""}`}>
                <div
                  onClick={() => handleExpandedRowToggle(lot)}
                  className="w-full grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1.2fr_0.5fr] px-6 py-4 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-colors text-left cursor-pointer"
                >
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
                    {lot.validation_status && (
                      <>
                        {requiresCoaForLot && requiresValidationForLot && (lot.validation_status === "pending_coa" || lot.validation_status === "pending_validation") ? (
                          <>
                            <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP["pending_coa"].color}`}>
                              {VALIDATION_BADGE_MAP["pending_coa"].label}
                            </span>
                            <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP["pending_validation"].color}`}>
                              {VALIDATION_BADGE_MAP["pending_validation"].label}
                            </span>
                          </>
                        ) : VALIDATION_BADGE_MAP[lot.validation_status] ? (
                          <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP[lot.validation_status].color}`}>
                            {VALIDATION_BADGE_MAP[lot.validation_status].label}
                          </span>
                        ) : null}
                      </>
                    )}
                    {hasWarning && (
                      pendingItemNames.has((lot.itemName || "").toLowerCase()) ? (
                        <span className="inline-flex px-3 py-1 rounded-full text-[9px] font-bold bg-muted text-muted-foreground cursor-default ml-1">Pending Request</span>
                      ) : (
                        <button onClick={e => { e.stopPropagation(); openReorderModal(lot) }} className="text-[9px] font-black text-primary uppercase hover:underline ml-1">+ Reorder</button>
                      )
                    )}
                  </div>

                  <div className="flex justify-end items-center gap-2">
                    {userRole === "manager" ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setEditingLot(lot); setLotForm(lot); setSelectedItemId(lot.itemId); setNewItemName(""); setItemSearchQuery(""); setScanBadge(null); setShowItemModal(true) }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-all"><Pencil className="size-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); openDeleteModal(lot) }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-all"><Trash2 className="size-4" /></button>
                      </>
                    ) : (
                      <span title="Manager Only">
                        <ShieldAlert className="size-4 text-muted-foreground/30" />
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-6 py-5 border-t border-border/40 bg-muted/10 space-y-5">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lot Number</p>
                        <p className="font-mono font-bold text-foreground">{lot.lot}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expiry</p>
                        <p className="font-mono font-bold text-foreground">{lot.expiry || "—"}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Storage</p>
                        <p className="font-medium text-foreground">{lot.storage || "—"}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notes</p>
                        <p className="font-medium text-foreground">{lot.notes || "—"}</p>
                      </div>
                    </div>

                    {requiresCoaForLot && (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">COA</p>
                        {lot.validation_status && VALIDATION_BADGE_MAP[lot.validation_status] && (
                          <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${VALIDATION_BADGE_MAP[lot.validation_status].color}`}>
                            {VALIDATION_BADGE_MAP[lot.validation_status].label}
                          </span>
                        )}

                        {lot.validation_status === "pending_coa" && (
                          <div className="space-y-3">
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setExpandCoaFile(e.target.files?.[0] || null)} className="w-full h-11 border border-input bg-background rounded-xl px-4 text-sm" />
                            <button onClick={() => handleExpandedCoaSubmit(lot)} disabled={!expandCoaFile || expandCoaSaving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 inline-flex items-center gap-2">
                              {expandCoaSaving && <Loader2 className="size-4 animate-spin" />}
                              Submit COA
                            </button>
                          </div>
                        )}

                        {(lot.validation_status === "pending_approval" || lot.validation_status === "approved") && (
                          <p className="text-sm text-muted-foreground">COA submitted — awaiting manager review.</p>
                        )}
                        {lot.validation_status === "rejected" && (
                          <p className="text-sm font-bold text-red-600">Rejected</p>
                        )}
                      </div>
                    )}

                    {requiresValidationForLot && (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Lot Validation</p>
                        {lot.validation_status === "pending_coa" ? (
                          <p className="text-xs text-muted-foreground italic">
                            Submit COA first before Lot Validation.
                          </p>
                        ) : LOT_VALIDATION_SECTION_BADGE_MAP[lot.validation_status ?? ""] && (
                          <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${LOT_VALIDATION_SECTION_BADGE_MAP[lot.validation_status ?? ""].color}`}>
                            {LOT_VALIDATION_SECTION_BADGE_MAP[lot.validation_status ?? ""].label}
                          </span>
                        )}
                        {lot.validation_status === "pending_validation" && (
                          <>
                            <p className="text-sm text-muted-foreground">
                              Upload your supporting document below. A manager will review and approve in the Validation &amp; COA tab.
                            </p>
                            {existingValidationByLotId[lot.lotId] ? (
                              <p className="text-sm text-muted-foreground">Validation submitted — awaiting manager review.</p>
                            ) : (
                              <>
                                <input
                                  type="file"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  onChange={e => setExpandValidationFile(e.target.files?.[0] || null)}
                                  className="w-full h-11 border border-input bg-background rounded-xl px-4 text-sm"
                                />
                                {expandValidationFile && (
                                  <p className="text-xs text-muted-foreground">
                                    Selected file: <span className="font-medium text-foreground">{expandValidationFile.name}</span>
                                  </p>
                                )}
                                <button onClick={() => handleExpandedValidationSubmit(lot)} disabled={!expandValidationFile || expandValidationSaving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 inline-flex items-center gap-2">
                                  {expandValidationSaving && <Loader2 className="size-4 animate-spin" />}
                                  Submit Lot Validation
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {lot.validation_status === "pending_approval" && (
                          <p className="text-sm text-muted-foreground">Validation submitted — awaiting manager review.</p>
                        )}
                        {lot.validation_status === "approved" && (
                          <p className="text-sm font-bold text-green-600">Approved</p>
                        )}
                        {lot.validation_status === "rejected" && (
                          <p className="text-sm font-bold text-red-600">Rejected</p>
                        )}
                      </div>
                    )}

                    {!requiresCoaForLot && !requiresValidationForLot && (
                      <p className="text-sm text-muted-foreground">No validation required for this item.</p>
                    )}

                    {(requiresCoaForLot || requiresValidationForLot) && (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Notes</label>
                        <textarea
                          value={expandSharedNotes}
                          onChange={e => setExpandSharedNotes(e.target.value)}
                          rows={3}
                          placeholder="Shared notes for COA and Lot Validation..."
                          className="w-full border border-input bg-background rounded-xl p-3 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
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
          <div className="mx-2 w-full max-w-xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 sm:mx-auto">
            <div className="flex justify-between items-center border-b border-border bg-muted/20 px-4 py-8 sm:px-10">
              <div className="flex items-center gap-4 font-bold text-xl text-foreground"><Scan className="size-8 text-primary" /> Scan Barcode</div>
              <button onClick={() => { setShowBarcodeModal(false); resetBarcodeState() }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
            </div>
            <div className="space-y-8 p-4 text-center sm:p-10">

              {/* Awaiting scan input */}
              {!barcodeMatched && !barcodeScanning && !barcodeError && (
                <>
                  <div className="flex p-1.5 bg-muted rounded-2xl border border-border">
                    <button
                      onClick={() => { setBarcodeInputMode("usb"); setBarcodeCameraError("") }}
                      className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${barcodeInputMode === "usb" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}
                    >
                      USB Scanner
                    </button>
                    <button
                      onClick={() => { setBarcodeInputMode("camera"); setBarcodeCameraError("") }}
                      className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${barcodeInputMode === "camera" ? "bg-card shadow-md text-foreground border border-border" : "text-muted-foreground"}`}
                    >
                      Camera
                    </button>
                  </div>
                  {barcodeInputMode === "camera" && (
                    <div className="space-y-3">
                      <BarcodeCameraScanner
                        active={showBarcodeModal && barcodeInputMode === "camera"}
                        onResult={(code) => {
                          setBarcodeInput(code)
                          void triggerScan(code)
                        }}
                        onError={(msg) => setBarcodeCameraError(msg)}
                      />
                      {barcodeCameraError && (
                        <p className="text-left text-sm text-muted-foreground">{barcodeCameraError}</p>
                      )}
                    </div>
                  )}
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-widest block text-left ml-2">Scan or Paste Barcode</label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={e => e.key === "Enter" && triggerScan(barcodeInput)} placeholder="Scan barcode here…" className="flex-1 h-16 border border-input bg-background rounded-2xl px-6 text-lg font-mono focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all" />
                      <button onClick={() => triggerScan(barcodeInput)} className="w-full sm:w-auto px-8 bg-primary text-primary-foreground rounded-2xl font-bold text-lg hover:opacity-90 transition-all shadow-sm shadow-primary/20">Look up</button>
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
          <div className="mx-2 flex w-full max-w-7xl max-h-[90vh] flex-col rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 sm:mx-auto">

            {/* Modal header */}
            <div className="flex justify-between items-center border-b border-border bg-muted/20 px-4 py-8 sm:px-12">
              <div className="flex items-center gap-4 font-bold text-2xl text-foreground">
                <div className="p-3 rounded-2xl bg-primary/10"><Plus className="size-8 text-primary" /></div>
                <span>{editingLot ? "Edit Lot Entry" : "Add New Item / Lot"}</span>
              </div>
              <button onClick={() => { setShowItemModal(false); setScanBadge(null); setPendingVendorSku(""); resetThresholdForm() }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-7" /></button>
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

            {/* Form grid + optional thresholds */}
            <div className="space-y-10 overflow-y-auto flex-1 p-4 sm:p-12">
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">

              {/* ── Column 1: Identity ── */}
              <div className="space-y-8 sm:border-r sm:border-border sm:pr-12">
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
                          onClick={() => { setSelectedItemId(""); setItemSearchQuery(""); resetThresholdForm(); setTimeout(() => itemSearchRef.current?.focus(), 50) }}
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
                          onClick={() => { setNewItemName(""); setItemSearchQuery(""); resetThresholdForm(); setTimeout(() => itemSearchRef.current?.focus(), 50) }}
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
                              resetThresholdForm()
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

                {/* Validation toggles — only when creating a brand-new item */}
                {!editingLot && !!newItemName && (
                  <div className="space-y-3 pt-1">
                    <p className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em]">Validation Requirements</p>
                    <div className="flex flex-col gap-3">
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <button
                          type="button"
                          onClick={() => setRequiresCoa(v => !v)}
                          className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${requiresCoa ? "bg-primary" : "bg-muted border border-border"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${requiresCoa ? "translate-x-4" : ""}`} />
                        </button>
                        <span className="text-sm font-medium text-foreground">Requires COA</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <button
                          type="button"
                          onClick={() => setRequiresLotValidation(v => !v)}
                          className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${requiresLotValidation ? "bg-primary" : "bg-muted border border-border"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${requiresLotValidation ? "translate-x-4" : ""}`} />
                        </button>
                        <span className="text-sm font-medium text-foreground">Requires Lot-to-Lot Validation</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">
                    Lot Number <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={lotForm.lot}
                    onChange={e => setLotForm({ ...lotForm, lot: e.target.value })}
                    placeholder="Lot number"
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
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiry Date</label><input type="date" value={lotForm.expiry} onChange={e => setLotForm({ ...lotForm, expiry: e.target.value })} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Vendor</label><input value={lotForm.vendor} onChange={e => setLotForm({ ...lotForm, vendor: e.target.value })} placeholder="Vendor name" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2"><label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Storage Location</label><input value={lotForm.storage} onChange={e => setLotForm({ ...lotForm, storage: e.target.value })} placeholder="Storage location" className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base" /></div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Total Units Received</label>
                    <input type="number" min={1} value={lotForm.totalUnits} onChange={e => setLotForm({ ...lotForm, totalUnits: Number(e.target.value) })} className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-bold" />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => setThresholdsSectionOpen(o => !o)}
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/20 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
                >
                  <span className="text-xs font-black text-foreground uppercase tracking-[0.15em]">Item Thresholds (Optional)</span>
                  <ChevronDown className={`size-5 text-muted-foreground shrink-0 transition-transform ${thresholdsSectionOpen ? "rotate-180" : ""}`} />
                </button>
                {thresholdsSectionOpen && (
                  <div className="mt-4 space-y-6 rounded-2xl border border-border bg-muted/10 p-6">
                    <p className="text-xs text-muted-foreground italic">Leave blank to use lab default settings.</p>
                    {thresholdInputsDisabled && (
                      <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                        Threshold editing is restricted to managers for this lab.
                      </p>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Expiring Soon Warning (days)</label>
                      <input
                        type="number"
                        min={1}
                        value={thresholdExpiringSoon}
                        onChange={e => setThresholdExpiringSoon(e.target.value)}
                        disabled={thresholdInputsDisabled}
                        placeholder={`Default: ${labSettings.expiringSoonDays} days (from lab settings)`}
                        className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-muted-foreground ml-1">Warn when lot expires within this many days.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Urgent Warning (days)</label>
                      <input
                        type="number"
                        min={1}
                        value={thresholdUrgent}
                        onChange={e => setThresholdUrgent(e.target.value)}
                        disabled={thresholdInputsDisabled}
                        placeholder={`Default: ${labSettings.urgentDays} days (from lab settings)`}
                        className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-muted-foreground ml-1">Escalate warning when lot expires within this many days.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Low Stock Threshold (count)</label>
                      <input
                        type="number"
                        min={0}
                        value={thresholdLowStock}
                        onChange={e => setThresholdLowStock(e.target.value)}
                        disabled={thresholdInputsDisabled}
                        placeholder={`Default: ${labSettings.lowStockThreshold} units (from lab settings)`}
                        className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-muted-foreground ml-1">Show low stock badge when count drops to or below this.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Working Expiry (days after opening)</label>
                      <input
                        type="number"
                        min={1}
                        value={thresholdWorkingDays}
                        onChange={e => setThresholdWorkingDays(e.target.value)}
                        disabled={thresholdInputsDisabled}
                        placeholder="e.g. 7 days"
                        className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-muted-foreground ml-1">
                        Auto-fills working expiry date when a lot is opened. Tech can still edit the date manually.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-5 border-t border-border bg-muted/20 px-4 py-10 sm:px-12">
              <button onClick={() => { setShowItemModal(false); setScanBadge(null); setPendingVendorSku(""); resetThresholdForm() }} className="px-10 py-4 rounded-2xl border border-border bg-card font-bold text-base text-muted-foreground hover:bg-muted transition-all">Cancel</button>
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
          INVENTORY DELETE MODAL
         ══════════════════════════════════════════════════════════════════ */}
      {showInventoryDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="mx-2 w-full max-w-2xl rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 sm:mx-auto">
            <div className="flex justify-between items-center border-b border-border bg-destructive/5 px-4 py-8 sm:px-10">
              <div className="flex items-center gap-4 font-bold text-2xl text-destructive"><Trash2 className="size-8" /> Delete from Inventory</div>
              <button onClick={() => setShowInventoryDeleteModal(null)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-6" /></button>
            </div>
            <div className="space-y-8 p-4 sm:p-10">
              <div className="bg-destructive/5 border-2 border-destructive/20 p-8 rounded-[2rem] text-center">
                <p className="font-black text-3xl text-foreground">{showInventoryDeleteModal.itemName}</p>
                <p className="text-sm font-mono text-muted-foreground mt-2">Lot: {showInventoryDeleteModal.lot} &middot; {showInventoryDeleteModal.totalUnits} units</p>
              </div>
              <div className="space-y-4">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-2">Reason for Deletion <span className="text-destructive">*</span></label>
                <textarea
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  placeholder="Reason for deletion"
                  rows={3}
                  className="w-full border border-input bg-background rounded-2xl p-6 text-base outline-none focus:ring-4 focus:ring-destructive/10 focus:border-destructive transition-all resize-none"
                  autoFocus
                />
              </div>
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-2xl border border-border">
                <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">This will permanently remove the lot from storage and log the reason to the audit trail.</p>
              </div>
            </div>
            <div className="flex justify-end gap-5 border-t border-border bg-muted/20 px-4 py-8 sm:px-10">
              <button onClick={() => setShowInventoryDeleteModal(null)} className="px-8 py-4 rounded-2xl border border-border bg-card font-bold text-muted-foreground hover:bg-muted transition-all">Cancel</button>
              <button
                onClick={handleConfirmInventoryDelete}
                disabled={!deleteReason.trim()}
                className="px-12 py-4 rounded-2xl bg-destructive text-destructive-foreground font-black text-lg shadow-xl shadow-destructive/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
              >
                Confirm Deletion
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
          <div className="mx-2 w-full max-w-md rounded-[2rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 sm:mx-auto">
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
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Catalog Number</label>
                {reorderCatalogFromItem ? (
                  <input
                    value={reorderCatalogFromItem}
                    readOnly
                    className="w-full h-12 border border-input bg-muted/40 rounded-xl px-4 font-mono text-sm text-muted-foreground cursor-not-allowed"
                  />
                ) : (
                  <input
                    value={reorderCatalogNumber}
                    onChange={(e) => setReorderCatalogNumber(e.target.value)}
                    placeholder="Enter catalog number (optional)"
                    className="w-full h-12 border border-input bg-background rounded-xl px-4 font-mono text-sm outline-none focus:ring-4 focus:ring-primary/10"
                  />
                )}
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
