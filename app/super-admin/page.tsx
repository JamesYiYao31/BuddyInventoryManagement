"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
  FlaskConical,
  Link2,
  Copy,
  Check,
  Archive,
  RotateCcw,
  Eye,
  Shield,
} from "lucide-react"
import { supabase } from "@/lib/supabase"

type LabRow = {
  id: string
  name: string
  created_at: string
  is_archived: boolean
  archived_at: string | null
}

type InviteRow = {
  id: string
  lab_name: string
  token: string
  used: boolean
  created_at: string
}

type InlineMsg = { kind: "success" | "error"; text: string } | null

function InlineAlert({ msg }: { msg: InlineMsg }) {
  if (!msg) return null
  const cls =
    msg.kind === "success"
      ? "text-green-700 dark:text-green-400 bg-green-500/10 border-green-500/20"
      : "text-destructive bg-destructive/10 border-destructive/20"
  return (
    <p role="status" className={`text-sm font-medium rounded-xl border px-4 py-3 ${cls}`}>
      {msg.text}
    </p>
  )
}

export default function SuperAdminPage() {
  const router = useRouter()

  const [gateLoading, setGateLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const [labNameInput, setLabNameInput] = useState("")
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateMsg, setGenerateMsg] = useState<InlineMsg>(null)

  const [labs, setLabs] = useState<LabRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [labsLoading, setLabsLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [labRowBusyId, setLabRowBusyId] = useState<string | null>(null)
  const [labsMsg, setLabsMsg] = useState<InlineMsg>(null)
  const [invitesTableMsg, setInvitesTableMsg] = useState<InlineMsg>(null)

  const fetchLabs = useCallback(async () => {
    setLabsLoading(true)
    const { data, error } = await supabase
      .from("labs")
      .select("id, name, created_at, is_archived, archived_at")
      .order("created_at", { ascending: false })

    setLabsLoading(false)
    if (error) {
      setLabsMsg({ kind: "error", text: `Could not load labs: ${error.message}` })
      setLabs([])
      return
    }
    setLabs((data as LabRow[]) || [])
  }, [])

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true)
    const { data, error } = await supabase
      .from("lab_invites")
      .select("id, lab_name, token, used, created_at")
      .order("created_at", { ascending: false })

    setInvitesLoading(false)
    if (error) {
      setInvitesTableMsg({ kind: "error", text: `Could not load invites: ${error.message}` })
      setInvites([])
      return
    }
    setInvitesTableMsg(null)
    setInvites((data as InviteRow[]) || [])
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setGateLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        if (!cancelled) router.replace("/")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profileError || profile?.role !== "super_admin") {
        router.replace("/dashboard")
        return
      }

      setAuthorized(true)
      setGateLoading(false)
      await Promise.all([fetchLabs(), fetchInvites()])
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, fetchLabs, fetchInvites])

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchLabs(), fetchInvites()])
  }, [fetchLabs, fetchInvites])

  const handleGenerateInvite = async () => {
    setGenerateMsg(null)
    setGeneratedUrl(null)
    setCopyDone(false)

    const name = labNameInput.trim()
    if (!name) {
      setGenerateMsg({ kind: "error", text: "Enter a lab name." })
      return
    }

    setGenerateBusy(true)
    const token = crypto.randomUUID()
    const { error } = await supabase.from("lab_invites").insert({
      token,
      lab_name: name,
      used: false,
    })
    setGenerateBusy(false)

    if (error) {
      setGenerateMsg({ kind: "error", text: error.message })
      return
    }

    const url = `${window.location.origin}/register-lab?token=${token}`
    setGeneratedUrl(url)
    setLabNameInput("")
    setGenerateMsg({ kind: "success", text: "Invite link created." })
    await refreshAll()
  }

  const handleCopyUrl = async () => {
    if (!generatedUrl) return
    try {
      await navigator.clipboard.writeText(generatedUrl)
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    } catch {
      setGenerateMsg({ kind: "error", text: "Could not copy to clipboard." })
    }
  }

  const handleArchiveLab = async (lab: LabRow) => {
    setLabsMsg(null)
    setLabRowBusyId(lab.id)
    const { error } = await supabase
      .from("labs")
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq("id", lab.id)
    setLabRowBusyId(null)

    if (error) {
      setLabsMsg({ kind: "error", text: error.message })
      return
    }
    setLabsMsg({ kind: "success", text: `Archived "${lab.name}".` })
    await refreshAll()
  }

  const handleRestoreLab = async (lab: LabRow) => {
    setLabsMsg(null)
    setLabRowBusyId(lab.id)
    const { error } = await supabase
      .from("labs")
      .update({ is_archived: false, archived_at: null })
      .eq("id", lab.id)
    setLabRowBusyId(null)

    if (error) {
      setLabsMsg({ kind: "error", text: error.message })
      return
    }
    setLabsMsg({ kind: "success", text: `Restored "${lab.name}".` })
    await refreshAll()
  }

  const handleViewLab = (lab: LabRow) => {
    console.log(lab.id)
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    } catch {
      return iso
    }
  }

  const shortenToken = (t: string) => (t.length <= 8 ? t : `${t.slice(0, 8)}...`)

  if (gateLoading || !authorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Verifying access...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Shield className="size-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight truncate">Super Admin</h1>
              <p className="text-xs text-muted-foreground truncate">Lab Inventory Management internal control panel</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="shrink-0 text-sm font-bold text-primary hover:underline"
          >
            Back to dashboard
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-12">
        {/* Section 1 — Generate invite */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Link2 className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">Generate invite link</h2>
              <p className="text-xs text-muted-foreground">Create a registration link for a new lab.</p>
            </div>
          </div>

          <InlineAlert msg={generateMsg} />

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 space-y-2">
              <label htmlFor="super-admin-lab-name" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Lab name
              </label>
              <input
                id="super-admin-lab-name"
                type="text"
                value={labNameInput}
                onChange={(e) => setLabNameInput(e.target.value)}
                placeholder="e.g. Acme Diagnostics Lab"
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="button"
              disabled={generateBusy}
              onClick={() => void handleGenerateInvite()}
              className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {generateBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Generate invite link
            </button>
          </div>

          {generatedUrl && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generated URL</p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <code className="flex-1 text-xs font-mono break-all text-foreground bg-background border border-border rounded-lg px-3 py-2">
                  {generatedUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyUrl()}
                  className="shrink-0 h-10 px-4 rounded-lg border border-border bg-background font-bold text-xs inline-flex items-center justify-center gap-2 hover:bg-muted/50"
                >
                  {copyDone ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                  {copyDone ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Section 2 — All labs */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <FlaskConical className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">All labs</h2>
              <p className="text-xs text-muted-foreground">Every tenant lab in the system.</p>
            </div>
          </div>

          <InlineAlert msg={labsMsg} />

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2 px-4 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Lab name</span>
              <span>Created</span>
              <span>Status</span>
              <span className="text-right sm:text-left">Actions</span>
            </div>

            {labsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
              </div>
            ) : labs.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">No labs yet.</div>
            ) : (
              labs.map((lab) => (
                <div
                  key={lab.id}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2 px-4 py-4 border-t border-border/60 text-sm items-center"
                >
                  <span className="font-bold truncate">{lab.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{formatDate(lab.created_at)}</span>
                  <span>
                    {lab.is_archived ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-700 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </span>
                  <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                    {!lab.is_archived ? (
                      <button
                        type="button"
                        disabled={labRowBusyId === lab.id}
                        onClick={() => void handleArchiveLab(lab)}
                        className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                        Archive
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={labRowBusyId === lab.id}
                        onClick={() => void handleRestoreLab(lab)}
                        className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleViewLab(lab)}
                      className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 inline-flex items-center gap-1.5"
                    >
                      <Eye className="size-3.5" />
                      View lab
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section 3 — Invite links */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Link2 className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">Invite links</h2>
              <p className="text-xs text-muted-foreground">All generated lab registration tokens.</p>
            </div>
          </div>

          <InlineAlert msg={invitesTableMsg} />

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] gap-2 px-4 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Lab name</span>
              <span>Token</span>
              <span>Status</span>
              <span>Created</span>
            </div>

            {invitesLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
              </div>
            ) : invites.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">No invite links yet.</div>
            ) : (
              invites.map((inv) => (
                <div
                  key={inv.id}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] gap-2 px-4 py-4 border-t border-border/60 text-sm items-center"
                >
                  <span className="font-bold truncate">{inv.lab_name}</span>
                  <code className="text-xs font-mono text-muted-foreground">{shortenToken(inv.token)}</code>
                  <span>
                    {inv.used ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                        Used
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-400">
                        Pending
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">{formatDate(inv.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
