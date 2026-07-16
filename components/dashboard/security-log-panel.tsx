"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  fetchSecurityLogsFromSupabase,
  filterSecurityLogs,
  securityEventLabel,
  type SecurityLogEntry,
} from "@/lib/inventory-utils"
import SecurityLogTable from "@/components/dashboard/security-log-table"
import { SecurityLogFilterControls } from "@/components/dashboard/security-log-filters"
import { Loader2 } from "lucide-react"

interface SecurityLogPanelProps {
  timezone?: string
  showLab?: boolean
  labNamesById?: Record<string, string>
  currentUserName?: string
  currentUserRole?: string
}

/** Self-contained security log viewer for org-admin / super-admin sections. */
export function SecurityLogPanel({
  timezone = "UTC",
  showLab = false,
  labNamesById,
  currentUserName,
  currentUserRole,
}: SecurityLogPanelProps) {
  const [logs, setLogs] = useState<SecurityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [userFilter, setUserFilter] = useState("all")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchSecurityLogsFromSupabase(timezone)
    setLogs(data)
    setLoading(false)
  }, [timezone])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      filterSecurityLogs(logs, {
        searchQuery,
        selectedEvents,
        userFilter,
        dateStart,
        dateEnd,
      }),
    [logs, searchQuery, selectedEvents, userFilter, dateStart, dateEnd]
  )

  const allUsers = useMemo(
    () => Array.from(new Set(logs.map((l) => l.user).filter(Boolean))).sort(),
    [logs]
  )

  const resetFilters = () => {
    setSearchQuery("")
    setSelectedEvents(new Set())
    setUserFilter("all")
    setDateStart("")
    setDateEnd("")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="w-full min-w-0 lg:flex-1">
        <SecurityLogTable
          logs={filtered}
          currentUserName={currentUserName}
          currentUserRole={currentUserRole}
          timezone={timezone}
          showLab={showLab}
          labNamesById={labNamesById}
          embedded
          filterUser={userFilter}
          filterEvent={
            selectedEvents.size > 0
              ? Array.from(selectedEvents)
                  .map((k) => securityEventLabel(k))
                  .join(", ")
              : undefined
          }
          filterDateStart={dateStart}
          filterDateEnd={dateEnd}
        />
      </div>
      <aside className="w-full lg:w-72 shrink-0 print:hidden">
        <div className="sticky top-0 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <SecurityLogFilterControls
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            showSearch
            selectedEvents={selectedEvents}
            onSelectedEventsChange={setSelectedEvents}
            userFilter={userFilter}
            onUserFilterChange={setUserFilter}
            allUsers={allUsers}
            dateStart={dateStart}
            onDateStartChange={setDateStart}
            dateEnd={dateEnd}
            onDateEndChange={setDateEnd}
            onReset={resetFilters}
          />
        </div>
      </aside>
    </div>
  )
}
