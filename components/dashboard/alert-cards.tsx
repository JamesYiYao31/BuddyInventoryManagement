"use client"

import { AlertTriangle, Clock } from "lucide-react"

export function AlertCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex items-start gap-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/20">
          <Clock className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-destructive">Urgent</p>
          <p className="mt-0.5 text-sm text-foreground">
            2 Reagents Expiring within 7 Days
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Review expiring items immediately to prevent waste
          </p>
        </div>
        <button className="shrink-0 rounded-md bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/30 transition-colors">
          View All
        </button>
      </div>
      <div className="flex items-start gap-4 rounded-lg border border-warning/30 bg-warning/10 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/20">
          <AlertTriangle className="h-5 w-5 text-warning" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-warning">Warning</p>
          <p className="mt-0.5 text-sm text-foreground">
            Lot #4928 (SuperMix) is below 10% volume
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Consider reordering to maintain stock levels
          </p>
        </div>
        <button className="shrink-0 rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/30 transition-colors">
          Reorder
        </button>
      </div>
    </div>
  )
}
