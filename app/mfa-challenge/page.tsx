"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Shield } from "lucide-react"
import { getMfaEnrollmentStatus, redeemMfaRecoveryCode, verifyTotpChallenge } from "@/lib/mfa"
import { normalizeRecoveryCode } from "@/lib/recovery-code-format"

function MfaChallengeContent() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [code, setCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { enrolled, factorId: fid } = await getMfaEnrollmentStatus()
      if (cancelled) return
      if (!enrolled || !fid) {
        router.replace("/mfa-setup")
        return
      }
      setFactorId(fid)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleVerify = useCallback(async () => {
    if (!factorId || code.length !== 6 || verifying) return
    setVerifying(true)
    setError(null)
    const result = await verifyTotpChallenge(factorId, code)
    if (!result.success) {
      setError(result.error ?? "Invalid code. Please try again.")
      setVerifying(false)
      return
    }
    router.replace("/dashboard")
  }, [factorId, code, verifying, router])

  const handleRedeemRecovery = useCallback(async () => {
    const normalized = normalizeRecoveryCode(recoveryCode)
    if (normalized.length !== 8 || verifying) return
    setVerifying(true)
    setError(null)
    const result = await redeemMfaRecoveryCode(recoveryCode)
    if (!result.success) {
      setError(result.error ?? "Invalid recovery code.")
      setVerifying(false)
      return
    }
    router.replace("/dashboard")
  }, [recoveryCode, verifying, router])

  const canSubmitTotp = code.length === 6 && !verifying
  const canSubmitRecovery = normalizeRecoveryCode(recoveryCode).length === 8 && !verifying

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      if (document.activeElement?.tagName === "TEXTAREA") return
      e.preventDefault()
      if (useRecoveryCode) {
        if (!canSubmitRecovery) return
        void handleRedeemRecovery()
      } else {
        if (!canSubmitTotp) return
        void handleVerify()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [useRecoveryCode, canSubmitTotp, canSubmitRecovery, handleVerify, handleRedeemRecovery])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Loading…</p>
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
              <h1 className="text-2xl font-black tracking-tight text-foreground">Two-factor authentication</h1>
              <p className="text-sm text-muted-foreground mt-2 font-medium">
                {useRecoveryCode
                  ? "Enter one of your saved recovery codes. Each code works only once."
                  : "Open your authenticator app and enter the 6-digit code for Buddy Inventory Management."}
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-sm font-medium rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 px-4 py-3 text-center">
                {error}
              </p>
            ) : null}

            {useRecoveryCode ? (
              <div className="space-y-2">
                <label htmlFor="mfa-recovery-code" className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-1 block">
                  Recovery code
                </label>
                <input
                  id="mfa-recovery-code"
                  type="text"
                  inputMode="text"
                  maxLength={9}
                  value={recoveryCode}
                  onChange={(e) => {
                    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "")
                    setRecoveryCode(raw.slice(0, 9))
                    setError(null)
                  }}
                  className="h-14 w-full rounded-2xl border border-input bg-background px-5 text-center text-xl font-mono tracking-widest focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="mfa-challenge-code" className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-1 block">
                  Authentication code
                </label>
                <input
                  id="mfa-challenge-code"
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
                <p className="text-xs text-muted-foreground text-center mt-1">Code refreshes every 30 seconds</p>
              </div>
            )}

            <button
              type="button"
              disabled={useRecoveryCode ? !canSubmitRecovery : !canSubmitTotp}
              onClick={() => void (useRecoveryCode ? handleRedeemRecovery() : handleVerify())}
              className="h-14 w-full rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-xl shadow-primary/20 hover:opacity-95 transition-all disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {verifying ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Shield className="size-5" aria-hidden />}
              {verifying ? "Verifying…" : "Verify"}
            </button>

            <p className="text-center">
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryCode((prev) => !prev)
                  setError(null)
                  setCode("")
                  setRecoveryCode("")
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                {useRecoveryCode ? "Use authenticator code instead" : "Use a recovery code instead"}
              </button>
            </p>
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

function MfaChallengeFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading…</p>
    </div>
  )
}

export default function MfaChallengePage() {
  return (
    <Suspense fallback={<MfaChallengeFallback />}>
      <MfaChallengeContent />
    </Suspense>
  )
}
