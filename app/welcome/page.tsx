"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, Loader2, Copy, Check, CheckCircle2, Shield } from "lucide-react"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { TIMEZONES } from "@/lib/timezones"
import { getMfaEnrollmentStatus, enrollTotp, verifyTotpEnrollment } from "@/lib/mfa"

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
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [techKeyError, setTechKeyError] = useState<string | null>(null)
  const [techKeySaving, setTechKeySaving] = useState(false)

  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaEnrollData, setMfaEnrollData] = useState<{ qrCodeUrl: string; secret: string; factorId: string } | null>(null)
  const [mfaLoadFailed, setMfaLoadFailed] = useState(false)
  const [mfaCode, setMfaCode] = useState("")
  const [mfaVerifying, setMfaVerifying] = useState(false)
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [mfaRetry, setMfaRetry] = useState(0)

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

  useEffect(() => {
    if (step !== 4) return
    let cancelled = false
    const loadMfa = async () => {
      setMfaLoading(true)
      setMfaLoadFailed(false)
      setMfaEnrollData(null)
      setMfaError(null)

      const { enrolled } = await getMfaEnrollmentStatus()
      if (cancelled) return
      if (enrolled) {
        setStep(5)
        return
      }

      const data = await enrollTotp()
      if (cancelled) return
      if (!data) {
        setMfaLoadFailed(true)
        setMfaLoading(false)
        return
      }
      setMfaEnrollData(data)
      setMfaLoading(false)
    }
    void loadMfa()
    return () => {
      cancelled = true
    }
  }, [step, mfaRetry])

  const handleMfaVerify = async () => {
    if (!mfaEnrollData || mfaCode.length !== 6 || mfaVerifying) return
    setMfaVerifying(true)
    setMfaError(null)
    const result = await verifyTotpEnrollment(mfaEnrollData.factorId, mfaCode)
    if (!result.success) {
      setMfaError(result.error ?? "Invalid code. Please try again.")
      setMfaVerifying(false)
      return
    }
    setStep(5)
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
    setStep(4)
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
        {step <= 4 && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Step {step} of 4</p>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4].map((dot) => (
                <span
                  key={dot}
                  className={`h-2.5 w-2.5 rounded-full ${dot <= step ? "bg-primary" : "bg-muted"}`}
                  aria-hidden
                />
              ))}
            </div>
          </div>
        )}

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

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Audit Log Retention: 3 Years</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Activity logs, COA records, and lot validation documents are retained for <span className="font-bold text-foreground">3 years</span> by default to support 21 CFR Part 11 audit requirements. Records are append-only — once written, they cannot be modified or deleted, even by your lab manager or our team.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Need extended retention (e.g., <span className="font-bold text-foreground">7 years</span> for GMP-regulated cell therapy)? Contact support after onboarding and we&apos;ll update your retention period.
              </p>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleFinishSetup()}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Next →
            </button>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-foreground">Secure your account</h2>
              <p className="text-sm text-muted-foreground">
                Set up two-factor authentication to protect your lab data and meet 21 CFR Part 11 access control requirements.
              </p>
            </div>

            {mfaLoading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">Preparing authenticator setup…</p>
              </div>
            )}

            {!mfaLoading && mfaLoadFailed && (
              <div className="space-y-4">
                <p className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3">
                  Could not load 2FA setup. Please try again.
                </p>
                <button
                  type="button"
                  onClick={() => setMfaRetry((n) => n + 1)}
                  className="w-full h-12 rounded-xl border border-border bg-background text-sm font-bold hover:bg-muted transition-all"
                >
                  Try again
                </button>
              </div>
            )}

            {!mfaLoading && mfaEnrollData && (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-2xl border-2 border-border p-2 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mfaEnrollData.qrCodeUrl} alt="Authenticator QR code" width={160} height={160} />
                  </div>
                  <div className="w-full space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                      Manual entry key
                    </p>
                    <code className="block w-full break-all rounded-xl border border-border bg-muted px-4 py-2 text-center text-xs font-mono tracking-widest text-foreground">
                      {mfaEnrollData.secret}
                    </code>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Open Google Authenticator, Authy, or any TOTP app. Tap <span className="font-bold text-foreground">Add account</span>, scan the QR code above, then enter the 6-digit code shown.
                </p>

                {mfaError ? (
                  <p role="alert" className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-center">
                    {mfaError}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    Verification code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => {
                      setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      setMfaError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && mfaCode.length === 6 && !mfaVerifying) {
                        e.preventDefault()
                        void handleMfaVerify()
                      }
                    }}
                    className="w-full h-12 border border-input bg-background rounded-xl px-4 text-center text-xl font-mono tracking-widest outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                </div>

                <button
                  type="button"
                  disabled={mfaCode.length !== 6 || mfaVerifying}
                  onClick={() => void handleMfaVerify()}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                >
                  {mfaVerifying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Shield className="size-4" aria-hidden />}
                  {mfaVerifying ? "Verifying…" : "Enable two-factor authentication"}
                </button>
              </div>
            )}
          </section>
        )}

        {step === 5 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="size-9 text-green-600 dark:text-green-400" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black tracking-tight text-foreground">You&apos;re all set!</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your lab is configured and your account is secured. Welcome to Buddy Inventory Management.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.replace("/dashboard")}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 inline-flex items-center justify-center"
            >
              Go to Dashboard →
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
