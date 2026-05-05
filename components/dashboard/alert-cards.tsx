"use client"

import { useState, type ReactNode } from "react"
import { Timer, PackageSearch, XCircle, ChevronRight, ChevronDown, CalendarClock } from "lucide-react"
import {
  InventoryGroup,
  LabSettings,
  LotInUseEntry,
  SidebarPage,
} from "@/lib/inventory-utils"
import { useLabAlerts } from "@/hooks/use-lab-alerts"

type AlertKind = "expired" | "urgent" | "expiringSoon" | "lowstock"

interface AlertCardsProps {
  labSettings: LabSettings
  inventory: InventoryGroup[]
  lotsInUse: LotInUseEntry[]
  onNavigate: (page: SidebarPage) => void
  isLoading?: boolean
}

function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return "—"
  const normalized = isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function AlertCards({
  labSettings,
  inventory,
  lotsInUse,
  onNavigate,
  isLoading = false,
}: AlertCardsProps) {
  const [expanded, setExpanded] = useState<AlertKind | null>(null)

  const {
    expiredLots: expiredRows,
    urgentLots: urgentRows,
    expiringSoonLots: expiringSoonRows,
    lowStockItems: lowStockRows,
  } = useLabAlerts({
    inventory,
    lotsInUse,
    labSettings,
    isLoading,
  })

  const toggle = (kind: AlertKind) => {
    setExpanded((prev) => (prev === kind ? null : kind))
  }

  const urgentLabel = `URGENT < ${labSettings.urgentDays} DAYS`
  const expiringSoonLabel = `EXPIRING < ${labSettings.expiringSoonDays} DAYS`

  const kpis: {
    kind: AlertKind
    label: string
    value: number
    icon: typeof XCircle
    colorClass: string
    borderClass: string
    iconBgClass: string
  }[] = [
    {
      kind: "expired",
      label: "EXPIRED LOTS",
      value: expiredRows.length,
      icon: XCircle,
      colorClass: "text-red-500",
      borderClass: "border-red-500/20",
      iconBgClass: "bg-red-500/10",
    },
    {
      kind: "urgent",
      label: urgentLabel,
      value: urgentRows.length,
      icon: Timer,
      colorClass: "text-amber-500",
      borderClass: "border-amber-500/20",
      iconBgClass: "bg-amber-500/10",
    },
    {
      kind: "expiringSoon",
      label: expiringSoonLabel,
      value: expiringSoonRows.length,
      icon: CalendarClock,
      colorClass: "text-yellow-500",
      borderClass: "border-yellow-500/20",
      iconBgClass: "bg-yellow-500/10",
    },
    {
      kind: "lowstock",
      label: "LOW STOCK ITEMS",
      value: lowStockRows.length,
      icon: PackageSearch,
      colorClass: "text-primary",
      borderClass: "border-primary/20",
      iconBgClass: "bg-primary/10",
    },
  ]

  const renderMore = (total: number) => {
    const more = total - 5
    if (more <= 0) return null
    return (
      <p className="text-[11px] font-medium text-muted-foreground pt-1 pl-1">
        and {more} more
      </p>
    )
  }

  type ExpiryAlertRow = {
    key: string
    itemName: string
    lotNumber: string
    expiry: string
    daysLeft: number
    onBench: boolean
  }

  const lotRowList = (slice: ExpiryAlertRow[], total: number) => (
    <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-2">
      {slice.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items.</p>
      ) : (
        slice.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onNavigate(row.onBench ? "lotinuse" : "inventory")}
            className="w-full text-left rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <p className="text-xs font-bold text-foreground truncate">
              {row.itemName}
              {row.onBench ? " (On Bench)" : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Lot {row.lotNumber} · {formatDisplayDate(row.expiry)} ·{" "}
              {row.daysLeft === 0 ? "today" : `${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} left`}
            </p>
          </button>
        ))
      )}
      {renderMore(total)}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="grid w-full grid-cols-2 gap-3 overflow-hidden lg:grid-cols-4 lg:gap-4">
        {kpis.map((item) => {
          const isOpen = expanded === item.kind
          const Icon = item.icon

          let body: ReactNode = null
          if (isOpen) {
            if (item.kind === "expired") {
              const slice = expiredRows.slice(0, 5)
              body = (
                <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-2">
                  {slice.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No items.</p>
                  ) : (
                    slice.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => onNavigate(row.target)}
                        className="w-full text-left rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      >
                        <p className="text-xs font-bold text-foreground truncate">{row.itemName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Lot {row.lotNumber} · {formatDisplayDate(row.expiry)}
                        </p>
                      </button>
                    ))
                  )}
                  {renderMore(expiredRows.length)}
                </div>
              )
            } else if (item.kind === "urgent") {
              body = lotRowList(urgentRows.slice(0, 5), urgentRows.length)
            } else if (item.kind === "expiringSoon") {
              body = lotRowList(expiringSoonRows.slice(0, 5), expiringSoonRows.length)
            } else {
              const slice = lowStockRows.slice(0, 5)
              body = (
                <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-2">
                  {slice.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No items.</p>
                  ) : (
                    slice.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => onNavigate("inventory")}
                        className="w-full text-left rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      >
                        <p className="text-xs font-bold text-foreground truncate">{row.itemName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.count} units · threshold {row.threshold}
                        </p>
                      </button>
                    ))
                  )}
                  {renderMore(lowStockRows.length)}
                </div>
              )
            }
          }

          const chevronCollapsedClass =
            item.kind === "expired"
              ? "size-5 text-muted-foreground group-hover:text-red-500/90"
              : item.kind === "urgent"
                ? "size-5 text-muted-foreground group-hover:text-amber-500/90"
                : item.kind === "expiringSoon"
                  ? "size-5 text-muted-foreground group-hover:text-yellow-500/90"
                  : "size-5 text-muted-foreground group-hover:text-primary"

          return (
            <div
              key={item.kind}
              className={`min-w-0 overflow-hidden rounded-[2.5rem] border-2 ${item.borderClass} bg-card shadow-sm transition-all ${
                isOpen ? "ring-1 ring-border shadow-md" : "hover:shadow-md"
              }`}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(item.kind)}
                className="group w-full p-6 lg:p-8 text-left flex flex-col gap-4 transition-all hover:bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`p-3 lg:p-4 rounded-[1.5rem] ${item.iconBgClass} group-hover:scale-105 transition-transform shrink-0`}
                  >
                    <Icon className={`size-7 lg:size-12 ${item.colorClass}`} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isOpen ? (
                      <ChevronDown className={`size-5 ${item.colorClass} opacity-80`} aria-hidden />
                    ) : (
                      <ChevronRight className={chevronCollapsedClass} aria-hidden />
                    )}
                    <span className={`text-4xl lg:text-5xl font-black tracking-tighter tabular-nums ${item.colorClass}`}>
                      {item.value}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] lg:text-xs font-black uppercase text-muted-foreground tracking-[0.15em] pr-2 leading-snug">
                    {item.label}
                  </p>
                  <div
                    className={`mt-1 h-1 w-8 rounded-full bg-border transition-all duration-500 ${
                      isOpen ? "w-full bg-primary/30" : "group-hover:w-full group-hover:bg-primary/30"
                    }`}
                  />
                </div>
              </button>
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
