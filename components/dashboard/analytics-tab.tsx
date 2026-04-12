"use client"

import { 
  CreditCard, 
  Trash2, 
  TrendingDown, 
  LineChart, 
  DollarSign, 
  Package, 
  ArrowUpRight 
} from "lucide-react"
import { DashboardStats, InventoryGroup, ReorderRequest } from "@/lib/inventory-utils"

interface AnalyticsTabProps {
  stats: DashboardStats | null
  requests: ReorderRequest[]
  inventory: InventoryGroup[]
}

export default function AnalyticsTab({ stats, requests, inventory }: AnalyticsTabProps) {
  // ── LOGIC: DYNAMIC CALCULATIONS ──
  const totalLots = inventory.flatMap(i => i.lots).length
  const totalPendingValue = requests
    .filter(r => r.status === "Pending")
    .reduce((sum, r) => sum + r.totalPrice, 0)

  return (
    <div className="flex flex-col gap-10 animate-in fade-in duration-700">
      
      {/* ── HEADER ── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">Lab Analytics</h1>
          <p className="text-base text-muted-foreground mt-2 font-medium">Real-time financial and operational performance metrics.</p>
        </div>
        <div className="flex gap-3">
          <div className="px-5 py-2.5 bg-primary/10 rounded-2xl border border-primary/20 flex items-center gap-2">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-black text-primary uppercase tracking-widest">Live Cloud Data</span>
          </div>
        </div>
      </div>

      {/* ── TOP ROW: IMPACT CARDS ── */}
      <div className="grid grid-cols-3 gap-8">
        {/* Monthly Spend (2-Column Wide) */}
        <div className="col-span-2 bg-card border-2 border-primary/10 p-10 rounded-[2.5rem] flex justify-between items-center shadow-xl shadow-primary/5 relative overflow-hidden group">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-primary tracking-[0.2em] mb-4">Current Monthly Spend</p>
            <div className="flex items-baseline gap-2">
              <span className="text-7xl font-black text-foreground">${stats?.totalMonthlySpend.toLocaleString() || "0"}</span>
              <span className="text-sm font-bold text-green-500 flex items-center gap-1"><ArrowUpRight className="size-4" /> 4.2% vs Last Month</span>
            </div>
            <p className="text-sm text-muted-foreground mt-6 font-medium max-w-sm leading-relaxed">
              Financial aggregation of all approved and received requests within the current billing cycle.
            </p>
          </div>
          <div className="h-32 w-48 bg-primary/10 rounded-[2rem] flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
             <CreditCard className="size-16 text-primary" />
          </div>
          {/* Subtle Background Pattern */}
          <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
             <LineChart className="size-64 text-primary" />
          </div>
        </div>

        {/* Catalog Summary */}
        <div className="bg-zinc-900 dark:bg-zinc-800 p-10 rounded-[2.5rem] text-white flex flex-col justify-between shadow-2xl">
           <div>
             <div className="p-3 bg-white/10 rounded-2xl w-fit mb-6"><Package className="size-6" /></div>
             <p className="text-xs font-black uppercase text-zinc-400 tracking-widest">Catalog Assets</p>
             <h2 className="text-6xl font-black mt-2">{inventory.length}</h2>
             <p className="text-sm text-zinc-500 font-bold uppercase mt-1">Unique Items</p>
           </div>
           <div className="pt-8 border-t border-white/10 flex justify-between items-center">
             <span className="text-xs text-zinc-400 font-bold uppercase tracking-widest">Total Active Lots</span>
             <span className="text-2xl font-black text-white">{totalLots}</span>
           </div>
        </div>
      </div>

      {/* ── MIDDLE ROW: KPI GRID ── */}
      <div className="grid grid-cols-3 gap-8">
        <div className="bg-card border border-border p-8 rounded-[2rem] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Pending Liability</p>
            <DollarSign className="size-6 text-blue-500" />
          </div>
          <p className="text-4xl font-black text-foreground">${totalPendingValue.toLocaleString()}</p>
          <div className="w-full h-1.5 bg-muted rounded-full mt-2">
            <div className="h-full bg-blue-500 rounded-full w-[45%]" />
          </div>
        </div>

        <div className="bg-card border border-border p-8 rounded-[2rem] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Waste Exposure</p>
            <Trash2 className="size-6 text-red-500" />
          </div>
          <p className="text-4xl font-black text-foreground">{stats?.expiredCount || 0}</p>
          <p className="text-xs font-bold text-red-500">Expired lots awaiting disposal</p>
        </div>

        <div className="bg-card border border-border p-8 rounded-[2rem] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Optimization Score</p>
            <TrendingDown className="size-6 text-green-500" />
          </div>
          <p className="text-4xl font-black text-foreground">92%</p>
          <p className="text-xs font-bold text-green-500">Inventory turnover is healthy</p>
        </div>
      </div>

      {/* ── BOTTOM ROW: DETAILED INSIGHTS ── */}
      <div className="grid grid-cols-2 gap-8">
        {/* Waste Progress Tracking */}
        <div className="bg-card border border-border p-10 rounded-[2.5rem] space-y-8">
          <div>
            <h2 className="text-2xl font-black text-foreground">Top Wasted Reagents</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">Items most frequently expiring before consumption.</p>
          </div>
          <div className="space-y-8">
            {[
              { name: "SuperMix Buffer", loss: "$1,200", pct: 85, color: "bg-red-500" },
              { name: "FACS Clean", loss: "$850", pct: 60, color: "bg-orange-500" },
              { name: "IAST Culture Bottle", loss: "$420", pct: 30, color: "bg-yellow-500" },
            ].map(item => (
              <div key={item.name} className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="text-base font-bold text-foreground">{item.name}</span>
                  <span className="text-sm font-black text-foreground uppercase tracking-widest">{item.loss} Loss</span>
                </div>
                <div className="w-full h-4 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${item.color} rounded-full transition-all duration-1000`} style={{width: `${item.pct}%`}} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vendor API Integration Shell */}
        <div className="bg-card border border-border p-10 rounded-[2.5rem] space-y-8">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-black text-foreground">Vendor Price API</h2>
              <p className="text-sm text-muted-foreground font-medium mt-1">Live market comparison for recurring orders.</p>
            </div>
            <div className="text-[10px] font-black bg-green-500/10 text-green-600 px-3 py-1 rounded-lg uppercase">Best Price Active</div>
          </div>
          <div className="divide-y divide-border">
             {[
               { name: "BioBall (Box of 10)", cat: "CAT-26542", current: "Merck: $120.50", best: "Thermo: $95.00" },
               { name: "DMSO (500mL)", cat: "CAT-25510", current: "Sigma: $35.00", best: "Fisher: $28.50" },
               { name: "Agar Plates (50pk)", cat: "CAT-10092", current: "VWR: $145.00", best: "Fisher: $132.00" }
             ].map((price, idx) => (
               <div key={idx} className="py-6 flex items-center justify-between first:pt-0 last:pb-0">
                 <div>
                   <p className="font-black text-base text-foreground">{price.name}</p>
                   <p className="text-xs text-muted-foreground font-mono mt-1">{price.cat}</p>
                 </div>
                 <div className="text-right">
                   <p className="text-xs text-muted-foreground line-through decoration-red-500/50">{price.current}</p>
                   <p className="text-lg font-black text-green-500 mt-0.5">{price.best}</p>
                 </div>
               </div>
             ))}
          </div>
          <button className="w-full py-5 bg-primary/10 text-primary font-black rounded-2xl text-sm hover:bg-primary/20 transition-all border border-primary/20">
            Expand Market Insights
          </button>
        </div>
      </div>

    </div>
  )
}