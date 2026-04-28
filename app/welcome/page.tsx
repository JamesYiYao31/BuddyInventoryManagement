"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, Loader2, Copy, Check } from "lucide-react"
import { supabase } from "@/lib/supabase"

type WelcomeSettings = {
  lab_timezone: string
  expiring_soon_days: number
  urgent_days: number
  low_stock_threshold: number
  requires_coa_approval: boolean
}

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Phoenix", label: "Arizona Time (Phoenix)" },
  { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
]

function WelcomeContent() {
  const router = useRouter()

  const [bootLoading, setBootLoading] = useState(true)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [labId, setLabId] = useState("")
  const [fullName, setFullName] = useState("")
  const [labName, setLabName] = useState("")
  const [techKey, setTechKey] = useState("")

  const [timezone, setTimezone] = useState("America/Chicago")
  const [expiringSoonDays, setExpiringSoonDays] = useState("30")
  const [urgentDays, setUrgentDays] = useState("7")
  const [lowStockThreshold, setLowStockThreshold] = useState("5")
  const [requiresCoaApproval, setRequiresCoaApproval] = useState(false)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setBootLoading(true)
      setErrorMessage(null)

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.replace("/")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name, lab_id")
        .eq("id", session.user.id)
        .single()

      if (!profile?.role || profile.role !== "manager") {
        router.replace("/dashboard")
        return
      }

      if (!profile.lab_id) {
        router.replace("/dashboard")
        return
      }

      const scopedLabId = profile.lab_id as string

      const { data: onboardingSettings } = await supabase
        .from("lab_settings")
        .select("onboarding_complete")
        .eq("lab_id", scopedLabId)
        .maybeSingle()

      if (onboardingSettings?.onboarding_complete) {
        router.replace("/dashboard")
        return
      }

      const { data: lab } = await supabase
        .from("labs")
        .select("name, tech_key")
        .eq("id", scopedLabId)
        .single()

      const { data: settings } = await supabase
        .from("lab_settings")
        .select("lab_timezone, expiring_soon_days, urgent_days, low_stock_threshold, requires_coa_approval")
        .eq("lab_id", scopedLabId)
        .maybeSingle()

      if (cancelled) return

      setLabId(scopedLabId)
      setFullName(profile.full_name || session.user.user_metadata?.full_name || "Manager")
      setLabName(lab?.name || "My Lab")
      setTechKey(lab?.tech_key || "")

      const fallbackSettings: WelcomeSettings = {
        lab_timezone: "America/Chicago",
        expiring_soon_days: 30,
        urgent_days: 7,
        low_stock_threshold: 5,
        requires_coa_approval: false,
      }
      const resolved = {
        ...fallbackSettings,
        ...(settings || {}),
      }

      setTimezone(resolved.lab_timezone)
      setExpiringSoonDays(String(resolved.expiring_soon_days))
      setUrgentDays(String(resolved.urgent_days))
      setLowStockThreshold(String(resolved.low_stock_threshold))
      setRequiresCoaApproval(Boolean(resolved.requires_coa_approval))
      setBootLoading(false)
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleCopyTechKey = async () => {
    if (!techKey) return
    await navigator.clipboard.writeText(techKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleFinishSetup = async () => {
    if (!labId) return
    setSaving(true)
    setErrorMessage(null)

    const expSoon = Number.parseInt(expiringSoonDays, 10)
    const urg = Number.parseInt(urgentDays, 10)
    const low = Number.parseInt(lowStockThreshold, 10)

    if (!Number.isFinite(expSoon) || expSoon < 1) {
      setErrorMessage("Expiring Soon Days must be at least 1.")
      setSaving(false)
      return
    }
    if (!Number.isFinite(urg) || urg < 1) {
      setErrorMessage("Urgent Days must be at least 1.")
      setSaving(false)
      return
    }
    if (!Number.isFinite(low) || low < 0) {
      setErrorMessage("Low Stock Threshold must be 0 or higher.")
      setSaving(false)
      return
    }

    await supabase.from("lab_settings").upsert(
      {
        lab_id: labId,
        lab_timezone: timezone,
        expiring_soon_days: expSoon,
        urgent_days: urg,
        low_stock_threshold: low,
        requires_coa_approval: requiresCoaApproval,
        onboarding_complete: true,
      },
      { onConflict: "lab_id" }
    )

    setSaving(false)
    router.replace("/dashboard")
  }

  if (bootLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Loading welcome setup...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-lg px-6 py-6 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <FlaskConical className="size-6 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Welcome Setup</h1>
            <p className="text-xs text-muted-foreground">Complete your lab onboarding in 3 steps.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-10 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Step {step} of 3</p>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={`h-2.5 w-2.5 rounded-full ${dot <= step ? "bg-primary" : "bg-muted"}`}
                aria-hidden
              />
            ))}
          </div>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3"
          >
            {errorMessage}
          </p>
        ) : null}

        {step === 1 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight text-foreground">
                Welcome to Buddy Inventory Management, {fullName}!
              </h2>
              <p className="text-sm text-muted-foreground">
                Let&apos;s get your lab set up. This will take about 2 minutes.
              </p>
              <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                {labName}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 inline-flex items-center justify-center"
            >
              Get Started →
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-foreground">Your Lab Access Keys</h2>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Technician Key
              </label>
              <div className="flex items-center gap-2">
                <div className="w-full h-12 border border-input bg-muted rounded-xl px-4 text-sm font-medium inline-flex items-center">
                  {techKey || "Unavailable"}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyTechKey()}
                  className="h-12 rounded-xl border border-input bg-background px-4 text-sm font-bold hover:bg-muted transition-all inline-flex items-center gap-2"
                  aria-label="Copy technician key"
                >
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this code with your team. Technicians use it to join your lab.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep(3)}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 inline-flex items-center justify-center"
            >
              Got it →
            </button>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-foreground">Configure Your Lab</h2>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Expiring Soon Days
              </label>
              <input
                type="number"
                min={1}
                value={expiringSoonDays}
                onChange={(e) => setExpiringSoonDays(e.target.value)}
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Urgent Days</label>
              <input
                type="number"
                min={1}
                value={urgentDays}
                onChange={(e) => setUrgentDays(e.target.value)}
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Low Stock Threshold
              </label>
              <input
                type="number"
                min={0}
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
              <input
                type="checkbox"
                checked={requiresCoaApproval}
                onChange={(e) => setRequiresCoaApproval(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span className="text-sm font-medium text-foreground">Require COA Approval</span>
            </label>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleFinishSetup()}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Finish Setup
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

function WelcomeFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading...</p>
    </div>
  )
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<WelcomeFallback />}>
      <WelcomeContent />
    </Suspense>
  )
}
