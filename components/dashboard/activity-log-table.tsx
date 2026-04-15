"use client"

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
import { ActivityLogEntry, ACTION_STYLES } from "@/lib/inventory-utils"

interface ActivityLogTabProps {
  logs: ActivityLogEntry[]
}

export default function ActivityLogTab({ logs }: ActivityLogTabProps) {
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

  const handlePrint = () => window.print()

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
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* ── SCREEN HEADER (Hidden on Print) ── */}
      <div className="flex items-end justify-between print:hidden">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">Activity Log</h1>
          <p className="text-base text-muted-foreground mt-2 font-medium">Complete immutable audit trail for ISO/CAP compliance.</p>
        </div>
        <div className="flex gap-3">
          <div className="px-5 py-2.5 bg-muted rounded-2xl border border-border flex items-center gap-2">
            <User className="size-4 text-muted-foreground" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Logged as James (Admin)</span>
          </div>
          <button onClick={handlePrint} className="flex items-center gap-2 rounded-xl border border-border bg-card text-foreground px-6 py-2.5 text-sm font-bold hover:bg-muted transition-all">
            <Printer className="size-5 text-muted-foreground" /> Print Log
          </button>
        </div>
      </div>

      {/* ── PROFESSIONAL PRINT HEADER (Visible ONLY on Print) ── */}
      <div className="hidden print:block space-y-6 mb-10 border-b-2 border-zinc-900 pb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter text-zinc-900">BuddyLab - Audit & Activity Log</h1>
            <p className="text-zinc-500 font-medium mt-1">BuddyLab Tracker | Clinical Laboratory Management</p>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold uppercase text-zinc-400 tracking-widest">Document Type</div>
            <div className="text-lg font-black text-emerald-600">AUDIT TRAIL</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-8 pt-4">
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total Entries</p>
            <p className="text-lg font-bold text-zinc-900">{logs.length} records</p>
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
      </div>

      {/* ── TIMELINE STREAM ── */}
      <div className="relative space-y-12 pb-20">
        {/* Vertical Timeline Line */}
        <div className="absolute left-[31px] top-4 bottom-0 w-0.5 bg-border border-dashed border-l-2 print:hidden" />

        {sortedDates.map((date) => (
          <div key={date} className="relative space-y-6">
            
            {/* DATE HEADER */}
            <div className="sticky top-0 z-10 py-2 print:static">
              <div className="inline-flex items-center gap-3 px-6 py-2 bg-background border-2 border-border rounded-full shadow-sm print:border-zinc-300">
                <span className="text-sm font-black text-foreground uppercase tracking-widest print:text-zinc-900">
                  {new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>

            {/* LOG ITEMS */}
            <div className="space-y-4 ml-16 print:ml-0 print:space-y-3">
              {groupedLogs[date].map((log) => (
                <div 
                  key={log.id} 
                  className="group relative bg-card border border-border p-6 rounded-[2rem] shadow-sm hover:shadow-md hover:border-primary/20 transition-all flex items-center justify-between print:rounded-xl print:border-zinc-200 print:shadow-none print:p-4"
                >
                  {/* Action Icon (Floats on the timeline line) */}
                  <div className={`absolute -left-[49px] p-3 rounded-full border-4 border-background shadow-sm z-10 transition-transform group-hover:scale-110 print:hidden ${ACTION_STYLES[log.actionType]}`}>
                    {getActionIcon(log.actionType)}
                  </div>

                  {/* Content */}
                  <div className="flex items-center gap-6 flex-1 print:gap-3">
                    {/* User Avatar */}
                    <div className="size-12 rounded-2xl bg-muted flex items-center justify-center text-sm font-black text-muted-foreground border border-border shrink-0 print:size-8 print:rounded-lg print:text-xs print:text-zinc-600">
                      {log.userInitials}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-foreground print:text-zinc-900">{log.user}</span>
                        <span className="text-muted-foreground font-medium print:text-zinc-500">{log.actionType.toLowerCase()}</span>
                        <span className="font-bold text-primary px-2 py-0.5 bg-primary/5 rounded-lg print:text-zinc-900 print:bg-zinc-100">{log.itemName}</span>
                        {log.lotNumber && (
                          <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-md border border-border print:text-zinc-600 print:border-zinc-300">
                            Lot: {log.lotNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 font-medium print:text-zinc-500">{log.details}</p>
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-xs font-black text-muted-foreground uppercase tracking-widest print:text-zinc-600">{log.time}</p>
                    <div className={`inline-flex items-center gap-1.5 mt-1 px-3 py-1 rounded-full text-[10px] font-bold print:border print:bg-transparent ${ACTION_STYLES[log.actionType]}`}>
                      {log.actionType}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-40 text-center print:py-20">
            <div className="p-10 bg-muted rounded-[3rem] mb-6 print:hidden">
              <Search className="size-12 text-muted-foreground opacity-20" />
            </div>
            <h3 className="text-xl font-black text-foreground print:text-zinc-900">No records found</h3>
            <p className="text-muted-foreground mt-2 max-w-xs mx-auto font-medium print:text-zinc-500">The lab activity stream is currently empty. Start by adding reagents to the inventory.</p>
          </div>
        )}
      </div>

      {/* ── PRINT FOOTER (Visible ONLY on Print) ── */}
      <div className="hidden print:block mt-20 pt-10 border-t border-zinc-200">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">End of Report</p>
            <p className="text-xs text-zinc-500 italic">This document is an immutable audit trail generated for ISO/CAP compliance review.</p>
          </div>
          <div className="text-right">
            <div className="h-px w-48 bg-zinc-300 mb-2" />
            <p className="text-sm font-bold text-zinc-900">Reviewing Signature</p>
          </div>
        </div>
      </div>

    </div>
  )
}