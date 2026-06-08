"use client"

import { useCallback, useState } from "react"
import { AlertTriangle, Check, Copy, Download, Loader2 } from "lucide-react"

interface RecoveryCodesDisplayProps {
  codes: string[]
  onDismiss?: () => void
  dismissLabel?: string
}

export function RecoveryCodesDisplay({
  codes,
  onDismiss,
  dismissLabel = "I've saved these codes",
}: RecoveryCodesDisplayProps) {
  const [copied, setCopied] = useState(false)

  const codesText = codes.join("\n")

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codesText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [codesText])

  const handleDownload = useCallback(() => {
    const content =
      "Buddy Inventory Management — MFA Recovery Codes\n" +
      "Save these in a secure location. Each code works once.\n\n" +
      codesText +
      "\n"
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "buddy-mfa-recovery-codes.txt"
    anchor.style.display = "none"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [codesText])

  return (
    <div className="space-y-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
        <div>
          <p className="text-sm font-bold text-foreground">Save these now — they will not be shown again</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Store these recovery codes in a password manager or secure location. Each code works once if you lose access to your authenticator app.
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-border bg-background p-4">
        {codes.map((code) => (
          <li
            key={code}
            className="font-mono text-sm tracking-widest text-center py-2 px-3 rounded-lg bg-muted/60 text-foreground"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => void handleCopyAll()}
          className="inline-flex flex-1 items-center justify-center gap-2 h-11 rounded-xl border border-border bg-background text-xs font-black uppercase tracking-widest hover:bg-muted transition-all"
        >
          {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy all"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex flex-1 items-center justify-center gap-2 h-11 rounded-xl border border-border bg-background text-xs font-black uppercase tracking-widest hover:bg-muted transition-all"
        >
          <Download className="size-4" />
          Download .txt
        </button>
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="h-12 w-full rounded-xl bg-primary text-primary-foreground text-sm font-black shadow-sm hover:opacity-95 transition-all inline-flex items-center justify-center gap-2"
        >
          {dismissLabel}
        </button>
      ) : null}
    </div>
  )
}

interface RecoveryCodesLoadingProps {
  message?: string
}

export function RecoveryCodesLoading({ message = "Generating recovery codes…" }: RecoveryCodesLoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 rounded-2xl border border-border bg-muted/30">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
