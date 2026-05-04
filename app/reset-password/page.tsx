"use client"

import { useEffect, useState, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { PasswordStrengthChecklist } from "@/components/password-strength-checklist"
import { isPasswordStrengthSatisfied } from "@/lib/password-strength"

function hashHasRecoveryType(hash: string): boolean {
  try {
    const raw = hash.replace(/^#/, "")
    if (!raw) return false
    return new URLSearchParams(raw).get("type") === "recovery"
  } catch {
    return false
  }
}

export default function ResetPasswordPage() {
  const router = useRouter()

  const [gate, setGate] = useState<"checking" | "invalid" | "ready">("checking")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const snapshot = typeof window !== "undefined" ? window.location.hash : ""
    const hadRecoveryInUrl = hashHasRecoveryType(snapshot)

    const markReady = () => {
      if (cancelled) return
      setGate((g) => (g === "checking" ? "ready" : g))
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) markReady()
    })

    const trySession = () => {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (cancelled) return
        if (!session) return
        if (hadRecoveryInUrl || hashHasRecoveryType(typeof window !== "undefined" ? window.location.hash : "")) {
          markReady()
        }
      })
    }

    trySession()
    const t1 = window.setTimeout(trySession, 300)
    const t2 = window.setTimeout(trySession, 1500)

    const deadline = window.setTimeout(() => {
      if (cancelled) return
      setGate((g) => (g === "checking" ? "invalid" : g))
    }, 5000)

    return () => {
      cancelled = true
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(deadline)
      sub.subscription.unsubscribe()
    }
  }, [])

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword
  const canSubmit =
    isPasswordStrengthSatisfied(newPassword) && passwordsMatch && !submitting && !done

  const handleSubmit = useCallback(async () => {
    setSubmitError(null)
    if (!isPasswordStrengthSatisfied(newPassword)) return
    if (newPassword !== confirmPassword) {
      setSubmitError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setSubmitError(error.message)
        setSubmitting(false)
        return
      }
      setDone(true)
      window.setTimeout(() => {
        router.replace("/login")
      }, 2000)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong.")
      setSubmitting(false)
    }
  }, [newPassword, confirmPassword, router])

  useEffect(() => {
    if (gate !== "ready" || done) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      if (document.activeElement?.tagName === "TEXTAREA") return
      e.preventDefault()
      if (canSubmit) void handleSubmit()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [gate, done, canSubmit, handleSubmit])

  if (gate === "checking") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Verifying reset link…</p>
      </div>
    )
  }

  if (gate === "invalid") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md rounded-[2rem] border border-border bg-card p-10 shadow-2xl ring-2 ring-border/60 text-center space-y-6">
          <Image src="/buddy-logo.png" alt="Buddy" width={64} height={64} className="h-16 w-auto mx-auto drop-shadow-md" priority />
          <p className="text-sm font-semibold text-foreground leading-relaxed">
            This link is invalid or has expired.
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
              <h1 className="text-2xl font-black tracking-tight text-foreground">Set a new password</h1>
              <p className="text-sm text-muted-foreground mt-2 font-medium">Choose a strong password for your account.</p>
            </div>

            {done ? (
              <p
                role="status"
                className="text-center text-sm font-semibold text-green-600 dark:text-green-400 rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-4"
              >
                Password updated successfully!
              </p>
            ) : (
              <div className="space-y-5">
                {submitError ? (
                  <p role="alert" className="text-sm font-medium rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 px-4 py-3 text-center">
                    {submitError}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <label htmlFor="reset-new-password" className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-1 block text-left">
                    New password
                  </label>
                  <input
                    id="reset-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      setSubmitError(null)
                    }}
                    autoComplete="new-password"
                    className="h-14 w-full rounded-2xl border border-input bg-background px-5 text-base font-medium focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  />
                  <PasswordStrengthChecklist password={newPassword} show={newPassword.length > 0} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="reset-confirm-password" className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-1 block text-left">
                    Confirm password
                  </label>
                  <input
                    id="reset-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      setSubmitError(null)
                    }}
                    autoComplete="new-password"
                    className="h-14 w-full rounded-2xl border border-input bg-background px-5 text-base font-medium focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  />
                </div>

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                  className="h-14 w-full rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-xl shadow-primary/20 hover:opacity-95 transition-all disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                  {submitting ? "Updating…" : "Update password"}
                </button>
              </div>
            )}
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
