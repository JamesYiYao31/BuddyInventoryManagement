"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2, FlaskConical } from "lucide-react"
import { supabase } from "@/lib/supabase"

type InviteRow = {
  id: string
  token: string
  lab_name: string
  used: boolean
}

function RegisterLabContent() {
  const searchParams = useSearchParams()
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams])

  const [inviteGate, setInviteGate] = useState<"loading" | "invalid" | "ready">("loading")
  const [inviteRow, setInviteRow] = useState<InviteRow | null>(null)

  const [labName, setLabName] = useState("")
  const [managerFullName, setManagerFullName] = useState("")
  const [managerEmail, setManagerEmail] = useState("")
  const [managerPassword, setManagerPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [techKey, setTechKey] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [successWarning, setSuccessWarning] = useState<string | null>(null)

  const [generalError, setGeneralError] = useState<string | null>(null)
  const [labNameError, setLabNameError] = useState<string | null>(null)
  const [techKeyError, setTechKeyError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setInviteGate("loading")
      setInviteRow(null)

      if (!token) {
        if (!cancelled) setInviteGate("invalid")
        return
      }

      const { data, error } = await supabase
        .from("lab_invites")
        .select("id, token, lab_name, used")
        .eq("token", token)
        .maybeSingle()

      if (cancelled) return

      if (error || !data || data.used) {
        setInviteGate("invalid")
        return
      }

      setInviteRow(data as InviteRow)
      setLabName(data.lab_name || "")
      setInviteGate("ready")
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  const clearFieldErrors = useCallback(() => {
    setGeneralError(null)
    setLabNameError(null)
    setTechKeyError(null)
    setEmailError(null)
  }, [])

  const deleteLabById = async (labId: string) => {
    await supabase.from("labs").delete().eq("id", labId)
  }

  const handleRegister = async () => {
    clearFieldErrors()
    setSuccessWarning(null)

    if (!token || !inviteRow) {
      setGeneralError("Missing invite token.")
      return
    }

    const name = labName.trim()
    const fullName = managerFullName.trim()
    const email = managerEmail.trim()
    const pass = managerPassword
    const confirm = confirmPassword
    const tk = techKey.trim()

    if (!name || !fullName || !email || !pass || !confirm || !tk) {
      setGeneralError("Please fill in all fields.")
      return
    }

    if (pass !== confirm) {
      setGeneralError("Password and confirmation do not match.")
      return
    }

    setSubmitting(true)

    try {
      const { data: techDup } = await supabase.from("labs").select("id").eq("tech_key", tk).maybeSingle()
      if (techDup) {
        setTechKeyError("This Technician Code is already taken, please choose another")
        setSubmitting(false)
        return
      }

      const { data: newLab, error: labErr } = await supabase
        .from("labs")
        .insert({
          name,
          tech_key: tk,
        })
        .select("id")
        .single()

      if (labErr || !newLab?.id) {
        const msg = labErr?.message || "Could not create lab."
        if (labErr?.code === "23505" || msg.toLowerCase().includes("unique")) {
          if (labErr?.code === "23505" && msg.toLowerCase().includes("labs_name_unique_ci")) {
            setLabNameError("A lab with this name already exists. Please choose a different name.")
          } else if (msg.toLowerCase().includes("tech") || msg.toLowerCase().includes("tech_key")) {
            setTechKeyError("This Technician Code is already taken, please choose another")
          } else {
            setGeneralError("A registration code is already in use. Please choose a different technician code.")
          }
        } else {
          setGeneralError(msg)
        }
        setSubmitting(false)
        return
      }

      const labId = newLab.id as string

      const { error: inviteErr } = await supabase
        .from("lab_invites")
        .update({
          used: true,
          used_at: new Date().toISOString(),
        })
        .eq("token", token)
        .select()

      if (inviteErr) {
        await deleteLabById(labId)
        setGeneralError(
          `The invite could not be marked as used: ${inviteErr.message}. Registration was cancelled. Please contact support with your email.`
        )
        setSubmitting(false)
        return
      }

      const { data: authData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: {
            full_name: fullName,
            role: "manager",
            lab_id: labId,
          },
        },
      })

      if (signUpErr) {
        await deleteLabById(labId)
        const em = signUpErr.message.toLowerCase()
        if (
          em.includes("already") ||
          em.includes("registered") ||
          em.includes("exists") ||
          signUpErr.status === 422
        ) {
          setEmailError("An account with this email already exists. Please sign in or use a different email.")
        } else {
          setGeneralError(signUpErr.message)
        }
        setSubmitting(false)
        return
      }

      const userId = authData.user?.id
if (!userId) {
  await deleteLabById(labId)
  setGeneralError("Registration did not return a user id. Please try again or contact support.")
  setSubmitting(false)
  return
}

      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          role: "manager",
          lab_id: labId,
          full_name: fullName,
          email,
        })
        .eq("id", userId)

      if (profileErr) {
        await deleteLabById(labId)
        await supabase.auth.signOut()
        setGeneralError(
          profileErr.message ||
            "Could not finish setting up your profile. Please contact support if this persists."
        )
        setSubmitting(false)
        return
      }

      await supabase.auth.signOut()
      setSuccess(true)
      setSuccessWarning(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong."
      setGeneralError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (inviteGate === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Checking invite...</p>
      </div>
    )
  }

  if (inviteGate === "invalid") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
          <FlaskConical className="size-12 text-muted-foreground mx-auto" aria-hidden />
          <p className="text-base font-semibold text-foreground">This invite link is invalid or has already been used.</p>
          <Link href="/" className="inline-block text-sm font-bold text-primary hover:underline">
            Go to home
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 shadow-sm text-center space-y-6">
          <div className="p-3 rounded-2xl bg-green-500/10 w-fit mx-auto">
            <FlaskConical className="size-10 text-green-600 dark:text-green-400" aria-hidden />
          </div>
          <p className="text-base font-semibold text-foreground leading-relaxed">
            Your lab has been created successfully. Please sign in to continue.
          </p>
          {successWarning ? (
            <p
              role="status"
              className="text-sm font-medium rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 px-4 py-3 text-left"
            >
              {successWarning}
            </p>
          ) : null}
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"
          >
            Go to Login
          </Link>
        </div>
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
            <h1 className="text-lg font-black tracking-tight">Register your lab</h1>
            <p className="text-xs text-muted-foreground">Complete the form to create your workspace.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-10 space-y-8">
        {generalError ? (
          <p
            role="alert"
            className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3"
          >
            {generalError}
          </p>
        ) : null}

        <div className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="space-y-2">
            <label htmlFor="reg-lab-name" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Lab name
            </label>
            <input
              id="reg-lab-name"
              type="text"
              value={labName}
              onChange={(e) => {
                setLabName(e.target.value)
                setLabNameError(null)
              }}
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
            {labNameError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {labNameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-manager-name" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Manager full name
            </label>
            <input
              id="reg-manager-name"
              type="text"
              value={managerFullName}
              onChange={(e) => setManagerFullName(e.target.value)}
              autoComplete="name"
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-email" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Manager email
            </label>
            <input
              id="reg-email"
              type="email"
              value={managerEmail}
              onChange={(e) => {
                setManagerEmail(e.target.value)
                setEmailError(null)
              }}
              autoComplete="email"
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
            {emailError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-password" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Manager password
            </label>
            <input
              id="reg-password"
              type="password"
              value={managerPassword}
              onChange={(e) => setManagerPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-confirm" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Confirm password
            </label>
            <input
              id="reg-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-tech-key" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
              Technician Registration Code
            </label>
            <input
              id="reg-tech-key"
              type="text"
              value={techKey}
              onChange={(e) => {
                setTechKey(e.target.value)
                setTechKeyError(null)
              }}
              autoComplete="off"
              className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              This code must be unique across every lab. Technicians use it when they join.
            </p>
            {techKeyError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {techKeyError}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleRegister()}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Create lab and account
          </button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="font-bold text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </main>
    </div>
  )
}

function RegisterLabFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading...</p>
    </div>
  )
}

export default function RegisterLabPage() {
  return (
    <Suspense fallback={<RegisterLabFallback />}>
      <RegisterLabContent />
    </Suspense>
  )
}
