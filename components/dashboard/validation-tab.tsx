"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  FileText,
  Search,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  approveLot,
  archiveLotToHistory,
  rejectLot,
  resolveCurrentUserLabId,
  ValidationQueueEntry,
  ValidationStatus,
} from "@/lib/inventory-utils"
import { useToast } from "@/hooks/use-toast"

interface ValidationTabProps {
  userRole: "manager" | "technician"
  refreshData: () => Promise<void> | void
}

const COA_DOCUMENTS_BUCKET = "coa-documents"

/** Derive `{lab_id}/{lot_id}/{timestamp}_{filename}` from a stored signed URL, if possible. */
function extractCoaDocumentsStoragePath(fileUrl: string | null | undefined): string | null {
  if (!fileUrl?.trim()) return null
  const raw = fileUrl.trim()
  if (!/^https?:\/\//i.test(raw) && raw.includes("/")) {
    return raw.replace(/^\/+/, "")
  }
  try {
    const parsed = new URL(raw)
    const signMarker = `/object/sign/${COA_DOCUMENTS_BUCKET}/`
    const authMarker = `/object/authenticated/${COA_DOCUMENTS_BUCKET}/`
    let idx = parsed.pathname.indexOf(signMarker)
    if (idx !== -1) {
      return decodeURIComponent(parsed.pathname.slice(idx + signMarker.length))
    }
    idx = parsed.pathname.indexOf(authMarker)
    if (idx !== -1) {
      return decodeURIComponent(parsed.pathname.slice(idx + authMarker.length))
    }
  } catch {
    return null
  }
  return null
}

async function resolveCoaDocumentsStoragePath(
  labId: string,
  lotId: string,
  fileUrl: string | null | undefined,
  fileName: string | null | undefined
): Promise<string | null> {
  const extracted = extractCoaDocumentsStoragePath(fileUrl)
  if (extracted) return extracted
  if (!fileName) return null
  const folder = `${labId}/${lotId}`
  const { data: list, error } = await supabase.storage.from(COA_DOCUMENTS_BUCKET).list(folder, { limit: 100 })
  if (error || !list?.length) return null
  const suffix = `_${fileName}`
  const found = list.find(
    f => f.name === fileName || f.name.endsWith(suffix) || f.name.includes(fileName)
  )
  return found ? `${folder}/${found.name}` : null
}

interface ArchivedLotEntry {
  lotId: string
  itemName: string
  lotNumber: string
  validationArchivedAt: string | null
  coaFileUrl: string | null
  coaFileName: string | null
  validationFileUrl: string | null
  validationFileName: string | null
}

interface QueueReviewDetails {
  submittedTypes: "COA" | "Lot Validation" | "Both" | "Unknown"
  submittedBy: string
  submittedAt: string
  coa?: {
    fileUrl?: string
    result?: string
  }
  validation?: {
    previousLot?: string
    result?: string
    fileUrl?: string
    rejectionReason?: string
  }
}

