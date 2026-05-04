"use client"

import { CheckCircle2, XCircle } from "lucide-react"
import { getPasswordStrengthChecks } from "@/lib/password-strength"

type PasswordStrengthChecklistProps = {
  password: string
  show: boolean
}

export function PasswordStrengthChecklist({ password, show }: PasswordStrengthChecklistProps) {
  if (!show) return null
  const checks = getPasswordStrengthChecks(password)
  return (
    <ul className="mt-2 space-y-1.5" aria-live="polite">
      {checks.map((c) => (
        <li key={c.label} className="flex items-start gap-2 text-xs">
          {c.met ? (
            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5 text-green-500" aria-hidden />
          ) : (
            <XCircle className="size-3.5 shrink-0 mt-0.5 text-red-400" aria-hidden />
          )}
          <span className={c.met ? "text-green-500" : "text-red-400"}>{c.label}</span>
        </li>
      ))}
    </ul>
  )
}
