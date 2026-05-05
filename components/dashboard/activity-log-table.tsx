"use client"

import React from "react"
import { 
  PackagePlus, 
  PackageOpen, 
  MinusCircle, 
  Trash2, 
  ShoppingCart, 
  CheckCircle2, 
  Edit3,
  Clock,
  User,
  Search,
  Printer
} from "lucide-react"
import { ActivityLogEntry, ACTION_STYLES, LabSettings } from "@/lib/inventory-utils"

interface ActivityLogTabProps {
  logs: ActivityLogEntry[]
  labName?: string
  currentUserName?: string
  currentUserRole?: "manager" | "technician"
  labSettings?: LabSettings
  filterUser?: string
  filterAction?: string
  filterDateStart?: string
  filterDateEnd?: string
}

export default function ActivityLogTab({
  logs, labName, currentUserName, currentUserRole, labSettings,
  filterUser, filterAction, filterDateStart, filterDateEnd,
}: ActivityLogTabProps) {
  const reportLabName = labName || labSettings?.labName || "My Lab"
  const printUserName = (currentUserName || "Unknown User").toUpperCase()

  const hasUserFilter = !!(filterUser && filterUser !== "all")
  const hasActionFilter = !!filterAction
  const hasDateFilter = !!(filterDateStart || filterDateEnd)
  const hasAnyFilter = hasUserFilter || hasActionFilter || hasDateFilter

  // ── LOGIC: GROUP BY DATE ──
  const groupLogsByDate = (entries: ActivityLogEntry[]) => {
    const groups: Record<string, ActivityLogEntry[]> = {}
    entries.forEach(log => {
      const date = log.date
      if (!groups[date]) groups[date] = []
      groups[date].push(log)
    })
    return groups
  }

  const groupedLogs = groupLogsByDate(logs)
  const sortedDates = Object.keys(groupedLogs).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  const printRows = sortedDates.flatMap((date) => groupedLogs[date].map((log) => ({ date, log })))

  const handlePrint = () => window.print()
  const getInlineActionLabel = (actionType: string) => {
    const normalized = actionType.toLowerCase()
    if (normalized === "approved lot") return "Approved Lot"
    if (normalized === "submitted lot validation") return "Submitted Lot Validation"
    if (normalized === "submitted coa") return "Submitted COA"
    return normalized
  }

  // ── LOGIC: ACTION ICONS ──
  const getActionIcon = (type: string) => {
    switch (type) {
      case "Added": return <PackagePlus className="size-5" />
      case "Opened": return <PackageOpen className="size-5" />
      case "Used": return <MinusCircle className="size-5" />
      case "Disposed": return <Trash2 className="size-5" />
      case "Ordered": return <ShoppingCart className="size-5" />
      case "Received": return <CheckCircle2 className="size-5" />
      case "Edited": return <Edit3 className="size-5" />
      default: return <Clock className="size-5" />
    }
  }

  return (
    <div className="w-full overflow-x-hidden print:font-sans">
      <div className="relative flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 print:animate-none print:transform-none">
        
        {/* ── SCREEN HEADER (Hidden on Print) ── */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between print:hidden">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">Activity Log</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 font-medium">Complete immutable audit trail for ISO/CAP compliance.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="px-5 py-2.5 bg-muted rounded-2xl border border-border flex items-center gap-2">
              <User className="size-4 text-muted-foreground" />
              <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Logged as {currentUserName || "—"}
                {currentUserRole && ` (${currentUserRole === "manager" ? "Manager" : "Technician"})`}
              </span>
            </div>
            <button onClick={handlePrint} className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all">
              <Printer className="size-5 text-muted-foreground" /> Print Log
            </button>
          </div>
        </div>

        {/* ── PRINT HEADER (Visible ONLY on Print) ── */}
        <div className="hidden print:block space-y-5 mb-6 border-b-2 border-zinc-900 pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-zinc-900">Activity Log Report</h1>
              <p className="text-zinc-500 font-medium mt-1">{reportLabName} | Clinical Laboratory Management</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-emerald-600">AUDIT TRAIL</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 pt-2">
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Current User</p>
              <p className="text-lg font-bold text-zinc-900">{printUserName}</p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generated Date</p>
              <p className="text-lg font-bold text-zinc-900">{new Date().toLocaleDateString()}</p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Date Range</p>
              <p className="text-lg font-bold text-zinc-900">
                {sortedDates.length > 0
                  ? `${sortedDates[sortedDates.length - 1]} – ${sortedDates[0]}`
                  : "—"}
              </p>
            </div>
          </div>

          {hasAnyFilter && (
            <div className="space-y-1 pt-2">
              {hasUserFilter && (
                <p className="text-sm font-semibold text-zinc-700">
                  Active Filter: <span className="font-bold text-zinc-900">{filterUser}</span>
                </p>
              )}
              {hasActionFilter && (
                <p className="text-sm font-semibold text-zinc-700">
                  Action Filter: <span className="font-bold text-zinc-900">{filterAction}</span>
                </p>
              )}
              {hasDateFilter && (
                <p className="text-sm font-semibold text-zinc-700">
                  Date Range: <span className="font-bold text-zinc-900">{filterDateStart || "—"} to {filterDateEnd || "—"}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── TIMELINE STREAM (Screen only) ── */}
        <div className="relative space-y-12 pb-20 print:hidden">
          <div className="absolute left-[31px] top-4 bottom-0 w-0.5 bg-border border-dashed border-l-2" />

          {sortedDates.map((date) => (
            <div key={date} className="relative space-y-6">
              <div className="sticky top-0 z-10 py-2">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-background border-2 border-border rounded-full shadow-sm">
                  <span className="text-sm font-black text-foreground uppercase tracking-widest">
                    {new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>

              <div className="space-y-4 ml-16">
                {groupedLogs[date].map((log) => (
                  <div 
                    key={log.id} 
                    className="group relative w-full min-w-0 rounded-[2rem] border border-border bg-card p-6 shadow-sm transition-all hover:border-primary/20 hover:shadow-md flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className={`absolute -left-[49px] z-10 flex-shrink-0 rounded-full border-4 border-background p-3 shadow-sm transition-transform group-hover:scale-110 ${ACTION_STYLES[log.actionType]}`}>
                      {getActionIcon(log.actionType)}
                    </div>

                    <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
                      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center text-sm font-black text-muted-foreground border border-border shrink-0 flex-shrink-0">
                        {log.userInitials}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-foreground">{log.user}</span>
                          <span className="text-muted-foreground font-medium">{getInlineActionLabel(log.actionType)}</span>
                          <span className="font-bold text-primary px-2 py-0.5 bg-primary/5 rounded-lg">{log.itemName}</span>
                          {log.lotNumber && (
                            <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-md border border-border">
                              Lot: {log.lotNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 font-medium">{log.details}</p>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-left sm:ml-4 sm:text-right">
                      <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">{log.time}</p>
                      <div className={`inline-flex items-center gap-1.5 mt-1 px-3 py-1 rounded-full text-[10px] font-bold ${ACTION_STYLES[log.actionType]}`}>
                        {log.actionType}
                      </div>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <div className="p-10 bg-muted rounded-[3rem] mb-6">
                <Search className="size-12 text-muted-foreground opacity-20" />
              </div>
              <h3 className="text-xl font-black text-foreground">No records found</h3>
              <p className="text-muted-foreground mt-2 max-w-xs mx-auto font-medium">The lab activity stream is currently empty. Start by adding reagents to the inventory.</p>
            </div>
          )}
        </div>

        {/*
          ── PRINT-ONLY TABLE ──
        */}
        <div className="hidden print:block print:w-full print:bg-white print:text-black print-table-wrapper">
          <table className="w-full border-collapse text-[11px] text-black font-sans">
            <colgroup>
              <col style={{ width: "13%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "30%" }} />
            </colgroup>

            <thead>
              <tr style={{ borderBottom: "2px solid black" }}>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Date</th>
                <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Time</th>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">User</th>
                <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Action</th>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Item / Lot</th>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">Details</th>
              </tr>
            </thead>

            <tbody>
              {printRows.length > 0 ? (
                printRows.map(({ date, log }, idx) => (
                  <React.Fragment key={log.id}>
                    <tr className="align-top print:border-b print:border-black">
                      <td className="text-left px-3 print:py-4 font-semibold text-black tabular-nums">{date}</td>
                      <td className="text-center px-3 print:py-4 tabular-nums text-zinc-700">{log.time}</td>
                      <td className="text-left px-3 print:py-4 font-semibold text-black">{log.user}</td>
                      <td className="text-center px-3 print:py-4 font-bold text-black">{log.actionType}</td>
                      <td className="text-left px-3 print:py-4 text-black">
                        <div className="font-semibold">{log.itemName}</div>
                        {log.lotNumber && (
                          <div className="text-[10px] font-mono text-zinc-600 mt-0.5">Lot: {log.lotNumber}</div>
                        )}
                      </td>
                      <td className="text-left px-3 print:py-4 text-zinc-700">{log.details}</td>
                    </tr>
                    {idx === printRows.length - 1 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-zinc-900 font-black uppercase tracking-widest">
                          End of Report
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-600">
                    No activity to report for the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PRINT SIGNATURE FOOTER — fixed to bottom of every printed page ── */}
      {/* Notice this is now OUTSIDE of the animated container to prevent the browser from trapping it! */}
      <div className="hidden print:block print-footer-fixed" style={{ paddingLeft: "1cm", paddingRight: "1cm" }}>
        <div className="border-t-2 border-zinc-900 pt-3 pb-2 flex justify-end items-end">
          <span className="text-xs font-bold text-zinc-700 uppercase tracking-widest mr-3">Reviewed by:</span>
          <span className="inline-block border-b border-zinc-900 w-64 h-4" />
        </div>
      </div>

    </div>
  )
}