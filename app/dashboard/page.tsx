"use client"

import { useState } from "react"
import {
  Bell,
  Search,
  FlaskConical,
  ClipboardList,
  PackageOpen,
  Activity,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  Filter,
  TrendingDown,
  CalendarClock,
  User,
  Settings,
  LogOut,
  X,
  Plus,
  CheckCircle2,
} from "lucide-react"

// --- DUMMY DATA ---
const labName = "Oakwood Clinical Lab"
const userName = "James"
const userRole = "Lab Technician"

const alerts = [
  { id: 1, type: "urgent", message: "IAST Culture Bottle (Lot 100124) expires in 3 days", lot: "100124" },
  { id: 2, type: "urgent", message: "FACS Clean (Lot 2687598) expires in 5 days", lot: "2687598" },
  { id: 3, type: "warning", message: "Lot #4928 (SuperMix) is below 10% volume", lot: "4928" },
]

const lowVolumeItems = [
  { id: 1, name: "DMSO", lot: "25510", volume: 2, unit: "%" },
  { id: 2, name: "PlasmaLyte A", lot: "Y5462", volume: 2, unit: "%" },
  { id: 3, name: "Cryo Freeze Bag", lot: "24856", volume: 2, unit: "%" },
  { id: 4, name: "HSA", lot: "13584238", volume: 4, unit: "%" },
]

const upcomingExpiration = [
  { id: 1, name: "IAST Culture Bottle", lot: "100124", expiry: "Apr 2, 2026", daysLeft: 3, urgency: "critical" },
  { id: 2, name: "FACS Clean", lot: "2687598", expiry: "Mar 31, 2026", daysLeft: 5, urgency: "critical" },
  { id: 3, name: "Opened BioBall", lot: "26542-A", expiry: "Apr 14, 2026", daysLeft: 15, urgency: "warning" },
]

const activityLog = [
  { id: 1, user: "James", action: "opened a new bottle of SuperMix", time: "08:15 AM", avatar: "JM" },
  { id: 2, user: "Sarah", action: "logged 5mL usage of Buffer A", time: "09:30 AM", avatar: "SL" },
  { id: 3, user: "James", action: "flagged Lot #4521 for disposal", time: "10:45 AM", avatar: "JM" },
]

const requests = [
  { id: 1, item: "BioBall x2", status: "pending", date: "Apr 3, 2026" },
  { id: 2, item: "DMSO 500mL", status: "approved", date: "Apr 1, 2026" },
  { id: 3, item: "PCR Kit x1", status: "pending", date: "Apr 4, 2026" },
]

const vendors = ["All Vendors", "Thermo Fisher", "Sigma Aldrich", "BD Biosciences", "Miltenyi"]

type SidebarPage = "requests" | "lotinuse" | "inventory" | "activitylog"