function ValidationBadge({ status }: { status: ValidationStatus }) {
  const map: Record<string, { label: string; color: string }> = {
    "pending_coa": { label: "Pending COA", color: "bg-yellow-500/10 text-yellow-600" },
    "pending_validation": { label: "Pending Validation", color: "bg-orange-500/10 text-orange-600" },
    "pending_approval": { label: "Pending Approval", color: "bg-blue-500/10 text-blue-600" },
    "approved": { label: "Approved", color: "bg-green-500/10 text-green-600" },
    "rejected": { label: "Rejected", color: "bg-red-500/10 text-red-600" },
  }
  const s = map[status]
  if (!s) return null
  return <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${s.color}`}>{s.label}</span>
}

export default function ValidationTab({ userRole, refreshData }: ValidationTabProps) {
  const { toast } = useToast()
  const [queue, setQueue] = useState<ValidationQueueEntry[]>([])
  const [queueDetails, setQueueDetails] = useState<Record<string, QueueReviewDetails>>({})
  const [loading, setLoading] = useState(false)
  const [archivedLots, setArchivedLots] = useState<ArchivedLotEntry[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [historySearch, setHistorySearch] = useState("")
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState("")
  const [openingFileKey, setOpeningFileKey] = useState<string | null>(null)

  // Reject Modal
  const [showRejectModal, setShowRejectModal] = useState<ValidationQueueEntry | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectSaving, setRejectSaving] = useState(false)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setQueue([])
      setQueueDetails({})
      setLoading(false)
      return
    }

    const { data: queueRows, error: queueError } = await supabase
      .from("inventory_lots")
      .select("id, item_id, lot_number, expiry_date, received_date, validation_status, items(name)")
      .eq("lab_id", labId)
      .in("validation_status", ["pending_approval", "approved", "rejected"])
      .order("received_date", { ascending: false })

    if (queueError) {
      console.error("[ValidationTab] Queue fetch failed:", queueError)
      setQueue([])
      setQueueDetails({})
      setLoading(false)
      return
    }

    const data: ValidationQueueEntry[] = (queueRows || []).map((row: any) => ({
      lotId: row.id,
      itemId: row.item_id,
      itemName: row.items?.name || "Unknown",
      lotNumber: row.lot_number,
      expiryDate: row.expiry_date,
      receivedDate: row.received_date,
      validationStatus: row.validation_status as ValidationStatus,
      has_coa_record: false,
      has_validation_record: false,
      requires_coa: false,
      requires_lot_validation: false,
    }))

    setQueue(data)
    const details: Record<string, QueueReviewDetails> = {}
    if (labId && data.length > 0) {
      const lotIds = data.map(d => d.lotId)
      const [{ data: coaRows }, { data: validationRows }] = await Promise.all([
        supabase
          .from("coa_records")
          .select("lot_id, file_url, result, uploaded_by, uploaded_at")
          .eq("lab_id", labId)
          .in("lot_id", lotIds)
          .order("uploaded_at", { ascending: false }),
        supabase
          .from("lot_validation_records")
          .select("lot_id, previous_lot_number, result, file_url, rejection_reason, submitted_by, submitted_at")
          .eq("lab_id", labId)
          .in("lot_id", lotIds)
          .order("submitted_at", { ascending: false }),
      ])

      const latestCoaByLot: Record<string, any> = {}
      const latestValidationByLot: Record<string, any> = {}
      for (const row of coaRows || []) if (!latestCoaByLot[row.lot_id]) latestCoaByLot[row.lot_id] = row
      for (const row of validationRows || []) if (!latestValidationByLot[row.lot_id]) latestValidationByLot[row.lot_id] = row

      for (const entry of data) {
        const coa = latestCoaByLot[entry.lotId]
        const validation = latestValidationByLot[entry.lotId]
        const hasCoa = Boolean(coa)
        const hasValidation = Boolean(validation)
        const submittedTypes: QueueReviewDetails["submittedTypes"] = hasCoa && hasValidation
          ? "Both"
          : hasCoa
            ? "COA"
            : hasValidation
              ? "Lot Validation"
              : "Unknown"
        const submittedBy = coa?.uploaded_by || validation?.submitted_by || "—"
        const submittedAt = coa?.uploaded_at || validation?.submitted_at || ""
        details[entry.lotId] = {
          submittedTypes,
          submittedBy,
          submittedAt,
          coa: hasCoa ? { fileUrl: coa.file_url, result: coa.result } : undefined,
          validation: hasValidation
            ? {
                previousLot: validation.previous_lot_number,
                result: validation.result,
                fileUrl: validation.file_url,
                rejectionReason: validation.rejection_reason,
              }
            : undefined,
        }
      }
    }
    setQueueDetails(details)
    setLoading(false)
  }, [])

  const loadArchivedLots = useCallback(async () => {
    setArchivedLoading(true)
    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setArchivedLots([])
      setArchivedLoading(false)
      return
    }

    const { data: rows, error } = await supabase
      .from("inventory_lots")
      .select("id, lot_number, validation_archived_at, items(name)")
      .eq("lab_id", labId)
      .eq("validation_status", "archived")
      .order("validation_archived_at", { ascending: false })
      .limit(500)

    if (error) {
      console.error("[ValidationTab] Archived lots fetch failed:", error)
      setArchivedLots([])
      setArchivedLoading(false)
      return
    }

    const list = rows || []
    const lotIds = list.map((r: { id: string }) => r.id)
    const latestCoaByLot: Record<string, { file_url: string | null; file_name: string | null }> = {}
    const latestValByLot: Record<string, { file_url: string | null; file_name: string | null }> = {}

    if (lotIds.length > 0) {
      const [{ data: coaRows }, { data: validationRows }] = await Promise.all([
        supabase
          .from("coa_records")
          .select("lot_id, file_url, file_name, uploaded_at")
          .eq("lab_id", labId)
          .in("lot_id", lotIds)
          .order("uploaded_at", { ascending: false }),
        supabase
          .from("lot_validation_records")
          .select("lot_id, file_url, file_name, submitted_at")
          .eq("lab_id", labId)
          .in("lot_id", lotIds)
          .order("submitted_at", { ascending: false }),
      ])
      for (const row of coaRows || []) {
        if (!latestCoaByLot[row.lot_id]) {
          latestCoaByLot[row.lot_id] = { file_url: row.file_url, file_name: row.file_name }
        }
      }
      for (const row of validationRows || []) {
        if (!latestValByLot[row.lot_id]) {
          latestValByLot[row.lot_id] = { file_url: row.file_url, file_name: row.file_name }
        }
      }
    }

    setArchivedLots(
      list.map((row: any) => ({
        lotId: row.id,
        itemName: row.items?.name || "Unknown",
        lotNumber: row.lot_number,
        validationArchivedAt: row.validation_archived_at ?? null,
        coaFileUrl: latestCoaByLot[row.id]?.file_url ?? null,
        coaFileName: latestCoaByLot[row.id]?.file_name ?? null,
        validationFileUrl: latestValByLot[row.id]?.file_url ?? null,
        validationFileName: latestValByLot[row.id]?.file_name ?? null,
      }))
    )
    setArchivedLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedHistorySearch(historySearch.trim().toLowerCase()), 300)
    return () => clearTimeout(t)
  }, [historySearch])

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (userRole !== "manager") return
    loadArchivedLots()
  }, [userRole, loadArchivedLots])

  useEffect(() => {
    if (!showRejectModal) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRejectModal(null)
        setRejectReason("")
      }
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [showRejectModal])

  const filteredArchivedLots = useMemo(() => {
    const q = debouncedHistorySearch
    if (!q) return archivedLots
    return archivedLots.filter(
      e =>
        e.itemName.toLowerCase().includes(q) ||
        e.lotNumber.toLowerCase().includes(q)
    )
  }, [archivedLots, debouncedHistorySearch])

  const handleOpenArchivedStorageFile = async (entry: ArchivedLotEntry, kind: "coa" | "validation") => {
    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      toast({ variant: "destructive", title: "Error", description: "No lab context." })
      return
    }
    const key = `${entry.lotId}-${kind}`
    setOpeningFileKey(key)
    const fileUrl = kind === "coa" ? entry.coaFileUrl : entry.validationFileUrl
    const fileName = kind === "coa" ? entry.coaFileName : entry.validationFileName
    const path = await resolveCoaDocumentsStoragePath(labId, entry.lotId, fileUrl, fileName)
    if (!path) {
      setOpeningFileKey(null)
      toast({
        variant: "destructive",
        title: "File not found",
        description: "Could not locate this document in storage.",
      })
      return
    }
    const { data, error } = await supabase.storage
      .from(COA_DOCUMENTS_BUCKET)
      .createSignedUrl(path, 3600)
    setOpeningFileKey(null)
    if (error || !data?.signedUrl) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Could not create a secure link to open this file.",
      })
      return
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  const handleApprove = async (entry: ValidationQueueEntry) => {
    const result = await approveLot(entry.lotId)
    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: result.error || "Failed to approve." })
      return
    }
    toast({ title: "Approved", description: `Lot ${entry.lotNumber} approved for use.` })
    await loadQueue()
    await refreshData()
  }

  const handleRejectSubmit = async () => {
    if (!showRejectModal || !rejectReason.trim()) return
    setRejectSaving(true)

    const result = await rejectLot(showRejectModal.lotId, rejectReason)
    setRejectSaving(false)

    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: "Failed to reject lot." })
      return
    }

    toast({ title: "Rejected", description: `Lot ${showRejectModal.lotNumber} has been rejected.` })
    setShowRejectModal(null)
    setRejectReason("")
    await loadQueue()
    await refreshData()
  }

  const handleArchive = async (entry: ValidationQueueEntry) => {
    const result = await archiveLotToHistory(entry.lotId)
    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: result.error || "Failed to move lot to history." })
      return
    }
    toast({ title: "Archived", description: `Lot ${entry.lotNumber} moved to history.` })
    await loadQueue()
    await loadArchivedLots()
    await refreshData()
  }

  return (
    <div className="space-y-6">
      {userRole !== "manager" && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
          Validation review is manager only.
        </div>
      )}
      {userRole === "manager" && (
        <>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10"><ShieldCheck className="size-6 text-primary" /></div>
        <h1 className="text-2xl font-bold text-foreground">Validation &amp; COA</h1>
      </div>

      {/* ── PENDING QUEUE ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground tracking-tight">Pending queue</h2>
            <p className="text-xs text-muted-foreground font-medium mt-0.5 max-w-xl">
              Review COA and lot validation submissions. Approve or reject, then move completed lots to history.
            </p>
          </div>
          {queue.length > 0 && (
            <span className="shrink-0 inline-flex items-center rounded-full bg-primary/10 text-primary text-xs font-bold px-3 py-1">
              {queue.length} in queue
            </span>
          )}
        </div>
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center p-16">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          ) : queue.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-16 text-center shadow-sm">
              <CheckCircle2 className="size-12 text-green-500 mx-auto mb-4 opacity-40" />
              <p className="text-muted-foreground font-semibold">No lots pending validation.</p>
              <p className="text-xs text-muted-foreground mt-1">All lots are cleared or not required.</p>
            </div>
          ) : (
            queue.map(entry => {
              const detail = queueDetails[entry.lotId]
              return (
              <div key={entry.lotId} className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="space-y-0.5">
                    <p className="font-bold text-lg text-foreground">{entry.itemName}</p>
                    <p className="text-sm font-mono text-primary">Lot: {entry.lotNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      Submitted: {detail?.submittedBy || "—"} {detail?.submittedAt ? `· ${new Date(detail.submittedAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <ValidationBadge status={entry.validationStatus} />
                </div>

                <div className="text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">Submitted:</span> {detail?.submittedTypes || "Unknown"}
                </div>

                {detail?.coa && (
                  <div className="rounded-xl border border-border p-3 bg-muted/20 text-sm space-y-1">
                    <p className="font-bold text-foreground">COA</p>
                    <p className="text-muted-foreground">Result: {detail.coa.result || "—"}</p>
                    {detail.coa.fileUrl && (
                      <a href={detail.coa.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-bold hover:underline">
                        Open COA File
                      </a>
                    )}
                  </div>
                )}

                {detail?.validation && (
                  <div className="rounded-xl border border-border p-3 bg-muted/20 text-sm space-y-1">
                    <p className="font-bold text-foreground">Lot Validation</p>
                    <p className="text-muted-foreground">Previous Lot: {detail.validation.previousLot || "—"}</p>
                    <p className="text-muted-foreground">Result: {detail.validation.result || "—"}</p>
                    {detail.validation.fileUrl ? (
                      <a href={detail.validation.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-bold hover:underline">
                        Open Validation File
                      </a>
                    ) : (
                      <p className="text-muted-foreground">No file uploaded</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {entry.validationStatus === "pending_approval" && (
                    <>
                      <button
                        onClick={() => handleApprove(entry)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-500/10 text-green-700 font-bold text-sm hover:bg-green-500/20 transition-all border border-green-500/20"
                      >
                        <CheckCircle2 className="size-4" /> Approve
                      </button>
                      <button
                        onClick={() => { setShowRejectModal(entry); setRejectReason("") }}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/10 text-red-700 font-bold text-sm hover:bg-red-500/20 transition-all border border-red-500/20"
                      >
                        <XCircle className="size-4" /> Reject
                      </button>
                    </>
                  )}
                  {entry.validationStatus === "approved" && (
                    <button
                      onClick={() => handleArchive(entry)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-muted text-foreground font-bold text-sm hover:bg-muted/80 transition-all border border-border"
                    >
                      Move to History
                    </button>
                  )}
                  {entry.validationStatus === "rejected" && (
                    <button
                      onClick={() => handleArchive(entry)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-muted text-foreground font-bold text-sm hover:bg-muted/80 transition-all border border-border"
                    >
                      Move to History
                    </button>
                  )}
                </div>
                {entry.validationStatus === "rejected" && detail?.validation?.rejectionReason && (
                  <p className="text-sm text-red-600 font-medium">Reason: {detail.validation.rejectionReason}</p>
                )}
              </div>
            )})
          )}
        </div>
      </section>

      {/* Section divider */}
      <div className="relative py-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            History
          </span>
        </div>
      </div>

      {/* ── ARCHIVED HISTORY (managers only; validation_status = archived) ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">Archived lots</h2>
          <p className="text-xs text-muted-foreground font-medium mt-1 max-w-2xl">
            Lots moved to history by a manager. Search by item name or lot number.
          </p>
        </div>

        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="Search by item name or lot number…"
            className="w-full h-11 pl-11 pr-4 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
            autoComplete="off"
          />
        </div>

        <p className="text-xs font-semibold text-muted-foreground">
          {filteredArchivedLots.length} archived lot{filteredArchivedLots.length === 1 ? "" : "s"}
          {debouncedHistorySearch ? " (filtered)" : ""}
        </p>

        {archivedLoading ? (
          <div className="flex items-center justify-center p-16 rounded-2xl border border-border bg-card">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        ) : archivedLots.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-16 text-center shadow-sm">
            <p className="text-muted-foreground font-semibold">No archived validation lots yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              When you move approved or rejected lots to history, they appear here.
            </p>
          </div>
        ) : filteredArchivedLots.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
            <p className="text-muted-foreground font-semibold">No lots match your search.</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different item name or lot number.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredArchivedLots.map(entry => {
              const archivedLabel = entry.validationArchivedAt
                ? new Date(entry.validationArchivedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "— (date not recorded)"
              const showCoaBtn = Boolean(entry.coaFileUrl || entry.coaFileName)
              const showValBtn = Boolean(entry.validationFileUrl || entry.validationFileName)
              return (
                <div
                  key={entry.lotId}
                  className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <p className="font-bold text-lg text-foreground truncate">{entry.itemName}</p>
                      <p className="text-sm font-mono text-primary">Lot: {entry.lotNumber}</p>
                      <p className="text-sm text-foreground pt-1">
                        <span className="font-bold text-muted-foreground">Archived on</span>{" "}
                        <span className="font-semibold tabular-nums">{archivedLabel}</span>
                      </p>
                      <p className="text-xs text-muted-foreground italic pt-1">
                        Records retained for 3 years from archived date.
                      </p>
                    </div>
                  </div>

                  {(showCoaBtn || showValBtn) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {showCoaBtn && (
                        <button
                          type="button"
                          onClick={() => handleOpenArchivedStorageFile(entry, "coa")}
                          disabled={openingFileKey === `${entry.lotId}-coa`}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-muted/30 text-sm font-bold text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                        >
                          {openingFileKey === `${entry.lotId}-coa` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <FileText className="size-4 text-primary" />
                          )}
                          Open COA file
                        </button>
                      )}
                      {showValBtn && (
                        <button
                          type="button"
                          onClick={() => handleOpenArchivedStorageFile(entry, "validation")}
                          disabled={openingFileKey === `${entry.lotId}-validation`}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-muted/30 text-sm font-bold text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                        >
                          {openingFileKey === `${entry.lotId}-validation` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <FileText className="size-4 text-primary" />
                          )}
                          Open Lot Validation file
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      </>
      )}

      {/* ══════════════════════════════════════════════
          REJECT MODAL (manager only)
         ══════════════════════════════════════════════ */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-lg rounded-[2.5rem] border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="flex justify-between items-center px-8 py-6 border-b border-border bg-destructive/5">
              <div className="flex items-center gap-3 font-bold text-lg text-destructive">
                <XCircle className="size-5" /> Reject Lot
              </div>
              <button onClick={() => { setShowRejectModal(null); setRejectReason("") }} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="size-5" /></button>
            </div>
            <div className="p-8 space-y-5">
              <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
                <p className="font-bold text-foreground">{showRejectModal.itemName}</p>
                <p className="text-sm font-mono text-muted-foreground">Lot: {showRejectModal.lotNumber}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">
                  Rejection Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this lot is being rejected…"
                  autoFocus
                  className="w-full border border-input bg-background rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-destructive/20 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-4 px-8 py-6 border-t border-border bg-muted/20">
              <button onClick={() => { setShowRejectModal(null); setRejectReason("") }} className="px-6 py-3 rounded-xl border border-border bg-card font-bold text-sm text-muted-foreground hover:bg-muted">Cancel</button>
              <button
                onClick={handleRejectSubmit}
                disabled={!rejectReason.trim() || rejectSaving}
                className="px-8 py-3 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm shadow-md hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
              >
                {rejectSaving && <Loader2 className="size-4 animate-spin" />}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
