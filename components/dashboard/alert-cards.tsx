"use client"

import { DashboardStats } from "@/lib/inventory-utils"
import { Timer, PackageSearch, CreditCard, XCircle } from "lucide-react"

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

      {/* ── KPI STATS GRID ── */}
      <div className="grid w-full grid-cols-2 gap-3 overflow-hidden lg:grid-cols-4 lg:gap-4">
        {kpis.map((item, i) => (
          <div 
            key={i} 
            className={`group min-w-0 overflow-hidden bg-card border-2 ${item.border} p-8 rounded-[2.5rem] flex flex-col gap-4 shadow-sm transition-all hover:shadow-md hover:scale-[1.01]`}
          >
            <div className="flex items-center justify-between">
              <div className={`p-4 rounded-[1.5rem] ${item.bg} group-hover:scale-110 transition-transform`}>
                <item.icon className={`size-8 lg:size-12 ${item.color}`} />
              </div>
              <div className={`text-5xl font-black tracking-tighter ${item.color}`}>
                {item.value}
              </div>
            </div>
            <div>
              <p className="text-[10px] lg:text-xs font-black uppercase text-muted-foreground tracking-[0.2em]">
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