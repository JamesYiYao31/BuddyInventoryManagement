"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Loader2, Key } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { persistNewActiveSession, voluntarySignOut } from "@/lib/active-session"
import { getMfaEnrollmentStatus } from "@/lib/mfa"
import { recordSecurityEvent } from "@/lib/security-log"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"

function LoginContent() {
  const searchParams = useSearchParams()
  const urlError = useMemo(() => searchParams.get("error")?.trim() || null, [searchParams])
  const sessionReplacedReason = useMemo(
    () => searchParams.get("reason") === "session_replaced",
    [searchParams]
  )
  const accountDeactivatedReason = useMemo(
    () => searchParams.get("reason") === "account_deactivated",
    [searchParams]
  )

  const [isRegistering, setIsRegistering] = useState(false)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [techKey, setTechKey] = useState("")

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registerSuccessBanner, setRegisterSuccessBanner] = useState<string | null>(null)

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("")
  const [forgotPasswordSubmitting, setForgotPasswordSubmitting] = useState(false)
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false)
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null)

  const router = useRouter()

  const handleSignIn = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setRegisterSuccessBanner(null)

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
    } else {
      const userId = signInData.user?.id
      if (userId) {
        await persistNewActiveSession(userId)
        await recordSecurityEvent("login", "success")
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, lab_id, is_active")
          .eq("id", userId)
          .maybeSingle()

        if (profile?.is_active === false) {
          await voluntarySignOut(userId)
          setError("This account has been deactivated. Contact your lab administrator.")
          setIsLoading(false)
          return
        }

        const role = profile?.role

        if (role === "super_admin") {
          router.push("/super-admin")
        } else {
          // Check onboarding for managers before any 2FA gate.
          // /welcome handles 2FA internally as Step 4.
          let onboardingComplete = true
          if (role === "manager" && profile?.lab_id) {
            const { data: settings } = await supabase
              .from("lab_settings")
              .select("onboarding_complete")
              .eq("lab_id", profile.lab_id)
              .maybeSingle()
            onboardingComplete = !!settings?.onboarding_complete
          }

          if (role === "manager" && !onboardingComplete) {
            router.push("/welcome")
          } else {
            const { enrolled } = await getMfaEnrollmentStatus()
            if ((role === "manager" || role === "org_admin") && !enrolled) {
              router.push("/mfa-setup")
            } else if (enrolled) {
              router.push("/mfa-challenge")
            } else {
              router.push("/dashboard")
            }
          }
        }
      } else {
        router.push("/dashboard")
      }
    }
    setIsLoading(false)
  }, [email, password, router])

  const handleRegister = async () => {
    setIsLoading(true)
    setError(null)
    setRegisterSuccessBanner(null)

    const fn = fullName.trim()
    const em = email.trim()

    if (!fn || !em || !password) {
      setError("Please fill in all fields.")
      setIsLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      setIsLoading(false)
      return
    }

    const key = techKey.trim()
    if (!key) {
      setError("Please enter your Technician Registration Code.")
      setIsLoading(false)
      return
    }

    const { data: lab, error: labErr } = await supabase
      .from("labs")
      .select("id")
      .eq("tech_key", key)
      .maybeSingle()

    if (labErr || !lab?.id) {
      setError("Invalid Tech Code")
      setIsLoading(false)
      return
    }

    const labId = lab.id
    const role = "technician" as const

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: em,
      password,
      options: {
        data: {
          full_name: fn,
          role,
          lab_id: labId,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setIsLoading(false)
      return
    }

    const newUserId = signUpData?.user?.id
    if (newUserId) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          role,
          lab_id: labId,
          full_name: fn,
        })
        .eq("id", newUserId)

      if (profileErr) {
        setError(profileErr.message || "Could not finish setting up your profile. Please contact support.")
        await voluntarySignOut(newUserId)
        setIsLoading(false)
        return
      }
    }

    await voluntarySignOut(newUserId)

    setRegisterSuccessBanner("Your account was created successfully. Please sign in with your email and password.")
    setIsRegistering(false)
    setFullName("")
    setPassword("")
    setConfirmPassword("")
    setTechKey("")
    setIsLoading(false)
  }

  const closeForgotPassword = useCallback(() => {
    setForgotPasswordOpen(false)
    setForgotPasswordEmail("")
    setForgotPasswordError(null)
    setForgotPasswordSent(false)
  }, [])

  const handleForgotPassword = async () => {
    setForgotPasswordError(null)
    const trimmedEmail = forgotPasswordEmail.trim()
    if (!trimmedEmail) {
      setForgotPasswordError("Please enter your email address.")
      return
    }
    setForgotPasswordSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setForgotPasswordSubmitting(false)
    if (resetError) {
      setForgotPasswordError(resetError.message)
      return
    }
    setForgotPasswordSent(true)
  }

  const handleSignInEnterKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      if (isRegistering || isLoading) return
      e.preventDefault()
      void handleSignIn()
    },
    [isRegistering, isLoading, handleSignIn],
  )

  useEffect(() => {
    const handleEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      if (isRegistering || isLoading) return
      e.preventDefault()
      void handleSignIn()
    }

    document.addEventListener("keydown", handleEnter)
    return () => {
      document.removeEventListener("keydown", handleEnter)
    }
  }, [isRegistering, isLoading, handleSignIn])

  useEffect(() => {
    if (!forgotPasswordOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForgotPassword()
    }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [forgotPasswordOpen, closeForgotPassword])

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased overflow-hidden">
      {/* ── HEADER ── */}
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
        <div className="w-full max-w-3xl animate-in fade-in zoom-in-95 duration-500">
          <div className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-2xl ring-2 ring-border/60">
            {/* TOGGLE TABS */}
            <div className="flex border-b border-border bg-muted/40 font-black uppercase tracking-widest text-xs">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(false)
                  setError(null)
                }}
                className={`flex-1 py-6 transition-all ${!isRegistering ? "bg-background text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(true)
                  setError(null)
                  setRegisterSuccessBanner(null)
                }}
                className={`flex-1 py-6 transition-all ${isRegistering ? "bg-background text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                Register
              </button>
            </div>

            <div className="p-14 md:p-16 space-y-10">
              <div className="flex flex-col items-center text-center">
                <Image src="/buddy-logo.png" alt="Logo" width={64} height={64} className="h-16 w-auto mb-8 drop-shadow-md" priority />
                <h1 className="text-4xl font-black tracking-tight text-foreground">
                  {isRegistering ? "Register" : "Buddy Inventory Management"}
                </h1>
                <p className="text-lg text-muted-foreground mt-2 font-medium">
                  {isRegistering ? "Create your technician account" : "Authorized Personnel Access Only"}
                </p>
              </div>

              <div className="space-y-6">
                {registerSuccessBanner && !isRegistering ? (
                  <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 font-bold rounded-2xl text-center text-sm">
                    {registerSuccessBanner}
                  </div>
                ) : null}

                {sessionReplacedReason && !isRegistering ? (
                  <div
                    role="status"
                    className="p-4 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-100 font-semibold rounded-2xl text-center text-sm"
                  >
                    You were signed out because your account was logged in from another device.
                  </div>
                ) : null}

                {accountDeactivatedReason && !isRegistering ? (
                  <div
                    role="alert"
                    className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 font-bold rounded-2xl text-center text-sm"
                  >
                    This account has been deactivated. Contact your lab administrator.
                  </div>
                ) : null}

                {(error || urlError) ? (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 font-bold rounded-2xl text-center text-sm">{error || urlError}</div>
                ) : null}

                {isRegistering ? (
                  <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Full Name</label>
                      <input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                        placeholder="Dr. Jane Smith"
                        autoComplete="name"
                      />
                    </div>

                    <div className="space-y-2 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black uppercase text-primary tracking-widest ml-2">Technician Registration Code</label>
                      <div className="relative">
                        <Key className="absolute left-5 top-5 size-6 text-primary" />
                        <input
                          type="password"
                          value={techKey}
                          onChange={(e) => setTechKey(e.target.value)}
                          className="h-16 w-full rounded-2xl border-2 border-primary/30 bg-primary/5 pl-14 pr-6 text-xl font-black text-primary outline-none"
                          placeholder="Enter your lab's technician code"
                          autoComplete="off"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground ml-2 leading-relaxed">
                        Use the Technician Registration Code your lab admin created for this workspace.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={handleSignInEnterKeyDown}
                    className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                    placeholder="name@facility.org"
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Secure Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleSignInEnterKeyDown}
                    className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                    placeholder="••••••••"
                    autoComplete={isRegistering ? "new-password" : "current-password"}
                  />
                </div>

                {!isRegistering && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPasswordOpen(true)
                        setForgotPasswordEmail(email)
                        setForgotPasswordSent(false)
                        setForgotPasswordError(null)
                      }}
                      className="text-xs font-bold uppercase tracking-widest text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {isRegistering ? (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                ) : null}

                {isRegistering ? (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleRegister()}
                    className="h-16 w-full rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {isLoading ? <Loader2 className="size-8 animate-spin mx-auto" /> : "Create Secure Identity"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleSignIn()}
                    className="h-16 w-full rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {isLoading ? <Loader2 className="size-8 animate-spin mx-auto" /> : "Authorize Access"}
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-sm font-black uppercase tracking-[0.3em] text-muted-foreground">Authorized personnel only</p>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <span aria-hidden> · </span>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
          </p>
        </div>
      </main>

      {forgotPasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-10 space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <Image src="/buddy-logo.png" alt="Logo" width={48} height={48} className="h-12 w-auto drop-shadow-md" />
              <h2 className="text-2xl font-black tracking-tight text-foreground">Reset your password</h2>
              <p className="text-sm text-muted-foreground font-medium">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            {forgotPasswordError && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 font-bold rounded-2xl text-center text-sm">
                {forgotPasswordError}
              </div>
            )}

            {forgotPasswordSent ? (
              <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 font-bold rounded-2xl text-center text-sm">
                If an account exists for that email, we've sent a password reset link. Check your inbox.
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Email Address</label>
                <input
                  type="email"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.nativeEvent.stopImmediatePropagation()
                      void handleForgotPassword()
                    }
                  }}
                  className="h-14 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  placeholder="name@facility.org"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            )}

            <div className="flex flex-col gap-3">
              {!forgotPasswordSent && (
                <button
                  type="button"
                  disabled={forgotPasswordSubmitting}
                  onClick={() => void handleForgotPassword()}
                  className="h-14 w-full rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none uppercase tracking-widest"
                >
                  {forgotPasswordSubmitting ? <Loader2 className="size-6 animate-spin mx-auto" /> : "Send reset link"}
                </button>
              )}
              <button
                type="button"
                onClick={closeForgotPassword}
                className="h-14 w-full rounded-2xl border border-border bg-background text-sm font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
              >
                {forgotPasswordSent ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading...</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  )
}
