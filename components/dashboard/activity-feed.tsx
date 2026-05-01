"use client"

import { ActivityLogEntry, ACTION_STYLES } from "@/lib/inventory-utils"

interface ActivityFeedProps {
  logs: ActivityLogEntry[]
}

export function ActivityFeed({ logs }: ActivityFeedProps) {
  // Only show the 5 most recent activities on the dashboard
  const recentLogs = logs.slice(0, 5)
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-muted/20">
        <div>
          <h2 className="text-base font-bold text-foreground">Recent Activity</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Latest actions across the lab</p>
        </div>
      </div>
      <div className="divide-y divide-border/50 flex-1 overflow-y-auto">
        {recentLogs.length > 0 ? recentLogs.map((log) => (
          <div key={log.id} className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-muted/20">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${ACTION_STYLES[log.actionType]}`}>
              {log.userInitials}
            </div>
            <div className="flex-1 space-y-1 min-w-0">
              <p className="text-sm text-foreground leading-snug">
                <span className="font-bold">{log.user}</span> {log.details}
              </p>
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                <span>{log.date} at {log.time}</span>
                <span>•</span>
                <span>Lot: {log.lotNumber || "N/A"}</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="p-8 text-center text-sm text-muted-foreground">No recent activity.</div>
        )}
      </div>
    </div>
  )
}
