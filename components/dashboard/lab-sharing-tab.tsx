"use client"

import { Network } from "lucide-react"

interface LabSharingTabProps {
  labName?: string
}

export default function LabSharingTab({ labName }: LabSharingTabProps) {
  void labName

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 max-w-6xl">
      <div className="rounded-[2.5rem] border border-border bg-card p-12 shadow-sm">
        <div className="mx-auto max-w-3xl text-center space-y-6">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
            <Network className="size-9 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-foreground">Buddy Verified Network</h1>
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Coming in a future update</p>
          </div>
          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Connect with other Buddy Labs to share reagent availability and offer expiring stock to verified labs in your network.
            Labs control their own visibility and what they share.
          </p>
          <div className="flex justify-center pt-2">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Planned Feature
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}