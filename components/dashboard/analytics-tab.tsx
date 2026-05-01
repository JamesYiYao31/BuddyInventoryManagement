"use client"

import { useState, useMemo } from "react"
import {
  Skull, AlertTriangle, TrendingUp, TrendingDown,
  DollarSign, Activity, ShieldX, Filter,
} from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import {
  InventoryGroup, ReorderRequest, ActivityLogEntry, LabSettings,
  daysUntilExpiry, getLotTotalCount, getLabCurrentDateStr,
} from "@/lib/inventory-utils"

// ── Types ──

interface AnalyticsTabProps {
  inventory: InventoryGroup[]
  requests: ReorderRequest[]
  activityLogs: ActivityLogEntry[]
  labSettings: LabSettings
  userRole: "manager" | "technician"
}

// ── Helpers ──

function getLabNow(tz: string): Date {
  return new Date(getLabCurrentDateStr(tz) + "T00:00:00")
}

function isInTimeframe(dateStr: string, frame: "month" | "quarter" | "year", tz: string): boolean {
  if (!dateStr) return false
  const labNow = getLabNow(tz)
  const d = new Date(dateStr)
  const sameYear = d.getFullYear() === labNow.getFullYear()
  if (frame === "year") return sameYear
  if (frame === "month") return sameYear && d.getMonth() === labNow.getMonth()
  if (frame === "quarter") {
    const q = Math.floor(labNow.getMonth() / 3)
    const dq = Math.floor(d.getMonth() / 3)
    return sameYear && q === dq
  }
  return false
}

// ── Component ──

export default function AnalyticsTab({
  inventory, requests, activityLogs, labSettings, userRole,
}: AnalyticsTabProps) {

  // ── Role Gate ──
  if (userRole === "technician") {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center space-y-4 animate-in fade-in duration-500">
        <div className="p-5 rounded-full bg-red-500/10">
          <ShieldX className="size-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-black text-foreground">Access Restricted</h2>
        <p className="text-muted-foreground max-w-sm">
          Analytics are available to Lab Managers only. Contact your lab manager for access.
        </p>
      </div>
    )
  }

  return <AnalyticsDashboard
    inventory={inventory}
    requests={requests}
    activityLogs={activityLogs}
    labSettings={labSettings}
  />
}

// ── Manager Dashboard (avoids hook-after-early-return issues) ──

