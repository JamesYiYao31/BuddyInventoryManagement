"use client"

import { Activity, CalendarDays, CheckCircle2, User } from "lucide-react"
import {
  SECURITY_EVENT_TYPE_KEYS,
  SECURITY_EVENT_TYPES,
} from "@/lib/inventory-utils"

export interface SecurityLogFilterControlsProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  showSearch?: boolean
  selectedEvents: Set<string>
  onSelectedEventsChange: (next: Set<string>) => void
  userFilter: string
  onUserFilterChange: (value: string) => void
  allUsers: string[]
  dateStart: string
  onDateStartChange: (value: string) => void
  dateEnd: string
  onDateEndChange: (value: string) => void
  onReset: () => void
}

/** Shared User / Event-Type / Date Range / Reset block (activity-log right-panel mirror). */
export function SecurityLogFilterControls({
  searchQuery,
  onSearchChange,
  showSearch = true,
  selectedEvents,
  onSelectedEventsChange,
  userFilter,
  onUserFilterChange,
  allUsers,
  dateStart,
  onDateStartChange,
  dateEnd,
  onDateEndChange,
  onReset,
}: SecurityLogFilterControlsProps) {
  const hasActiveFilters =
    userFilter !== "all" ||
    dateStart ||
    dateEnd ||
    selectedEvents.size > 0 ||
    (showSearch && searchQuery.trim().length > 0)

  return (
    <div className="space-y-6">
      {showSearch && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">
            Search
          </p>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search user, event, or details"
            className="w-full h-11 px-4 text-sm bg-background border border-input rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
          />
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2">
          <User className="size-4" /> Filter by User
        </p>
        <select
          value={userFilter}
          onChange={(e) => onUserFilterChange(e.target.value)}
          className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        >
          <option value="all">All Users</option>
          {allUsers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2">
            <Activity className="size-4" /> Filter by Event
          </p>
          {selectedEvents.size > 0 && (
            <button
              type="button"
              onClick={() => onSelectedEventsChange(new Set())}
              className="text-[10px] text-primary font-bold hover:underline"
            >
              RESET
            </button>
          )}
        </div>
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-2 custom-scrollbar">
          <button
            type="button"
            onClick={() => onSelectedEventsChange(new Set())}
            className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-all ${
              selectedEvents.size === 0
                ? "bg-primary/10 text-primary font-bold"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <div
              className={`size-4 rounded-md border flex items-center justify-center ${
                selectedEvents.size === 0
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-border"
              }`}
            >
              {selectedEvents.size === 0 && <CheckCircle2 className="size-3" />}
            </div>
            <span className="truncate">All Events</span>
          </button>
          {SECURITY_EVENT_TYPE_KEYS.map((eventKey) => (
            <button
              type="button"
              key={eventKey}
              onClick={() => {
                const next = new Set(selectedEvents)
                if (next.has(eventKey)) next.delete(eventKey)
                else next.add(eventKey)
                onSelectedEventsChange(next)
              }}
              className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-all ${
                selectedEvents.has(eventKey)
                  ? "bg-primary/10 text-primary font-bold"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              <div
                className={`size-4 rounded-md border flex items-center justify-center ${
                  selectedEvents.has(eventKey)
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border"
                }`}
              >
                {selectedEvents.has(eventKey) && (
                  <CheckCircle2 className="size-3" />
                )}
              </div>
              <span className="truncate">{SECURITY_EVENT_TYPES[eventKey]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2">
          <CalendarDays className="size-4" /> Date Range
        </p>
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">
              Start Date
            </label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => onDateStartChange(e.target.value)}
              className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">
              End Date
            </label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => onDateEndChange(e.target.value)}
              className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="w-full text-center px-4 py-2 text-xs font-bold text-primary rounded-xl hover:bg-primary/10 transition-all"
          >
            Reset Security Filters
          </button>
        )}
      </div>
    </div>
  )
}
