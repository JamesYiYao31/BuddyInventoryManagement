"use client"

import React from "react"
import {
  Clock,
  User,
  Printer,
  ShieldAlert,
} from "lucide-react"
import {
  SecurityLogEntry,
  securityEventLabel,
} from "@/lib/inventory-utils"

interface SecurityLogTableProps {
  logs: SecurityLogEntry[]
  currentUserName?: string
  currentUserRole?: string
  timezone?: string
  showLab?: boolean
  labNamesById?: Record<string, string>
  filterUser?: string
  filterEvent?: string
  filterDateStart?: string
  filterDateEnd?: string
  /** When true, skip the page-level title row (section already provides one). */
  embedded?: boolean
}

function labDisplay(
  labId: string | null,
  labNamesById?: Record<string, string>
): string {
  if (!labId) return "—"
  return labNamesById?.[labId] ?? labId
}

export default function SecurityLogTable({
  logs,
  currentUserName,
  currentUserRole,
  timezone = "UTC",
  showLab = false,
  labNamesById,
  filterUser,
  filterEvent,
  filterDateStart,
  filterDateEnd,
  embedded = false,
}: SecurityLogTableProps) {
  const printUserName = (currentUserName || "Unknown User").toUpperCase()

  const formatGroupDateHeader = (createdAt: string) => {
    let tz = timezone || "UTC"
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date())
    } catch {
      tz = "UTC"
    }
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(new Date(createdAt))
  }

  const hasUserFilter = !!(filterUser && filterUser !== "all")
  const hasEventFilter = !!filterEvent
  const hasDateFilter = !!(filterDateStart || filterDateEnd)
  const hasAnyFilter = hasUserFilter || hasEventFilter || hasDateFilter

  const groupLogsByDate = (entries: SecurityLogEntry[]) => {
    const groups: Record<string, SecurityLogEntry[]> = {}
    entries.forEach((log) => {
      const date = log.date
      if (!groups[date]) groups[date] = []
      groups[date].push(log)
    })
    return groups
  }

  const groupedLogs = groupLogsByDate(logs)
  const sortedDates = Object.keys(groupedLogs).sort((a, b) => {
    const aLatest = Math.max(
      ...groupedLogs[a].map((log) => new Date(log.createdAt).getTime())
    )
    const bLatest = Math.max(
      ...groupedLogs[b].map((log) => new Date(log.createdAt).getTime())
    )
    return bLatest - aLatest
  })
  const printRows = sortedDates.flatMap((date) =>
    groupedLogs[date].map((log) => ({ date, log }))
  )

  const handlePrint = () => window.print()

  const printColCount = showLab ? 8 : 7

  return (
    <div className="w-full overflow-x-hidden print:font-sans">
      <div className="relative flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 print:animate-none print:transform-none">
        {!embedded && (
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between print:hidden">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
              Security Log
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 font-medium">
              Access-control audit trail — logins, MFA, roles, and account changes.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="px-5 py-2.5 bg-muted rounded-2xl border border-border flex items-center gap-2">
              <User className="size-4 text-muted-foreground" />
              <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Logged as {currentUserName || "—"}
                {currentUserRole ? ` (${currentUserRole})` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all"
            >
              <Printer className="size-5 text-muted-foreground" /> Print Log
            </button>
          </div>
        </div>
        )}
        {embedded && (
          <div className="flex justify-end print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all"
            >
              <Printer className="size-5 text-muted-foreground" /> Print Log
            </button>
          </div>
        )}

        <div className="hidden print:block space-y-5 mb-6 border-b-2 border-zinc-900 pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-zinc-900">
                Security Log Report
              </h1>
              <p className="text-zinc-500 font-medium mt-1">
                Access-control audit trail
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-emerald-600">SECURITY TRAIL</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 pt-2">
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                Current User
              </p>
              <p className="text-lg font-bold text-zinc-900">{printUserName}</p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                Generated Date
              </p>
              <p className="text-lg font-bold text-zinc-900">
                {new Date().toLocaleDateString()}
              </p>
            </div>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                Date Range
              </p>
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
                  Active Filter:{" "}
                  <span className="font-bold text-zinc-900">{filterUser}</span>
                </p>
              )}
              {hasEventFilter && (
                <p className="text-sm font-semibold text-zinc-700">
                  Event Filter:{" "}
                  <span className="font-bold text-zinc-900">{filterEvent}</span>
                </p>
              )}
              {hasDateFilter && (
                <p className="text-sm font-semibold text-zinc-700">
                  Date Range:{" "}
                  <span className="font-bold text-zinc-900">
                    {filterDateStart || "—"} to {filterDateEnd || "—"}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="relative space-y-12 pb-20 print:hidden">
          <div className="absolute left-[31px] top-4 bottom-0 w-0.5 bg-border border-dashed border-l-2" />

          {sortedDates.map((date) => (
            <div key={date} className="relative space-y-6">
              <div className="sticky top-0 z-10 py-2">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-background border-2 border-border rounded-full shadow-sm">
                  <span className="text-sm font-black text-foreground uppercase tracking-widest">
                    {formatGroupDateHeader(groupedLogs[date][0].createdAt)}
                  </span>
                </div>
              </div>

              <div className="space-y-4 ml-16">
                {groupedLogs[date].map((log) => {
                  const isFailure = log.outcome === "failure"
                  return (
                    <div
                      key={log.id}
                      className="group relative w-full min-w-0 rounded-[2rem] border border-border bg-card p-6 shadow-sm transition-all hover:border-primary/20 hover:shadow-md flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="absolute -left-[49px] z-10 flex-shrink-0 rounded-full border-4 border-background p-3 shadow-sm bg-muted text-muted-foreground transition-transform group-hover:scale-110">
                        <ShieldAlert className="size-5" />
                      </div>

                      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
                          <div className="size-12 rounded-2xl bg-muted flex items-center justify-center text-sm font-black text-muted-foreground border border-border shrink-0">
                            {log.userInitials}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-foreground">{log.user}</span>
                              <span className="font-bold text-primary px-2 py-0.5 bg-primary/5 rounded-lg">
                                {securityEventLabel(log.eventType)}
                              </span>
                              <span
                                className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  isFailure
                                    ? "bg-red-500/15 text-red-700 dark:text-red-400"
                                    : "bg-green-500/15 text-green-700 dark:text-green-400"
                                }`}
                              >
                                {isFailure ? "Failure" : "Success"}
                              </span>
                              {showLab && (
                                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-md border border-border">
                                  {labDisplay(log.labId, labNamesById)}
                                </span>
                              )}
                            </div>
                            {log.details ? (
                              <p className="text-sm text-muted-foreground mt-1 font-medium">
                                {log.details}
                              </p>
                            ) : null}
                            {log.ipAddress ? (
                              <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                                IP: {log.ipAddress}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground shrink-0 sm:pl-4">
                          <Clock className="size-3.5" />
                          <span className="tabular-nums">{log.time}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {sortedDates.length === 0 && (
            <div className="text-center py-20 px-6">
              <div className="mx-auto size-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4">
                <ShieldAlert className="size-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-black text-foreground">No records found</h3>
              <p className="text-muted-foreground mt-2 max-w-xs mx-auto font-medium">
                No security events match the current filters.
              </p>
            </div>
          )}
        </div>

        <div className="hidden print:block print:w-full print:bg-white print:text-black print-table-wrapper">
          <table className="w-full border-collapse text-[11px] text-black font-sans">
            <thead>
              <tr style={{ borderBottom: "2px solid black" }}>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  Date
                </th>
                <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  Time
                </th>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  User
                </th>
                <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  Event
                </th>
                <th className="text-center px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  Outcome
                </th>
                {showLab && (
                  <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                    Lab
                  </th>
                )}
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  Details
                </th>
                <th className="text-left px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-black bg-zinc-100">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {printRows.length > 0 ? (
                printRows.map(({ date, log }, idx) => (
                  <React.Fragment key={log.id}>
                    <tr className="align-top print:border-b print:border-black">
                      <td className="text-left px-3 print:py-4 font-semibold text-black tabular-nums">
                        {date}
                      </td>
                      <td className="text-center px-3 print:py-4 tabular-nums text-zinc-700">
                        {log.time}
                      </td>
                      <td className="text-left px-3 print:py-4 font-semibold text-black">
                        {log.user}
                      </td>
                      <td className="text-center px-3 print:py-4 font-bold text-black">
                        {securityEventLabel(log.eventType)}
                      </td>
                      <td className="text-center px-3 print:py-4 font-bold text-black">
                        {log.outcome === "failure" ? "Failure" : "Success"}
                      </td>
                      {showLab && (
                        <td className="text-left px-3 print:py-4 text-black">
                          {labDisplay(log.labId, labNamesById)}
                        </td>
                      )}
                      <td className="text-left px-3 print:py-4 text-zinc-700">
                        {log.details || "—"}
                      </td>
                      <td className="text-left px-3 print:py-4 font-mono text-zinc-700">
                        {log.ipAddress || "—"}
                      </td>
                    </tr>
                    {idx === printRows.length - 1 ? (
                      <tr>
                        <td
                          colSpan={printColCount}
                          className="px-3 py-4 text-center text-zinc-900 font-black uppercase tracking-widest"
                        >
                          End of Report
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={printColCount}
                    className="px-3 py-6 text-center text-zinc-600"
                  >
                    No security events to report for the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="hidden print:block print-footer-fixed"
        style={{ paddingLeft: "1cm", paddingRight: "1cm" }}
      >
        <div className="border-t-2 border-zinc-900 pt-3 pb-2 flex justify-end items-end">
          <span className="text-xs font-bold text-zinc-700 uppercase tracking-widest mr-3">
            Reviewed by:
          </span>
          <span className="inline-block border-b border-zinc-900 w-64 h-4" />
        </div>
      </div>
    </div>
  )
}