function AnalyticsDashboard({
  inventory, requests, activityLogs, labSettings,
}: Omit<AnalyticsTabProps, "userRole">) {

  const tz = labSettings.labTimezone
  const allLots = useMemo(() => inventory.flatMap(g => g.lots.map(l => ({ ...l, itemName: g.name }))), [inventory])

  // ────────────────────────────────────────────────
  // 1. WASTE METRICS
  // ────────────────────────────────────────────────
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {}
    const sorted = [...requests].sort((a, b) => new Date(b.dateRequested).getTime() - new Date(a.dateRequested).getTime())
    for (const r of sorted) {
      const key = r.itemName.toLowerCase()
      if (!map[key] && r.unitPrice > 0) map[key] = r.unitPrice
    }
    return map
  }, [requests])

  const wasteData = useMemo(() => {
    const expired = allLots.filter(l => {
      const days = daysUntilExpiry(l.expiry, tz)
      return days < 0 && getLotTotalCount(l) > 0
    })
    const items = expired.map(l => {
      const price = priceMap[l.itemName.toLowerCase()] || 0
      return { ...l, estimatedLoss: getLotTotalCount(l) * price }
    })
    const totalLoss = items.reduce((sum, i) => sum + i.estimatedLoss, 0)
    return { items, totalLoss }
  }, [allLots, priceMap, tz])

  // ────────────────────────────────────────────────
  // 2. RUNNING OUT
  // ────────────────────────────────────────────────
  const lowStockItems = useMemo(() => {
    return allLots
      .filter(l => {
        const days = daysUntilExpiry(l.expiry, tz)
        return getLotTotalCount(l) <= labSettings.lowStockThreshold && days >= 0
      })
      .sort((a, b) => getLotTotalCount(a) - getLotTotalCount(b))
  }, [allLots, labSettings.lowStockThreshold, tz])

  // ────────────────────────────────────────────────
  // 3. MOST / LEAST USED
  // ────────────────────────────────────────────────
  const { mostUsed, leastUsed } = useMemo(() => {
    const usageActions = ["Used", "Disposed"]
    const usageLogs = activityLogs.filter(l => usageActions.includes(l.actionType) && l.itemName)
    const counts: Record<string, number> = {}
    for (const log of usageLogs) {
      counts[log.itemName] = (counts[log.itemName] || 0) + 1
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return {
      mostUsed: sorted.slice(0, 3).map(([name, count]) => ({ name, count })),
      leastUsed: sorted.slice(-3).reverse().map(([name, count]) => ({ name, count })),
    }
  }, [activityLogs])

  // ────────────────────────────────────────────────
  // 4. EXPENSE FILTERING
  // ────────────────────────────────────────────────
  const [expenseItem, setExpenseItem] = useState("all")
  const [expenseTimeframe, setExpenseTimeframe] = useState<"month" | "quarter" | "year">("month")

  const expenseItemNames = useMemo(() =>
    Array.from(new Set(requests.map(r => r.itemName).filter(Boolean))).sort(),
  [requests])

  const filteredExpenses = useMemo(() => {
    return requests.filter(r => {
      const matchItem = expenseItem === "all" || r.itemName === expenseItem
      const matchTime = isInTimeframe(r.dateRequested, expenseTimeframe, tz)
      return matchItem && matchTime
    })
  }, [requests, expenseItem, expenseTimeframe, tz])

  const totalExpense = useMemo(() =>
    filteredExpenses.reduce((sum, r) => sum + r.totalPrice, 0),
  [filteredExpenses])

  // ────────────────────────────────────────────────
  // 5. GLOBAL HEALTH DONUT
  // ────────────────────────────────────────────────
  const healthData = useMemo(() => {
    let healthy = 0, lowStock = 0, expiringSoon = 0, expired = 0
    for (const lot of allLots) {
      const days = daysUntilExpiry(lot.expiry, tz)
      const units = getLotTotalCount(lot)
      if (days < 0) { expired++; continue }
      if (days <= labSettings.expiringSoonDays) { expiringSoon++; continue }
      if (units <= labSettings.lowStockThreshold) { lowStock++; continue }
      healthy++
    }
    return [
      { name: "Healthy", value: healthy, color: "#22c55e" },
      { name: "Low Stock", value: lowStock, color: "#eab308" },
      { name: "Expiring Soon", value: expiringSoon, color: "#f97316" },
      { name: "Expired", value: expired, color: "#ef4444" },
    ]
  }, [allLots, tz, labSettings.expiringSoonDays, labSettings.lowStockThreshold])

  const totalLots = allLots.length

  // ────────────────────────────────────────────────
  // 6. VENDOR PRICE COMPARISON
  // ────────────────────────────────────────────────
  const vendorComparisons = useMemo(() => {
    const itemVendorMap: Record<string, Record<string, number>> = {}
    for (const r of requests) {
      if (!r.itemName || !r.vendor || !r.unitPrice) continue
      const key = r.itemName
      if (!itemVendorMap[key]) itemVendorMap[key] = {}
      const existing = itemVendorMap[key][r.vendor]
      if (!existing || r.unitPrice < existing) {
        itemVendorMap[key][r.vendor] = r.unitPrice
      }
    }
    // Also include items table vendor data matched to request prices
    const results: { itemName: string; vendors: { vendor: string; price: number }[] }[] = []
    for (const [itemName, vendors] of Object.entries(itemVendorMap)) {
      const vendorList = Object.entries(vendors).map(([vendor, price]) => ({ vendor, price }))
      if (vendorList.length >= 2) {
        vendorList.sort((a, b) => a.price - b.price)
        results.push({ itemName, vendors: vendorList })
      }
    }
    return results.sort((a, b) => a.itemName.localeCompare(b.itemName))
  }, [requests])

  // ── RENDER ──

  const timeframeLabels: Record<string, string> = { month: "Current Month", quarter: "Current Quarter", year: "Current Year" }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">Lab Analytics</h1>
          <p className="text-base text-muted-foreground mt-2 font-medium">
            Financial, operational, and inventory health metrics — sourced from live lab data.
          </p>
        </div>
        <div className="px-5 py-2.5 bg-primary/10 rounded-2xl border border-primary/20 flex items-center gap-2">
          <div className="size-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-black text-primary uppercase tracking-widest">Live Data</span>
        </div>
      </div>

      {/* ── ROW 1: Waste + Running Out ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 1 · Waste Metrics */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-foreground">Waste Exposure</h2>
              <p className="text-xs text-muted-foreground mt-1">Expired lots still holding stock</p>
            </div>
            <Skull className="size-6 text-red-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-red-500">${wasteData.totalLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-sm font-bold text-muted-foreground">estimated loss</span>
          </div>
          {wasteData.items.length > 0 ? (
            <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
              {wasteData.items.map(item => (
                <div key={item.lotId} className="flex items-center justify-between px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/10">
                  <div>
                    <p className="text-sm font-bold text-foreground">{item.itemName}</p>
                    <p className="text-xs text-muted-foreground">Lot {item.lot} · {getLotTotalCount(item)} units remaining</p>
                  </div>
                  <span className="text-sm font-black text-red-500">
                    ${item.estimatedLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-4 text-center">No expired lots with remaining stock.</p>
          )}
        </div>

        {/* 2 · Running Out */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-foreground">Running Out</h2>
              <p className="text-xs text-muted-foreground mt-1">Lots at or below {labSettings.lowStockThreshold} units</p>
            </div>
            <AlertTriangle className="size-6 text-yellow-500" />
          </div>
          <div className="text-4xl font-black text-yellow-500">{lowStockItems.length} <span className="text-sm font-bold text-muted-foreground">lots</span></div>
          {lowStockItems.length > 0 ? (
            <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
              {lowStockItems.map(item => (
                <div key={item.lotId} className="flex items-center justify-between px-4 py-3 rounded-xl bg-yellow-500/5 border border-yellow-500/10">
                  <div>
                    <p className="text-sm font-bold text-foreground">{item.itemName}</p>
                    <p className="text-xs text-muted-foreground">Lot {item.lot}</p>
                  </div>
                  <span className="text-sm font-black text-yellow-600">{getLotTotalCount(item)} units</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-4 text-center">All lots above threshold.</p>
          )}
        </div>
      </div>

      {/* ── ROW 2: Most/Least Used + Expenses ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 3 · Most / Least Used */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-foreground">Usage Ranking</h2>
            <Activity className="size-6 text-primary" />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="size-4 text-green-500" />
                <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Most Used</p>
              </div>
              {mostUsed.length > 0 ? mostUsed.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs font-black text-muted-foreground w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.count} events</p>
                  </div>
                </div>
              )) : <p className="text-xs text-muted-foreground italic">No usage data</p>}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="size-4 text-orange-500" />
                <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Least Used</p>
              </div>
              {leastUsed.length > 0 ? leastUsed.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs font-black text-muted-foreground w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.count} events</p>
                  </div>
                </div>
              )) : <p className="text-xs text-muted-foreground italic">No usage data</p>}
            </div>
          </div>
        </div>

        {/* 4 · Expense Filtering */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-foreground">Expense Tracker</h2>
              <p className="text-xs text-muted-foreground mt-1">Request spend by item &amp; timeframe</p>
            </div>
            <DollarSign className="size-6 text-green-500" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">Item</label>
              <select
                value={expenseItem}
                onChange={e => setExpenseItem(e.target.value)}
                className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              >
                <option value="all">All Items</option>
                {expenseItemNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">Timeframe</label>
              <select
                value={expenseTimeframe}
                onChange={e => setExpenseTimeframe(e.target.value as "month" | "quarter" | "year")}
                className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              >
                <option value="month">Current Month</option>
                <option value="quarter">Current Quarter</option>
                <option value="year">Current Year</option>
              </select>
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-foreground">${totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-sm font-bold text-muted-foreground">{timeframeLabels[expenseTimeframe]}</span>
          </div>

          {filteredExpenses.length > 0 ? (
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {filteredExpenses.map(r => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-muted/50">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{r.itemName}</p>
                    <p className="text-xs text-muted-foreground">{r.vendor} · Qty {r.orderQty} · {r.status}</p>
                  </div>
                  <span className="text-sm font-black text-foreground shrink-0 ml-3">${r.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-4 text-center">No requests in this period.</p>
          )}
        </div>
      </div>

      {/* ── ROW 3: Health Donut + Vendor Comparison ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 5 · Global Health Donut */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div>
            <h2 className="text-lg font-black text-foreground">Inventory Health</h2>
            <p className="text-xs text-muted-foreground mt-1">Distribution across {totalLots} tracked lots</p>
          </div>
          {totalLots > 0 ? (
            <div className="flex items-center gap-8">
              <div className="w-48 h-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={healthData.filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {healthData.filter(d => d.value > 0).map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const pct = totalLots > 0 ? ((d.value / totalLots) * 100).toFixed(1) : "0"
                        return (
                          <div className="bg-background border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
                            <p className="font-bold">{d.name}</p>
                            <p className="text-muted-foreground">{d.value} lots ({pct}%)</p>
                          </div>
                        )
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 flex-1">
                {healthData.map(d => {
                  const pct = totalLots > 0 ? ((d.value / totalLots) * 100).toFixed(1) : "0"
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-sm font-bold text-foreground flex-1">{d.name}</span>
                      <span className="text-sm font-black text-foreground">{d.value}</span>
                      <span className="text-xs text-muted-foreground w-14 text-right">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-8 text-center">No inventory lots to analyze.</p>
          )}
        </div>

        {/* 6 · Vendor Price Comparison */}
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-foreground">Vendor Price Comparison</h2>
              <p className="text-xs text-muted-foreground mt-1">Items ordered from multiple vendors</p>
            </div>
            <Filter className="size-6 text-primary" />
          </div>

          {vendorComparisons.length > 0 ? (
            <div className="max-h-72 overflow-y-auto space-y-4 pr-1">
              {vendorComparisons.map(comp => {
                const best = comp.vendors[0].price
                return (
                  <div key={comp.itemName} className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted/50">
                      <p className="text-sm font-black text-foreground">{comp.itemName}</p>
                    </div>
                    <div className="divide-y divide-border">
                      {comp.vendors.map((v, i) => (
                        <div key={v.vendor} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-sm text-foreground">{v.vendor}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-black ${i === 0 ? "text-green-500" : "text-foreground"}`}>
                              ${v.price.toFixed(2)}
                            </span>
                            {i === 0 && (
                              <span className="text-[10px] font-black bg-green-500/10 text-green-600 px-2 py-0.5 rounded-md uppercase">Best</span>
                            )}
                            {i > 0 && (
                              <span className="text-[10px] font-bold text-red-500">
                                +${(v.price - best).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-8 text-center">
              No items with multiple vendor records found. Order the same item from different vendors to see comparisons.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
