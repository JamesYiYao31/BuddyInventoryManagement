"use client"

import { DashboardStats } from "@/lib/inventory-utils"
import { AlertTriangle, Timer, PackageSearch, CreditCard, ArrowRight, XCircle } from "lucide-react"

interface AlertCardsProps {
  stats: DashboardStats | null
}

export function AlertCards({ stats }: AlertCardsProps) {
  // ── 1. KPI DATA MAPPING ──
  const kpis = [
    { 
      label: "Expired Lots", 
      value: stats?.expiredCount || 0, 
      color: "text-red-500", 
      icon: XCircle, 
      bg: "bg-red-500/10",
      border: "border-red-500/20"
    },
    { 
      label: "Expiring < 7 Days", 
      value: stats?.urgentCount || 0, 
      color: "text-orange-500", 
      icon: Timer, 
      bg: "bg-orange-500/10",
      border: "border-orange-500/20"
    },
    { 
      label: "Low Stock Items", 
      value: stats?.lowStockCount || 0, 
      color: "text-yellow-600", 
      icon: PackageSearch, 
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20"
    },
    { 
      label: "Pending Requests", 
      value: stats?.pendingRequests || 0, 
      color: "text-blue-600", 
      icon: CreditCard, 
      bg: "bg-blue-500/10",
      border: "border-blue-500/20"
    },
  ]

  return (
    <div className="space-y-6">
      
      {/* ── 2. LIVE ACTION BANNERS (Conditional) ── */}
      {(stats?.expiredCount || 0) > 0 && (
        <div className="flex items-center justify-between p-6 rounded-[2rem] bg-red-600 text-white shadow-xl shadow-red-600/20 animate-in slide-in-from-top duration-500">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
              <AlertTriangle className="size-8 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">Critical Action Required</h3>
              <p className="text-red-100 text-sm font-medium">There are {stats?.expiredCount} expired lots that must be disposed of and logged immediately.</p>
            </div>
          </div>
          <button className="px-6 py-3 bg-white text-red-600 rounded-xl font-bold text-sm hover:bg-red-50 transition-colors flex items-center gap-2">
            Go to Inventory <ArrowRight className="size-4" />
          </button>
        </div>
      )}

      {/* ── 3. KPI STATS GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((item, i) => (
          <div 
            key={i} 
            className={`group bg-card border-2 ${item.border} p-8 rounded-[2.5rem] flex flex-col gap-4 shadow-sm transition-all hover:shadow-md hover:scale-[1.01]`}
          >
            <div className="flex items-center justify-between">
              <div className={`p-4 rounded-[1.5rem] ${item.bg} group-hover:scale-110 transition-transform`}>
                <item.icon className={`size-8 ${item.color}`} />
              </div>
              <div className={`text-5xl font-black tracking-tighter ${item.color}`}>
                {item.value}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em]">
                {item.label}
              </p>
              <div className="mt-1 h-1 w-8 bg-border rounded-full group-hover:w-full group-hover:bg-primary/30 transition-all duration-500" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}