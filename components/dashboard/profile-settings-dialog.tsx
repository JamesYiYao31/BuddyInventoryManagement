"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, Mail, UserCircle2, KeyRound, ShieldCheck, Beaker, Save,
  Shield, ShieldOff, RefreshCw,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getMfaEnrollmentStatus, generateMfaRecoveryCodes, unenrollTotp } from "@/lib/mfa"
import { RecoveryCodesDisplay, RecoveryCodesLoading } from "@/components/mfa/recovery-codes-display"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type TabId = "profile" | "security"

interface ProfileSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: any
  role: "manager" | "org_admin" | "technician" | "super_admin"
  mfaReturnTo?: string
  onProfileUpdated?: () => void | Promise<void>
}

export function ProfileSettingsDialog({
  open,
  onOpenChange,
  user,
  role,
  mfaReturnTo,
  onProfileUpdated,
}: ProfileSettingsDialogProps) {
  const { toast } = useToast()
  const router = useRouter()

  const resolvedMfaReturnTo =
    mfaReturnTo ?? (role === "super_admin" ? "/super-admin" : "/dashboard")
  const mfaSetupPath = `/mfa-setup?returnTo=${resolvedMfaReturnTo}`

  const initialName =
    user?.user_metadata?.full_name ||
    (user?.email ? String(user.email).split("@")[0] : "") ||
    ""
  const email = user?.email ?? ""

  const [activeTab, setActiveTab] = useState<TabId>("profile")

  // Profile tab state
  const [displayName, setDisplayName] = useState(initialName)
  const [savingName, setSavingName] = useState(false)

  // Security tab — password state
  const [resetSending, setResetSending] = useState(false)
  const [resetEmailSuccess, setResetEmailSuccess] = useState<string | null>(null)
  const [resetEmailError, setResetEmailError] = useState<string | null>(null)

  // Security tab — 2FA state
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaEnrolled, setMfaEnrolled] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [unenrolling, setUnenrolling] = useState(false)
  const [showRegenerateRecoveryConfirm, setShowRegenerateRecoveryConfirm] = useState(false)
  const [generatingRecoveryCodes, setGeneratingRecoveryCodes] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  // Reset everything and load MFA status when dialog opens.
  useEffect(() => {
    if (!open) return
    setDisplayName(initialName)
    setResetEmailSuccess(null)
    setResetEmailError(null)
    setActiveTab("profile")
    setShowDisableConfirm(false)
    setShowRegenerateConfirm(false)
    setShowRegenerateRecoveryConfirm(false)
    setRecoveryCodes(null)
    setMfaError(null)

    async function loadMfaStatus() {
      setMfaLoading(true)
      try {
        const status = await getMfaEnrollmentStatus()
        setMfaEnrolled(status.enrolled)
        setMfaFactorId(status.factorId)
      } catch {
        setMfaError("Could not load 2FA status.")
      } finally {
        setMfaLoading(false)
      }
    }
    void loadMfaStatus()
  }, [open, initialName])

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    const handleEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      const activeId = (document.activeElement as HTMLElement | null)?.id || ""
      e.preventDefault()
      if (activeId === "profile-display-name") void handleSaveName()
    }
    window.history.pushState(null, "", window.location.href)
    const handlePopState = () => onOpenChange(false)
    document.addEventListener("keydown", handleEsc)
    document.addEventListener("keydown", handleEnter)
    window.addEventListener("popstate", handlePopState)
    return () => {
      document.removeEventListener("keydown", handleEsc)
      document.removeEventListener("keydown", handleEnter)
      window.removeEventListener("popstate", handlePopState)
    }
  }, [open, onOpenChange])

  const nameDirty = displayName.trim() !== (initialName || "").trim()

  const handleSaveName = async () => {
    if (!user?.id) return
    const trimmed = displayName.trim()
    if (!trimmed) {
      toast({ variant: "destructive", title: "Display name required", description: "Please enter a name before saving." })
      return
    }
    setSavingName(true)
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: trimmed })
        .eq("id", user.id)
      if (profileError) throw profileError

      const { error: authError } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
      if (authError) throw authError

      toast({ title: "Display name updated", description: "Your profile name has been saved." })
      await onProfileUpdated?.()
    } catch (err: unknown) {
      console.error("[ProfileSettings] Name save failed:", err)
      toast({
        variant: "destructive",
        title: "Could not save name",
        description: err instanceof Error ? err.message : "Please try again in a moment.",
      })
    } finally {
      setSavingName(false)
    }
  }

  const handleSendPasswordReset = async () => {
    const userEmail = email.trim()
    if (!userEmail) {
      setResetEmailError("No email is associated with this session.")
      setResetEmailSuccess(null)
      return
    }
    setResetSending(true)
    setResetEmailError(null)
    setResetEmailSuccess(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) { setResetEmailError(error.message); return }
      setResetEmailSuccess("Check your email for a password reset link.")
    } catch (err: unknown) {
      setResetEmailError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setResetSending(false)
    }
  }

  const handleDisable2FA = async () => {
    if (!mfaFactorId) return
    setUnenrolling(true)
    setMfaError(null)
    try {
      const result = await unenrollTotp(mfaFactorId)
      if (!result.success) {
        setMfaError(result.error ?? "Could not disable 2FA. Please try again.")
        setShowDisableConfirm(false)
        return
      }
      setMfaEnrolled(false)
      setMfaFactorId(null)
      setShowDisableConfirm(false)
      toast({ title: "2FA disabled", description: "Two-factor authentication has been turned off." })
    } catch {
      setMfaError("Could not disable 2FA. Please try again.")
      setShowDisableConfirm(false)
    } finally {
      setUnenrolling(false)
    }
  }

  const handleRegenerate2FA = async () => {
    if (!mfaFactorId) return
    setUnenrolling(true)
    setMfaError(null)
    try {
      const result = await unenrollTotp(mfaFactorId)
      if (!result.success) {
        setMfaError(result.error ?? "Could not remove existing 2FA. Please try again.")
        setShowRegenerateConfirm(false)
        return
      }
      onOpenChange(false)
      router.push(`/mfa-setup?returnTo=${resolvedMfaReturnTo}`)
    } catch {
      setMfaError("Could not remove existing 2FA. Please try again.")
      setShowRegenerateConfirm(false)
    } finally {
      setUnenrolling(false)
    }
  }

  const handleGenerateRecoveryCodes = async () => {
    setGeneratingRecoveryCodes(true)
    setMfaError(null)
    try {
      const generated = await generateMfaRecoveryCodes()
      if (!generated) {
        setMfaError("Could not generate recovery codes. Please try again.")
        setShowRegenerateRecoveryConfirm(false)
        return
      }
      setRecoveryCodes(generated.codes)
      setShowRegenerateRecoveryConfirm(false)
      toast({
        title: "New recovery codes generated",
        description: "Save them now — previous codes no longer work.",
      })
    } catch {
      setMfaError("Could not generate recovery codes. Please try again.")
      setShowRegenerateRecoveryConfirm(false)
    } finally {
      setGeneratingRecoveryCodes(false)
    }
  }

  const isPrivilegedRole = role === "manager" || role === "org_admin" || role === "super_admin"
  const roleLabel =
    role === "manager" ? "Manager"
    : role === "org_admin" ? "Org Admin"
    : role === "super_admin" ? "Super Admin"
    : "Technician"
  const RoleIcon = role === "technician" ? Beaker : ShieldCheck

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] p-0 overflow-hidden border-border bg-card">
        {/* Header */}
        <div className="px-7 sm:px-9 pt-7 sm:pt-8 pb-5 sm:pb-6 border-b border-border bg-muted/30">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-xl font-black tracking-tight text-foreground">
              Profile Settings
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-muted-foreground">
              Manage how your identity appears across the lab workspace.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border bg-muted/20">
          {(["profile", "security"] as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
                activeTab === tab
                  ? "text-primary border-b-2 border-primary bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "profile" ? "Profile" : "Security"}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-7 sm:px-9 py-6 sm:py-8 space-y-8 sm:space-y-10">

          {/* ── PROFILE TAB ── */}
          {activeTab === "profile" && (
            <>
              {/* Basic Info */}
              <section className="space-y-4 sm:space-y-5">
                <div className="flex items-center gap-2">
                  <UserCircle2 className="size-4 text-primary" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Basic Info
                  </h3>
                </div>
                <div className="space-y-2">
                  <label htmlFor="profile-display-name" className="text-xs font-bold text-foreground">
                    Display Name
                  </label>
                  <input
                    id="profile-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full h-11 px-4 text-sm font-medium bg-background border border-input rounded-xl outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This name appears in the top bar and on all activity log entries.
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !nameDirty}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {savingName ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {savingName ? "Saving..." : "Save"}
                  </button>
                </div>
              </section>

              <div className="h-px bg-border" />

              {/* Account Details */}
              <section className="space-y-4 sm:space-y-5">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-primary" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Account Details
                  </h3>
                </div>
                <div className="space-y-2">
                  <label htmlFor="profile-email" className="text-xs font-bold text-foreground">
                    Email Address
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    value={email}
                    disabled
                    readOnly
                    className="w-full h-11 px-4 text-sm font-mono font-medium bg-muted/50 border border-input rounded-xl text-muted-foreground cursor-not-allowed select-all"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Your sign-in email cannot be changed from here. Contact a lab manager if it needs to change.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-foreground">Current Role</p>
                  <div
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-black uppercase tracking-widest ${
                      role === "technician"
                        ? "bg-muted border-border text-foreground"
                        : "bg-primary/10 border-primary/20 text-primary"
                    }`}
                  >
                    <RoleIcon className="size-3.5" />
                    {roleLabel}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ── SECURITY TAB ── */}
          {activeTab === "security" && (
            <>
              {/* Password */}
              <section className="space-y-4 sm:space-y-5">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Password
                  </h3>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Password changes are sent via email for security.
                </p>
                {resetEmailSuccess ? (
                  <p role="status" className="text-xs font-medium text-green-500">{resetEmailSuccess}</p>
                ) : null}
                {resetEmailError ? (
                  <p role="alert" className="text-xs font-medium text-red-400">{resetEmailError}</p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSendPasswordReset()}
                    disabled={resetSending || !email.trim()}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground text-background shadow-sm hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {resetSending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    {resetSending ? "Sending…" : "Send Password Reset Email"}
                  </button>
                </div>
              </section>

              <div className="h-px bg-border" />

              {/* Two-Factor Authentication */}
              <section className="space-y-4 sm:space-y-5">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-primary" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Two-Factor Authentication
                  </h3>
                </div>

                {mfaLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Loading 2FA status…</span>
                  </div>
                ) : (
                  <>
                    {/* Status badge */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-foreground">Status</p>
                      {mfaEnrolled ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-green-500/10 border border-green-500/20 text-green-600">
                          <ShieldCheck className="size-3" />
                          Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-muted border border-border text-muted-foreground">
                          <ShieldOff className="size-3" />
                          Disabled
                        </span>
                      )}
                    </div>

                    {mfaError && (
                      <p role="alert" className="text-xs font-medium text-red-400">{mfaError}</p>
                    )}

                    {/* Privileged enrolled: recovery codes + replace authenticator side by side */}
                    {isPrivilegedRole && mfaEnrolled && (
                      <>
                        {role !== "super_admin" && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Two-factor authentication is required for your role and cannot be disabled.
                          </p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                          {/* LEFT — Recovery Codes */}
                          <div className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5 space-y-3 sm:space-y-4 flex flex-col min-w-0">
                            <div>
                              <div className="flex items-center gap-2">
                                <KeyRound className="size-4 text-muted-foreground" />
                                <p className="text-xs font-bold text-foreground">Recovery Codes</p>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                                One-time backup codes if you lose your authenticator device. Generating new codes invalidates your previous ones.
                              </p>
                            </div>

                            {generatingRecoveryCodes ? (
                              <RecoveryCodesLoading />
                            ) : recoveryCodes ? (
                              <RecoveryCodesDisplay
                                codes={recoveryCodes}
                                onDismiss={() => setRecoveryCodes(null)}
                                dismissLabel="Done"
                              />
                            ) : showRegenerateRecoveryConfirm ? (
                              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                                <p className="text-xs font-bold text-foreground">Generate new recovery codes?</p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                  This invalidates all previous recovery codes immediately. Save the new batch in a secure place.
                                </p>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setShowRegenerateRecoveryConfirm(false)}
                                    disabled={generatingRecoveryCodes}
                                    className="h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted disabled:opacity-50 transition-all"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleGenerateRecoveryCodes()}
                                    disabled={generatingRecoveryCodes}
                                    className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-all"
                                  >
                                    {generatingRecoveryCodes
                                      ? <Loader2 className="size-3.5 animate-spin" />
                                      : <KeyRound className="size-3.5" />}
                                    Generate
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-end mt-auto">
                                <button
                                  type="button"
                                  onClick={() => setShowRegenerateRecoveryConfirm(true)}
                                  className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted transition-all w-full sm:w-auto"
                                >
                                  <KeyRound className="size-4" />
                                  Generate New Recovery Codes
                                </button>
                              </div>
                            )}
                          </div>

                          {/* RIGHT — Replace Authenticator */}
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3 sm:space-y-4 flex flex-col min-w-0">
                            <div>
                              <div className="flex items-center gap-2">
                                <RefreshCw className="size-4 text-amber-500" />
                                <p className="text-xs font-bold text-foreground">Replace Authenticator</p>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                                Removes your current authenticator app and starts a fresh 2FA setup. Use this if you got a new phone.
                              </p>
                            </div>

                            {showRegenerateConfirm ? (
                              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3 mt-auto">
                                <p className="text-xs font-bold text-foreground">Confirm regeneration</p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                  This will remove your current authenticator and require you to re-scan a new QR code. You'll be redirected to set up 2FA again.
                                </p>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setShowRegenerateConfirm(false)}
                                    disabled={unenrolling}
                                    className="h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted disabled:opacity-50 transition-all"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRegenerate2FA()}
                                    disabled={unenrolling}
                                    className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-all"
                                  >
                                    {unenrolling
                                      ? <Loader2 className="size-3.5 animate-spin" />
                                      : <RefreshCw className="size-3.5" />}
                                    {unenrolling ? "Removing…" : "Regenerate"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-end mt-auto">
                                <button
                                  type="button"
                                  onClick={() => setShowRegenerateConfirm(true)}
                                  className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground text-background shadow-sm hover:bg-foreground/90 transition-all w-full sm:w-auto"
                                >
                                  <RefreshCw className="size-4" />
                                  Regenerate 2FA
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Technician enrolled: recovery codes (standalone) */}
                    {role === "technician" && mfaEnrolled && (
                      <div className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5 space-y-3 sm:space-y-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <KeyRound className="size-4 text-muted-foreground" />
                            <p className="text-xs font-bold text-foreground">Recovery Codes</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                            One-time backup codes if you lose your authenticator device. Generating new codes invalidates your previous ones.
                          </p>
                        </div>

                        {generatingRecoveryCodes ? (
                          <RecoveryCodesLoading />
                        ) : recoveryCodes ? (
                          <RecoveryCodesDisplay
                            codes={recoveryCodes}
                            onDismiss={() => setRecoveryCodes(null)}
                            dismissLabel="Done"
                          />
                        ) : showRegenerateRecoveryConfirm ? (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                            <p className="text-xs font-bold text-foreground">Generate new recovery codes?</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              This invalidates all previous recovery codes immediately. Save the new batch in a secure place.
                            </p>
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setShowRegenerateRecoveryConfirm(false)}
                                disabled={generatingRecoveryCodes}
                                className="h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted disabled:opacity-50 transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleGenerateRecoveryCodes()}
                                disabled={generatingRecoveryCodes}
                                className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-all"
                              >
                                {generatingRecoveryCodes
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <KeyRound className="size-3.5" />}
                                Generate
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setShowRegenerateRecoveryConfirm(true)}
                              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted transition-all w-full sm:w-auto"
                            >
                              <KeyRound className="size-4" />
                              Generate New Recovery Codes
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                      {/* super_admin not enrolled: enable only */}
                      {role === "super_admin" && !mfaEnrolled && (
                        <>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Add an extra layer of security to your account with an authenticator app.
                          </p>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => { onOpenChange(false); router.push(mfaSetupPath) }}
                              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
                            >
                              <Shield className="size-4" />
                              Enable 2FA
                            </button>
                          </div>
                        </>
                      )}

                      {/* technician: optional, can enable or disable */}
                      {role === "technician" && (
                        mfaEnrolled ? (
                          <>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              Your account is protected with an authenticator app.
                            </p>
                            {showDisableConfirm ? (
                              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                                <p className="text-xs font-bold text-foreground">Disable 2FA?</p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                  Are you sure you want to disable two-factor authentication? Your account will be less secure.
                                </p>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setShowDisableConfirm(false)}
                                    disabled={unenrolling}
                                    className="h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest border border-border bg-background hover:bg-muted disabled:opacity-50 transition-all"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDisable2FA()}
                                    disabled={unenrolling}
                                    className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-all"
                                  >
                                    {unenrolling
                                      ? <Loader2 className="size-3.5 animate-spin" />
                                      : <ShieldOff className="size-3.5" />}
                                    {unenrolling ? "Disabling…" : "Disable 2FA"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setShowDisableConfirm(true)}
                                  className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500/10 transition-all"
                                >
                                  <ShieldOff className="size-4" />
                                  Disable 2FA
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              Add an extra layer of security to your account with an authenticator app.
                            </p>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => { onOpenChange(false); router.push(mfaSetupPath) }}
                                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
                              >
                                <Shield className="size-4" />
                                Enable 2FA
                              </button>
                            </div>
                          </>
                        )
                      )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