// --- AVATAR COLORS ---
const avatarColors: Record<string, string> = {
  JM: "bg-primary text-primary-foreground",
  SL: "bg-blue-500 text-white",
  MK: "bg-purple-500 text-white",
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState<SidebarPage>("inventory")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedVendor, setSelectedVendor] = useState("All Vendors")
  const [expiryFilter, setExpiryFilter] = useState("all")
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [requestItem, setRequestItem] = useState("")
  const [requestNote, setRequestNote] = useState("")

  const navItems = [
    { id: "requests", label: "Requests", icon: ClipboardList },
    { id: "lotinuse", label: "Lot in Use", icon: PackageOpen },
    { id: "inventory", label: "Inventory", icon: FlaskConical },
    { id: "activitylog", label: "Activity Log", icon: Activity },
  ] as const

  return (
    <div className="flex h-screen flex-col bg-background font-sans text-foreground overflow-hidden">

      {/* ── TOP NAVBAR ── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6 z-20">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <img src="/buddy-logo.png" alt="Buddy" className="h-7 w-auto object-contain" />
        </div>

        {/* Center: Lab Name */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <span className="text-sm font-semibold tracking-wide text-foreground">{labName}</span>
        </div>

        {/* Right: Bell + User */}
        <div className="flex items-center gap-3">
          {/* Bell */}
          <div className="relative">
            <button
              onClick={() => { setShowNotifications(!showNotifications); setShowUserMenu(false) }}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell className="size-4" />
              {alerts.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                  {alerts.length}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-sm font-semibold">Notifications</span>
                  <button onClick={() => setShowNotifications(false)}>
                    <X className="size-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
                <div className="divide-y divide-border">
                  {alerts.map(alert => (
                    <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                      {alert.type === "urgent"
                        ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      }
                      <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User */}
          <div className="relative">
            <button
              onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false) }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                JM
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-semibold leading-none">{userName}</p>
                <p className="text-[10px] text-muted-foreground">{userRole}</p>
              </div>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-10 z-50 w-44 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="p-1">
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <User className="size-3.5" /> Profile
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Settings className="size-3.5" /> Settings
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-destructive hover:bg-destructive/10">
                    <LogOut className="size-3.5" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── BODY: SIDEBAR + MAIN + RIGHT PANEL ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ── */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-card py-4">
          <nav className="flex flex-col gap-1 px-3">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActivePage(id)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left ${
                  activePage === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                {label}
                {id === "requests" && requests.filter(r => r.status === "pending").length > 0 && (
                  <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {requests.filter(r => r.status === "pending").length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* License badge at bottom */}
          <div className="mt-auto px-3">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Lab License</p>
              <p className="text-xs font-semibold text-foreground">Enterprise Plan</p>
              <p className="text-[10px] text-muted-foreground">Until Dec 2026</p>
            </div>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex flex-1 flex-col overflow-y-auto p-6 gap-5"
          onClick={() => { setShowNotifications(false); setShowUserMenu(false) }}
        >
          {/* Page title */}
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {activePage === "requests" && "Reorder Requests"}
              {activePage === "lotinuse" && "Lot in Use"}
              {activePage === "inventory" && "Dashboard"}
              {activePage === "activitylog" && "Activity Log"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activePage === "inventory" && "Overview of your lab inventory status"}
              {activePage === "requests" && "Submit and track reorder requests"}
              {activePage === "lotinuse" && "Currently active lots in the lab"}
              {activePage === "activitylog" && "Full audit trail of lab activity"}
            </p>
          </div>

          {/* ── DASHBOARD VIEW ── */}
          {activePage === "inventory" && (
            <div className="flex flex-col gap-5">

              {/* Alerts */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="size-4 text-destructive" />
                  <h2 className="text-sm font-semibold text-foreground">Alerts</h2>
                  <span className="ml-auto text-xs text-muted-foreground cursor-pointer hover:text-foreground">View all →</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {alerts.map(alert => (
                    <div
                      key={alert.id}
                      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                        alert.type === "urgent"
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-warning/30 bg-warning/5"
                      }`}
                    >
                      {alert.type === "urgent"
                        ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      }
                      <div>
                        <p className="text-xs font-medium text-foreground leading-snug">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Lot #{alert.lot}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Low Volume + Upcoming Expiration side by side */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

                {/* Low Volume */}
                <section className="rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <TrendingDown className="size-4 text-warning" />
                    <h2 className="text-sm font-semibold text-foreground">Low Volume</h2>
                    <span className="ml-auto text-[10px] text-muted-foreground">{lowVolumeItems.length} items</span>
                  </div>
                  <div className="divide-y divide-border">
                    {lowVolumeItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-xs font-medium text-foreground">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">Lot {item.lot}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-warning"
                              style={{ width: `${Math.min(item.volume, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-warning w-8 text-right">{item.volume}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Upcoming Expiration */}
                <section className="rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <CalendarClock className="size-4 text-destructive" />
                    <h2 className="text-sm font-semibold text-foreground">Upcoming Expiration</h2>
                    <span className="ml-auto text-[10px] text-muted-foreground">{upcomingExpiration.length} items</span>
                  </div>
                  <div className="divide-y divide-border">
                    {upcomingExpiration.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-xs font-medium text-foreground">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">Lot {item.lot}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-foreground">{item.expiry}</p>
                          <p className={`text-[10px] font-semibold ${
                            item.urgency === "critical" ? "text-destructive" : "text-warning"
                          }`}>
                            {item.daysLeft} days left
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Activity Log - Last 3 */}
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Activity className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
                  <button
                    onClick={() => setActivePage("activitylog")}
                    className="ml-auto flex items-center gap-1 text-[10px] text-primary hover:underline"
                  >
                    View all <ChevronRight className="size-3" />
                  </button>
                </div>
                <div className="divide-y divide-border">
                  {activityLog.map(entry => (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColors[entry.avatar] || "bg-muted text-foreground"}`}>
                        {entry.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">
                          <span className="font-semibold">{entry.user}</span> {entry.action}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{entry.time}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* ── REQUESTS VIEW ── */}
          {activePage === "requests" && (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => setShowRequestModal(true)}
                className="flex items-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="size-4" /> New Request
              </button>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-3 border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Item</span><span>Date</span><span>Status</span>
                </div>
                <div className="divide-y divide-border">
                  {requests.map(req => (
                    <div key={req.id} className="grid grid-cols-3 px-4 py-3 items-center">
                      <span className="text-xs font-medium text-foreground">{req.item}</span>
                      <span className="text-xs text-muted-foreground">{req.date}</span>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        req.status === "approved"
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning"
                      }`}>
                        {req.status === "approved"
                          ? <CheckCircle2 className="size-3" />
                          : <AlertCircle className="size-3" />
                        }
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── LOT IN USE VIEW ── */}
          {activePage === "lotinuse" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="grid grid-cols-4 border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Item</span><span>Lot</span><span>Opened</span><span>Volume</span>
              </div>
              <div className="divide-y divide-border">
                {[{ name: "Opened BioBall", lot: "26542-A", opened: "Mar 20, 2026", volume: 15 },
                  { name: "IAST Culture Bottle", lot: "100124", opened: "Mar 25, 2026", volume: 50 }
                ].map((item, i) => (
                  <div key={i} className="grid grid-cols-4 px-4 py-3 items-center">
                    <span className="text-xs font-medium text-foreground">{item.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{item.lot}</span>
                    <span className="text-xs text-muted-foreground">{item.opened}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${item.volume}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-foreground">{item.volume}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ACTIVITY LOG VIEW ── */}
          {activePage === "activitylog" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="divide-y divide-border">
                {[...activityLog,
                  { id: 4, user: "Mike", action: "initiated reorder for PCR Kit", time: "11:20 AM", avatar: "MK" },
                  { id: 5, user: "Sarah", action: "logged 10mL usage of Taq Poly", time: "01:05 PM", avatar: "SL" },
                  { id: 6, user: "James", action: "received new shipment of DNA Kit", time: "02:30 PM", avatar: "JM" },
                ].map(entry => (
                  <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColors[entry.avatar] || "bg-muted text-foreground"}`}>
                      {entry.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground">
                        <span className="font-semibold">{entry.user}</span> {entry.action}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{entry.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ── RIGHT PANEL ── */}
        <aside className="flex w-56 shrink-0 flex-col border-l border-border bg-card p-4 gap-5 overflow-y-auto">

          {/* Search */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Reagent, lot…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Filter by Vendor */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              <Filter className="inline size-3 mr-1" />Filter by Vendor
            </label>
            <div className="flex flex-col gap-1">
              {vendors.map(v => (
                <button
                  key={v}
                  onClick={() => setSelectedVendor(v)}
                  className={`rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedVendor === v
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Filter by Expiration */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              <CalendarClock className="inline size-3 mr-1" />Filter by Expiration
            </label>
            <div className="flex flex-col gap-1">
              {[
                { value: "all", label: "All items" },
                { value: "7", label: "Within 7 days" },
                { value: "30", label: "Within 30 days" },
                { value: "90", label: "Within 90 days" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setExpiryFilter(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                    expiryFilter === opt.value
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── NEW REQUEST MODAL ── */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">New Reorder Request</h2>
              <button onClick={() => setShowRequestModal(false)}>
                <X className="size-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-foreground">Item Name</label>
                <input
                  type="text"
                  value={requestItem}
                  onChange={e => setRequestItem(e.target.value)}
                  placeholder="e.g. BioBall x2"
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-foreground">Notes</label>
                <textarea
                  value={requestNote}
                  onChange={e => setRequestNote(e.target.value)}
                  placeholder="Any additional notes for the manager…"
                  rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
              <button
                onClick={() => setShowRequestModal(false)}
                className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}