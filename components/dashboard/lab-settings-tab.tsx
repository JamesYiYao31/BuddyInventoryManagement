"use client"

import { useState, useEffect } from "react"
import { Settings, Save, Loader2, ShieldAlert, Package, Clock, AlertTriangle } from "lucide-react"
import { LabSettings, fetchLabSettings, updateLabSettings } from "@/lib/inventory-utils"
import { useToast } from "@/hooks/use-toast"

interface LabSettingsTabProps {
  labSettings: LabSettings
  refreshData: () => Promise<void> | void
  userRole: "manager" | "technician"
}

export default function LabSettingsTab({ labSettings, refreshData, userRole }: LabSettingsTabProps) {
  const { toast } = useToast()

  const [form, setForm] = useState<LabSettings>({ ...labSettings })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const fresh = await fetchLabSettings()
      setForm(fresh)
      setLoading(false)
    }
    load()
  }, [])

  const isDirty =
    form.lowStockThreshold !== labSettings.lowStockThreshold ||
    form.expiringSoonDays !== labSettings.expiringSoonDays ||
    form.urgentDays !== labSettings.urgentDays

  const handleSave = async () => {
    if (userRole !== "manager") return
    if (form.lowStockThreshold < 0 || form.expiringSoonDays < 1 || form.urgentDays < 1) {
      return toast({ variant: "destructive", title: "Invalid values", description: "All thresholds must be positive numbers." })
    }
    if (form.urgentDays >= form.expiringSoonDays) {
      return toast({ variant: "destructive", title: "Invalid range", description: "Urgent days must be less than Expiring Soon days." })
    }

    setSaving(true)
    const result = await updateLabSettings(form)
    setSaving(false)

    if (result.success) {
      toast({ title: "Settings saved", description: "Lab alert thresholds have been updated." })
      await refreshData()
    } else {
      toast({ variant: "destructive", title: "Save failed", description: result.error || "Could not update lab settings." })
    }
  }

  if (userRole !== "manager") {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
        <ShieldAlert className="size-16 text-muted-foreground/20" />
        <p className="text-lg font-bold text-muted-foreground">Manager Access Required</p>
        <p className="text-sm text-muted-foreground max-w-sm">Only lab managers can view and modify alert thresholds. Contact your manager if changes are needed.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-primary/10"><Settings className="size-7 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Lab Settings</h1>
            <p className="text-sm text-muted-foreground">Configure inventory alert thresholds for this lab.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-20">
          <Loader2 className="size-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Low Stock Threshold ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-yellow-500/10"><Package className="size-5 text-yellow-600" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Low Stock Threshold</p>
                <p className="text-xs text-muted-foreground">Units at or below this count trigger a warning</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Threshold (units)</label>
              <input
                type="number"
                min={0}
                value={form.lowStockThreshold}
                onChange={e => setForm({ ...form, lowStockThreshold: Number(e.target.value) })}
                className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-2xl font-bold text-foreground focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              />
              <p className="text-xs text-muted-foreground ml-1">
                Lots with <span className="font-bold">&le; {form.lowStockThreshold}</span> units will show a <span className="font-bold text-yellow-600">Low Stock</span> badge.
              </p>
            </div>
          </div>

          {/* ── Expiring Soon Days ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-orange-500/10"><Clock className="size-5 text-orange-600" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Expiring Soon Warning</p>
                <p className="text-xs text-muted-foreground">Days before expiry to start warning</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Warning window (days)</label>
              <input
                type="number"
                min={1}
                value={form.expiringSoonDays}
                onChange={e => setForm({ ...form, expiringSoonDays: Number(e.target.value) })}
                className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-2xl font-bold text-foreground focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              />
              <p className="text-xs text-muted-foreground ml-1">
                Lots expiring within <span className="font-bold">{form.expiringSoonDays}</span> days will show an <span className="font-bold text-orange-600">Expiring Soon</span> badge.
              </p>
            </div>
          </div>

          {/* ── Urgent Days ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10"><AlertTriangle className="size-5 text-red-600" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Urgent Warning</p>
                <p className="text-xs text-muted-foreground">Days before expiry to escalate to urgent</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Urgent window (days)</label>
              <input
                type="number"
                min={1}
                value={form.urgentDays}
                onChange={e => setForm({ ...form, urgentDays: Number(e.target.value) })}
                className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-2xl font-bold text-foreground focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              />
              <p className="text-xs text-muted-foreground ml-1">
                Lots expiring within <span className="font-bold">{form.urgentDays}</span> days will show an <span className="font-bold text-red-600">Urgent</span> badge.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview & Save ── */}
      {!loading && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-8 py-6">
          <div className="flex items-center gap-6 text-sm">
            <p className="text-muted-foreground font-medium">Preview:</p>
            <div className="flex items-center gap-3">
              <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-600 dark:text-green-400">In Storage</span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">&le; {form.lowStockThreshold} units</span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-600 dark:text-orange-400">&le; {form.expiringSoonDays} days</span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-600 dark:text-red-400">&le; {form.urgentDays} days</span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-zinc-500/10 text-zinc-600 dark:text-zinc-400">Expired</span>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-90 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  )
}
