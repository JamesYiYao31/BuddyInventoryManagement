"use client"

import { Suspense, useMemo, useState } from "react"
import { Loader2, ShieldCheck, UserCircle, Key } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"

type RegistrationKind = "manager" | "technician"

function LoginContent() {
  const searchParams = useSearchParams()
  const urlError = useMemo(() => searchParams.get("error")?.trim() || null, [searchParams])

  const [isRegistering, setIsRegistering] = useState(false)
  const [registrationKind, setRegistrationKind] = useState<RegistrationKind>("technician")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [managerCode, setManagerCode] = useState("")
  const [techKey, setTechKey] = useState("")

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registerSuccessBanner, setRegisterSuccessBanner] = useState<string | null>(null)

  const router = useRouter()

  const handleSignIn = async () => {
    setIsLoading(true)
    setError(null)
    setRegisterSuccessBanner(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
    } else {
      router.push("/dashboard")
    }
    setIsLoading(false)
  }

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

    let labId: string

    if (registrationKind === "manager") {
      const key = managerCode.trim()
      if (!key) {
        setError("Please enter your Manager Registration Code.")
        setIsLoading(false)
        return
      }

      const { data: lab, error: labErr } = await supabase
        .from("labs")
        .select("id")
        .eq("manager_key", key)
        .maybeSingle()

      if (labErr || !lab?.id) {
        setError("Invalid Manager Code")
        setIsLoading(false)
        return
      }
      labId = lab.id
    } else {
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
      labId = lab.id
    }

    const role = registrationKind === "manager" ? "manager" : "technician"

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
          email: em,
        })
        .eq("id", newUserId)

      if (profileErr) {
        setError(profileErr.message || "Could not finish setting up your profile. Please contact support.")
        await supabase.auth.signOut()
        setIsLoading(false)
        return
      }
    }

    await supabase.auth.signOut()

    setRegisterSuccessBanner("Your account was created successfully. Please sign in with your email and password.")
    setIsRegistering(false)
    setFullName("")
    setPassword("")
    setManagerCode("")
    setTechKey("")
    setIsLoading(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased overflow-hidden">
      {/* ── BACKGROUND GRID ── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)]" style={{ backgroundSize: "48px 48px" }} />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]" style={{ backgroundSize: "48px 48px" }} />
      </div>

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
                  {isRegistering ? "Account Registration" : "Oakwood Clinical Portal"}
                </h1>
                <p className="text-lg text-muted-foreground mt-2 font-medium">
                  {isRegistering ? "Register your clinical credentials" : "Authorized Personnel Access Only"}
                </p>
              </div>

              <div className="space-y-6">
                {registerSuccessBanner && !isRegistering ? (
                  <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 font-bold rounded-2xl text-center text-sm">
                    {registerSuccessBanner}
                  </div>
                ) : null}

                {(error || urlError) ? (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 font-bold rounded-2xl text-center text-sm">{error || urlError}</div>
                ) : null}

                {isRegistering ? (
                  <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
                    <div className="flex border border-border rounded-2xl overflow-hidden bg-muted/30 font-black uppercase tracking-widest text-[10px]">
                      <button
                        type="button"
                        onClick={() => {
                          setRegistrationKind("manager")
                          setError(null)
                        }}
                        className={`flex-1 py-4 transition-all flex items-center justify-center gap-2 ${registrationKind === "manager" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <ShieldCheck className="size-5" />
                        Manager registration
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRegistrationKind("technician")
                          setError(null)
                        }}
                        className={`flex-1 py-4 transition-all flex items-center justify-center gap-2 ${registrationKind === "technician" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <UserCircle className="size-5" />
                        Technician registration
                      </button>
                    </div>

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

                    {registrationKind === "manager" ? (
                      <div className="space-y-2 animate-in slide-in-from-top-2">
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest ml-2">Manager Registration Code</label>
                        <div className="relative">
                          <Key className="absolute left-5 top-5 size-6 text-primary" />
                          <input
                            type="password"
                            value={managerCode}
                            onChange={(e) => setManagerCode(e.target.value)}
                            className="h-16 w-full rounded-2xl border-2 border-primary/30 bg-primary/5 pl-14 pr-6 text-xl font-black text-primary outline-none"
                            placeholder="Enter your lab's manager code"
                            autoComplete="off"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground ml-2 leading-relaxed">
                          Use the Manager Registration Code your lab admin created for this workspace.
                        </p>
                      </div>
                    ) : (
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
                    )}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                    placeholder="••••••••"
                    autoComplete={isRegistering ? "new-password" : "current-password"}
                  />
                </div>

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
        </div>
      </main>
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
