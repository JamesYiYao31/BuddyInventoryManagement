"use client"

import { useState, useEffect, useCallback } from "react"
import { Settings, Save, Loader2, ShieldAlert, Package, Clock, AlertTriangle, LayoutDashboard, Users, ShieldCheck, User as UserIcon, Shield, KeyRound, Pencil } from "lucide-react"
import {
  LabSettings, TechDashboardWidget, fetchLabSettings, updateLabSettings,
  LabProfile, fetchLabProfiles, updateUserRole, resolveCurrentUserLabId,
} from "@/lib/inventory-utils"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { TIMEZONES } from "@/lib/timezones"

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
  const [timezoneSaving, setTimezoneSaving] = useState(false)
  const [timezoneSaved, setTimezoneSaved] = useState(false)
  const [labId, setLabId] = useState<string | null>(null)
  const [currentTechKey, setCurrentTechKey] = useState("")
  const [techKeyInput, setTechKeyInput] = useState("")
  const [techKeyEditing, setTechKeyEditing] = useState(false)
  const [techKeySaving, setTechKeySaving] = useState(false)
  const [techKeyError, setTechKeyError] = useState<string | null>(null)
  const [techKeySaved, setTechKeySaved] = useState(false)

  // ── TEAM MANAGEMENT STATE ──
  const [profiles, setProfiles] = useState<LabProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true)
    const list = await fetchLabProfiles()
    setProfiles(list)
    setProfilesLoading(false)
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const fresh = await fetchLabSettings()
      setForm(fresh)
      const scopedLabId = await resolveCurrentUserLabId()
      setLabId(scopedLabId)
      if (scopedLabId) {
        const { data: lab } = await supabase.from("labs").select("tech_key").eq("id", scopedLabId).maybeSingle()
        const nextTechKey = lab?.tech_key || ""
        setCurrentTechKey(nextTechKey)
        setTechKeyInput(nextTechKey)
      }
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (userRole === "manager") loadProfiles()
  }, [userRole, loadProfiles])

  const handleRoleChange = async (userId: string, newRole: "manager" | "technician") => {
    if (userRole !== "manager") return
    const target = profiles.find(p => p.id === userId)
    if (target && target.role === newRole) return

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user?.id === userId) {
      toast({
        variant: "destructive",
        title: "Cannot change role",
        description: "You cannot change your own role.",
      })
      return
    }
    if (target?.isOwner) {
      toast({
        variant: "destructive",
        title: "Cannot change role",
        description: "The lab owner's role cannot be changed.",
      })
      return
    }

    setUpdatingUserId(userId)
    const result = await updateUserRole(userId, newRole)
    setUpdatingUserId(null)

    if (result.success) {
      toast({
        title: "Role updated",
        description: `${target?.fullName || "User"} is now a ${newRole === "manager" ? "Manager" : "Technician"}.`,
      })
      await loadProfiles()
    } else {
      toast({
        variant: "destructive",
        title: "Could not update role",
        description: result.error || "Check permissions and try again.",
      })
    }
  }

  const isDirty =
    form.lowStockThreshold !== labSettings.lowStockThreshold ||
    form.expiringSoonDays !== labSettings.expiringSoonDays ||
    form.urgentDays !== labSettings.urgentDays ||
    form.techDashboardWidget !== labSettings.techDashboardWidget ||
    (form.techsCanEditThresholds ?? true) !== (labSettings.techsCanEditThresholds ?? true)

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

  const handleTimezoneChange = async (nextTimezone: string) => {
    setForm((prev) => ({ ...prev, labTimezone: nextTimezone }))
    setTimezoneSaving(true)
    setTimezoneSaved(false)

    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setTimezoneSaving(false)
      return
    }

    await supabase
      .from("lab_settings")
      .upsert(
        {
          lab_id: labId,
          lab_timezone: nextTimezone,
        },
        { onConflict: "lab_id" }
      )

    setTimezoneSaving(false)
    setTimezoneSaved(true)
    setTimeout(() => setTimezoneSaved(false), 2000)
    await refreshData()
  }

  const validateTechKey = (value: string): string | null => {
    if (/\s/.test(value)) {
      return "Key cannot contain spaces"
    }
    if (value.length < 6) {
      return "Key must be at least 6 characters"
    }
    return null
  }

  const handleSaveTechKey = async () => {
    const resolvedLabId = await resolveCurrentUserLabId()
    if (!resolvedLabId) {
      setTechKeyError("Could not resolve your lab. Please refresh and try again.")
      return
    }

    const scopedTechKey = techKeyInput
    const validationError = validateTechKey(scopedTechKey)
    if (validationError) {
      setTechKeyError(validationError)
      return
    }

    setTechKeySaving(true)
    setTechKeyError(null)
    setTechKeySaved(false)

    const { error } = await supabase
      .from("labs")
      .update({ tech_key: scopedTechKey })
      .eq("id", resolvedLabId)

    setTechKeySaving(false)

    if (error) {
      if (error.code === "23505") {
        setTechKeyError("This key is already taken — try another")
        return
      }
      setTechKeyError(error.message || "Could not save tech key.")
      return
    }

    setCurrentTechKey(scopedTechKey)
    setTechKeyInput(scopedTechKey)
    setTechKeyEditing(false)
    setTechKeySaved(true)
    toast({ title: "Tech key saved", description: "Your technician key has been updated." })
    setTimeout(() => setTechKeySaved(false), 2000)
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
    <div className="flex w-full flex-col gap-8 overflow-x-hidden">
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
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-4">
          {/* ── Tech Key ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10"><KeyRound className="size-5 text-primary" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Tech Key</p>
                <p className="text-xs text-muted-foreground">Technicians use this key to join your lab.</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Technician Key</label>
              {techKeyEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={techKeyInput}
                    onChange={(e) => {
                      setTechKeyInput(e.target.value)
                      setTechKeyError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !techKeySaving) {
                        e.preventDefault()
                        void handleSaveTechKey()
                      }
                    }}
                    className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                    placeholder="Enter technician key"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {techKeyError ? <p className="text-xs text-destructive ml-1">{techKeyError}</p> : null}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={techKeySaving}
                      onClick={() => void handleSaveTechKey()}
                      className="h-10 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {techKeySaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={techKeySaving}
                      onClick={() => {
                        setTechKeyInput(currentTechKey)
                        setTechKeyError(null)
                        setTechKeyEditing(false)
                      }}
                      className="h-10 rounded-xl border border-input px-4 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-full h-14 border border-input bg-muted rounded-2xl px-6 text-base font-semibold inline-flex items-center">
                    {currentTechKey || "Unavailable"}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTechKeyInput(currentTechKey)
                      setTechKeyError(null)
                      setTechKeyEditing(true)
                    }}
                    className="h-10 rounded-xl border border-input bg-background px-4 text-xs font-bold hover:bg-muted inline-flex items-center gap-2"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </button>
                </div>
              )}
              <div className="h-4">
                {!techKeyError && techKeySaved ? <p className="text-xs text-green-600 ml-1">Saved</p> : null}
              </div>
            </div>
          </div>

          {/* ── Lab Timezone ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10"><Clock className="size-5 text-primary" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Lab Timezone</p>
                <p className="text-xs text-muted-foreground">All expiry dates and timestamps are displayed in this timezone.</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Timezone</label>
              <select
                value={form.labTimezone}
                onChange={e => void handleTimezoneChange(e.target.value)}
                className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
                {!TIMEZONES.some((tz) => tz.value === form.labTimezone) && (
                  <option value={form.labTimezone}>{form.labTimezone}</option>
                )}
              </select>
              <div className="h-4">
                {timezoneSaving && <p className="text-xs text-muted-foreground ml-1">Saving...</p>}
                {!timezoneSaving && timezoneSaved && <p className="text-xs text-green-600 ml-1">Saved</p>}
              </div>
            </div>
          </div>

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

          {/* ── Technician threshold editing (lab-wide) ── */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10"><Shield className="size-5 text-primary" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Technician Threshold Editing</p>
                <p className="text-xs text-muted-foreground">Control whether technicians can set and edit item thresholds</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">Allow technicians to set item thresholds</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.techsCanEditThresholds !== false}
                  onClick={() =>
                    setForm(f => ({ ...f, techsCanEditThresholds: !(f.techsCanEditThresholds !== false) }))
                  }
                  className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                    form.techsCanEditThresholds !== false ? "bg-primary" : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                      form.techsCanEditThresholds !== false ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {form.techsCanEditThresholds !== false
                  ? "Technicians can set expiring soon, urgent, low stock, and working expiry thresholds when adding or editing items."
                  : "Only managers can set item thresholds. Technicians will see the fields as read-only."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Dashboard Configuration ── */}
      {!loading && (
        <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10"><LayoutDashboard className="size-5 text-primary" /></div>
            <div>
              <p className="text-sm font-bold text-foreground">Dashboard Configuration</p>
              <p className="text-xs text-muted-foreground">Choose the analytics widget displayed on the main dashboard for all users</p>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Technician Dashboard Widget</label>
            <select
              value={form.techDashboardWidget}
              onChange={e => setForm({ ...form, techDashboardWidget: e.target.value as TechDashboardWidget })}
              className="w-full h-14 border border-input bg-background rounded-2xl px-6 text-base font-medium focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
            >
              <option value="donut">Global Health Donut</option>
              <option value="waste">Waste Metrics</option>
              <option value="expenses">Recent Expenses</option>
              <option value="none">None</option>
            </select>
            <p className="text-xs text-muted-foreground ml-1">
              This widget replaces the default dashboard panel for both Technicians and Managers.
            </p>
          </div>
        </div>
      )}

      {/* ── Team Management (Manager Only) ── */}
      {!loading && userRole === "manager" && (
        <div className="rounded-2xl border border-border bg-card p-8 space-y-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10"><Users className="size-5 text-primary" /></div>
              <div>
                <p className="text-sm font-bold text-foreground">Team Management</p>
                <p className="text-xs text-muted-foreground">
                  Assign Manager or Technician roles for every registered user in this lab. Email addresses are not stored on profiles; they are managed securely via authentication.
                </p>
              </div>
            </div>
            <button
              onClick={loadProfiles}
              disabled={profilesLoading}
              className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
            >
              {profilesLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="grid grid-cols-[2fr_1.3fr] px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Display Name</span>
              <span>Role</span>
            </div>

            {profilesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 text-muted-foreground animate-spin" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground italic">
                No registered users found.
              </div>
            ) : (
              profiles.map(p => (
                <div key={p.id} className="grid grid-cols-[2fr_1.3fr] items-center px-6 py-4 border-t border-border/50 text-sm hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`size-8 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0 ${
                      p.role === "manager"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground border border-border"
                    }`}>
                      {(p.fullName || "?").substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-foreground truncate">
                        {p.fullName || <span className="italic text-muted-foreground">No name set</span>}
                      </span>
                      {p.role === "manager" ? (
                        <ShieldCheck className="size-3.5 text-primary shrink-0" />
                      ) : (
                        <UserIcon className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={p.role}
                      onChange={e => handleRoleChange(p.id, e.target.value as "manager" | "technician")}
                      disabled={updatingUserId === p.id}
                      className={`h-9 border border-input bg-background rounded-lg px-3 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 transition-all disabled:opacity-50 ${
                        p.role === "manager" ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      <option value="technician">Technician</option>
                      <option value="manager">Manager</option>
                    </select>
                    {updatingUserId === p.id && <Loader2 className="size-3.5 text-muted-foreground animate-spin" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Preview & Save ── */}
      {!loading && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 sm:px-8 sm:py-4 rounded-2xl border border-border bg-muted/30">
          <div className="min-w-0 flex-1 flex items-center gap-6 text-sm">
            <p className="text-muted-foreground font-medium">Preview:</p>
            <div className="flex flex-wrap items-center gap-2">
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
            className="w-full sm:w-auto flex items-center gap-2 px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-90 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  )
}
