"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Shield, Smartphone, QrCode, KeyRound } from "lucide-react"
import { completeEnrollmentLog, enrollTotp, generateMfaRecoveryCodes, getMfaEnrollmentStatus, verifyTotpEnrollment } from "@/lib/mfa"
import { isSafeReturnTo } from "@/lib/safe-redirect"
import { RecoveryCodesDisplay, RecoveryCodesLoading } from "@/components/mfa/recovery-codes-display"

function MfaSetupContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [enrollData, setEnrollData] = useState<{ qrCodeUrl: string; secret: string; factorId: string } | null>(null)
  const [code, setCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [generatingRecoveryCodes, setGeneratingRecoveryCodes] = useState(false)
  const hasEnrolledRef = useRef(false)

  const postSetupRedirect = useCallback(() => {
    const returnTo = searchParams.get("returnTo")
    router.replace(isSafeReturnTo(returnTo) ? returnTo! : "/dashboard")
  }, [searchParams, router])

  useEffect(() => {
    if (hasEnrolledRef.current) return
    hasEnrolledRef.current = true

    async function load() {
      const { enrolled } = await getMfaEnrollmentStatus()
      if (enrolled) {
        postSetupRedirect()
        return
      }
      const data = await enrollTotp()
      setEnrollData(data)
      setLoading(false)
    }
    void load()
  }, [postSetupRedirect])

  const handleVerify = useCallback(async () => {
    if (!enrollData || code.length !== 6 || verifying) return
    setVerifying(true)
    setError(null)
    const result = await verifyTotpEnrollment(enrollData.factorId, code)
    if (!result.success) {
      setError(result.error ?? "Invalid code. Please try again.")
      setVerifying(false)
      return
    }
    // Fire-and-forget — must not delay or gate recovery-code generation.
    void completeEnrollmentLog(searchParams.get("mode") === "replace")
    setVerifying(false)
    setGeneratingRecoveryCodes(true)
    const generated = await generateMfaRecoveryCodes()
    setGeneratingRecoveryCodes(false)
    if (!generated) {
      setError("2FA enabled, but recovery codes could not be generated. You can create them later in Profile Settings → Security.")
      postSetupRedirect()
      return
    }
    setRecoveryCodes(generated.codes)
  }, [enrollData, code, verifying, postSetupRedirect, searchParams])

  const handleRecoveryCodesDismiss = useCallback(() => {
    postSetupRedirect()
  }, [postSetupRedirect])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      if (recoveryCodes || generatingRecoveryCodes) return
      if (code.length !== 6) return
      e.preventDefault()
      void handleVerify()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [code, handleVerify, recoveryCodes, generatingRecoveryCodes])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Preparing your authenticator setup…</p>
      </div>
    )
  }

  if (!enrollData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md rounded-[2rem] border border-border bg-card p-10 shadow-2xl ring-2 ring-border/60 text-center space-y-6">
          <Image src="/buddy-logo.png" alt="Buddy" width={64} height={64} className="h-16 w-auto mx-auto drop-shadow-md" priority />
          <p className="text-sm font-semibold text-foreground leading-relaxed">
            Could not initialize 2FA setup. Please try logging in again.
          </p>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-sm font-black text-primary-foreground shadow-lg hover:opacity-90"
          >
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  if (generatingRecoveryCodes) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md rounded-[2rem] border border-border bg-card p-10 shadow-2xl ring-2 ring-border/60">
          <RecoveryCodesLoading />
        </div>
      </div>
    )
  }

  if (recoveryCodes) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md rounded-[2rem] border border-border bg-card p-10 shadow-2xl ring-2 ring-border/60 space-y-6">
          <div className="text-center space-y-2">
            <Image src="/buddy-logo.png" alt="Buddy" width={64} height={64} className="h-16 w-auto mx-auto drop-shadow-md" priority />
            <h1 className="text-2xl font-black tracking-tight text-foreground">Save your recovery codes</h1>
            <p className="text-sm text-muted-foreground">Two-factor authentication is enabled.</p>
          </div>
          <RecoveryCodesDisplay codes={recoveryCodes} onDismiss={handleRecoveryCodesDismiss} />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased overflow-hidden">
      <header className="relative z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5 md:px-14">
          <p className="text-lg font-semibold uppercase tracking-[0.35em] text-muted-foreground">Clinical access</p>
          <div className="flex items-center gap-3 text-lg font-medium uppercase tracking-wider text-muted-foreground">
            <span className="size-3 rounded-full bg-primary" aria-hidden />
            <span>Inventory systems</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center p-6 md:p-14">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
          <div className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-2xl ring-2 ring-border/60 p-10 md:p-12 space-y-8">
            <div className="flex flex-col items-center text-center">
              <Image src="/buddy-logo.png" alt="Buddy" width={64} height={64} className="h-16 w-auto mb-6 drop-shadow-md" priority />
              <h1 className="text-2xl font-black tracking-tight text-foreground">Secure your account</h1>
              <p className="text-sm text-muted-foreground mt-2 font-medium">
                Set up two-factor authentication to protect your lab data.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Smartphone className="size-4 text-primary" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-foreground">Step 1</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Download an authenticator app such as Google Authenticator or Authy on your phone.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <QrCode className="size-4 text-primary" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-foreground">Step 2</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Scan the QR code below with your authenticator app, or enter the manual key.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <KeyRound className="size-4 text-primary" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-foreground">Step 3</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Enter the 6-digit code from your app below to confirm setup.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl border-2 border-border p-2 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrollData.qrCodeUrl} alt="Authenticator QR code" width={180} height={180} />
              </div>
              <div className="w-full space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                  Manual entry key
                </p>
                <code className="block w-full break-all rounded-xl border border-border bg-muted px-4 py-2 text-center text-xs font-mono tracking-widest text-foreground">
                  {enrollData.secret}
                </code>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-sm font-medium rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 px-4 py-3 text-center">
                {error}
              </p>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="mfa-setup-code" className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-1 block">
                Verification code
              </label>
              <input
                id="mfa-setup-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  setError(null)
                }}
                className="h-14 w-full rounded-2xl border border-input bg-background px-5 text-center text-2xl font-mono tracking-widest focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>

            <button
              type="button"
              disabled={code.length !== 6 || verifying}
              onClick={() => void handleVerify()}
              className="h-14 w-full rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-xl shadow-primary/20 hover:opacity-95 transition-all disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {verifying ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Shield className="size-5" aria-hidden />}
              {verifying ? "Verifying…" : "Enable two-factor authentication"}
            </button>
          </div>

          <p className="mt-8 text-center text-sm font-black uppercase tracking-[0.3em] text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Back to login
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

function MfaSetupFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading…</p>
    </div>
  )
}

export default function MfaSetupPage() {
  return (
    <Suspense fallback={<MfaSetupFallback />}>
      <MfaSetupContent />
    </Suspense>
  )
}
