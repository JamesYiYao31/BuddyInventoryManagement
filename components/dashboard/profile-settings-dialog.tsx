"use client"

import { useEffect, useState } from "react"
import { Loader2, Mail, UserCircle2, KeyRound, ShieldCheck, Beaker, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ProfileSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: any
  role: "manager" | "technician"
  onProfileUpdated?: () => void | Promise<void>
}

export function ProfileSettingsDialog({
  open,
  onOpenChange,
  user,
  role,
  onProfileUpdated,
}: ProfileSettingsDialogProps) {
  const { toast } = useToast()

  const initialName =
    user?.user_metadata?.full_name ||
    (user?.email ? String(user.email).split("@")[0] : "") ||
    ""
  const email = user?.email ?? ""

  const [displayName, setDisplayName] = useState(initialName)
  const [savingName, setSavingName] = useState(false)

  const [resetSending, setResetSending] = useState(false)
  const [resetEmailSuccess, setResetEmailSuccess] = useState<string | null>(null)
  const [resetEmailError, setResetEmailError] = useState<string | null>(null)

  // Reset the form whenever the dialog is re-opened so stale drafts don't leak in.
  useEffect(() => {
    if (open) {
      setDisplayName(initialName)
      setResetEmailSuccess(null)
      setResetEmailError(null)
    }
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
      toast({
        variant: "destructive",
        title: "Display name required",
        description: "Please enter a name before saving.",
      })
      return
    }

    setSavingName(true)
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: trimmed })
        .eq("id", user.id)

      if (profileError) throw profileError

      // Keep the auth user_metadata in sync so the header + activity log
      // pick the new name up on the next session load.
      const { error: authError } = await supabase.auth.updateUser({
        data: { full_name: trimmed },
      })
      if (authError) throw authError

      toast({
        title: "Display name updated",
        description: "Your profile name has been saved.",
      })
      await onProfileUpdated?.()
    } catch (err: any) {
      console.error("[ProfileSettings] Name save failed:", err)
      toast({
        variant: "destructive",
        title: "Could not save name",
        description: err?.message || "Please try again in a moment.",
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
      if (error) {
        setResetEmailError(error.message)
        return
      }
      setResetEmailSuccess("Check your email for a password reset link.")
    } catch (err: unknown) {
      setResetEmailError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setResetSending(false)
    }
  }

  const roleLabel = role === "manager" ? "Manager" : "Technician"
  const RoleIcon = role === "manager" ? ShieldCheck : Beaker

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden border-border bg-card">
        <div className="px-7 pt-7 pb-5 border-b border-border bg-muted/30">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-xl font-black tracking-tight text-foreground">
              Profile Settings
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-muted-foreground">
              Manage how your identity appears across the lab workspace.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-7 py-6 space-y-8">
          {/* ── SECTION 1: BASIC INFO ── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <UserCircle2 className="size-4 text-primary" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Basic Info
              </h3>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="profile-display-name"
                className="text-xs font-bold text-foreground"
              >
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
                onClick={handleSaveName}
                disabled={savingName || !nameDirty}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {savingName ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {savingName ? "Saving..." : "Save"}
              </button>
            </div>
          </section>

          <div className="h-px bg-border" />

          {/* ── SECTION 2: ACCOUNT DETAILS ── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-primary" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Account Details
              </h3>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="profile-email"
                className="text-xs font-bold text-foreground"
              >
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
                  role === "manager"
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-muted border-border text-foreground"
                }`}
              >
                <RoleIcon className="size-3.5" />
                {roleLabel}
              </div>
            </div>
          </section>

          <div className="h-px bg-border" />

          {/* ── SECTION 3: SECURITY ── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Security
              </h3>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Password changes are sent via email for security.
            </p>

            {resetEmailSuccess ? (
              <p role="status" className="text-xs font-medium text-green-500">
                {resetEmailSuccess}
              </p>
            ) : null}
            {resetEmailError ? (
              <p role="alert" className="text-xs font-medium text-red-400">
                {resetEmailError}
              </p>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
