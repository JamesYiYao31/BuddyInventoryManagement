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

const MIN_PASSWORD_LENGTH = 8

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

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [updatingPassword, setUpdatingPassword] = useState(false)

  // Reset the form whenever the dialog is re-opened so stale drafts don't leak in.
  useEffect(() => {
    if (open) {
      setDisplayName(initialName)
      setNewPassword("")
      setConfirmPassword("")
    }
  }, [open, initialName])

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

  const handleUpdatePassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        variant: "destructive",
        title: "Password too short",
        description: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords do not match",
        description: "Re-enter the same password in both fields.",
      })
      return
    }

    setUpdatingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setNewPassword("")
      setConfirmPassword("")
      toast({
        title: "Password updated",
        description: "Your new password is now active.",
      })
    } catch (err: any) {
      console.error("[ProfileSettings] Password update failed:", err)
      toast({
        variant: "destructive",
        title: "Could not update password",
        description: err?.message || "Please try again.",
      })
    } finally {
      setUpdatingPassword(false)
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="profile-new-password"
                  className="text-xs font-bold text-foreground"
                >
                  New Password
                </label>
                <input
                  id="profile-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full h-11 px-4 text-sm font-medium bg-background border border-input rounded-xl outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="profile-confirm-password"
                  className="text-xs font-bold text-foreground"
                >
                  Confirm Password
                </label>
                <input
                  id="profile-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  className="w-full h-11 px-4 text-sm font-medium bg-background border border-input rounded-xl outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleUpdatePassword}
                disabled={updatingPassword || !newPassword || !confirmPassword}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground text-background shadow-sm hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {updatingPassword ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {updatingPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
