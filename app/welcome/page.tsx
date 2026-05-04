"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, Loader2, Copy, Check } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { TIMEZONES } from "@/lib/timezones"

type WelcomeSettings = {
  lab_timezone: string
  expiring_soon_days: number
  urgent_days: number
  low_stock_threshold: number
  requires_coa_approval: boolean
}

function WelcomeContent() {
  const router = useRouter()

  const [bootLoading, setBootLoading] = useState(true)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [techKeyError, setTechKeyError] = useState<string | null>(null)
  const [techKeySaving, setTechKeySaving] = useState(false)

  const [labId, setLabId] = useState("")
  const [fullName, setFullName] = useState("")
  const [labName, setLabName] = useState("")
  const [techKey, setTechKey] = useState("")

  const [timezone, setTimezone] = useState("America/Chicago")
  const [expiringSoonDays, setExpiringSoonDays] = useState("30")
  const [urgentDays, setUrgentDays] = useState("7")
  const [lowStockThreshold, setLowStockThreshold] = useState("5")
  const [requiresCoaApproval, setRequiresCoaApproval] = useState(false)
  const timezoneOptions = useMemo(() => {
    if (TIMEZONES.some((t) => t.value === timezone)) return TIMEZONES
    return [...TIMEZONES, { value: timezone, label: timezone }]
  }, [timezone])

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

  const validateTechKey = (value: string): string | null => {
    if (/\s/.test(value)) {
      return "Key cannot contain spaces"
    }
    if (value.length < 6) {
      return "Key must be at least 6 characters"
    }
    return null
  }

  const handleSaveTechKeyAndContinue = async () => {
    setTechKeySaving(true)
    setTechKeyError(null)
    setErrorMessage(null)

    const scopedTechKey = techKey
    const validationError = validateTechKey(scopedTechKey)
    if (validationError) {
      setTechKeyError(validationError)
      setTechKeySaving(false)
      return
    }

    const { error: updateError } = await supabase
      .from("labs")
      .update({ tech_key: scopedTechKey })
      .eq("id", labId)

    if (updateError) {
      if (updateError.code === "23505") {
        setTechKeyError("This key is already taken — try another")
      } else {
        setTechKeyError(updateError.message || "Could not save tech key. Please try again.")
      }
      setTechKeySaving(false)
      return
    }

    setTechKeySaving(false)
    setStep(3)
  }

  const handleFinishSetup = async () => {
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

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      setErrorMessage("Your session has expired. Please sign in again.")
      setSaving(false)
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("lab_id")
      .eq("id", session.user.id)
      .single()

    if (profileError || !profile?.lab_id) {
      setErrorMessage("Could not resolve your lab. Please try again.")
      setSaving(false)
      return
    }

    const { error: upsertError } = await supabase.from("lab_settings").upsert(
      {
        lab_id: profile.lab_id,
        lab_timezone: timezone,
        expiring_soon_days: expSoon,
        urgent_days: urg,
        low_stock_threshold: low,
        require_coa_approval: requiresCoaApproval,
        onboarding_complete: true,
      },
      { onConflict: "lab_id" }
    )

    if (upsertError) {
      setErrorMessage(upsertError.message || "Could not save setup. Please try again.")
      setSaving(false)
      return
    }

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
                <input
                  type="text"
                  value={techKey}
                  onChange={(e) => {
                    setTechKey(e.target.value)
                    setTechKeyError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !techKeySaving) {
                      e.preventDefault()
                      void handleSaveTechKeyAndContinue()
                    }
                  }}
                  className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter technician key"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
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
              <p className="text-sm text-muted-foreground">
                We recommend changing this to something memorable for your team, like your lab name or a short code they can easily type.
              </p>
              {techKeyError ? (
                <p className="text-xs text-destructive ml-1" role="alert">
                  {techKeyError}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Share this code with your team. Technicians use it to join your lab.
              </p>
            </div>

            <button
              type="button"
              disabled={techKeySaving}
              onClick={() => void handleSaveTechKeyAndContinue()}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {techKeySaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
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
                {timezoneOptions.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
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
              <p className="text-xs text-muted-foreground leading-relaxed">
                Lots expiring within this many days will be flagged as expiring soon and shown in yellow on your dashboard.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Urgent Days</label>
              <input
                type="number"
                min={1}
                value={urgentDays}
                onChange={(e) => setUrgentDays(e.target.value)}
                className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Lots expiring within this many days will be flagged as urgent and shown in red. This should be a smaller number than Expiring Soon Days.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
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
              <p className="text-xs text-muted-foreground leading-relaxed">
                Lots with this many units or fewer will be flagged as low stock. Set to 0 to disable low stock warnings.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                <input
                  type="checkbox"
                  checked={requiresCoaApproval}
                  onChange={(e) => setRequiresCoaApproval(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span className="text-sm font-medium text-foreground">Require COA Approval</span>
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When enabled, technicians must wait for manager approval after uploading a Certificate of Analysis (COA) before a lot can be used on the bench. When disabled, COA uploads are auto-approved.
              </p>
            </div>

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
