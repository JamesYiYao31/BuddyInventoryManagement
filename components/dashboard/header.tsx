"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import Link from "next/link"
import {
  Bell, Search, Package, FlaskConical,
  ChevronRight, ChevronDown, UserCog, LogOut, Sun, Moon, Monitor, Palette, Check, Menu,
  MessageSquareDiff, ClipboardCheck, ShoppingCart, PackageSearch, PackageX, CheckCircle2,
} from "lucide-react"
import {
  InventoryGroup, LotInUseEntry, LabSettings, SidebarPage,
} from "@/lib/inventory-utils"
import { useBellAlerts, type BellAlertCategory, type BellAlertRow } from "@/hooks/use-bell-alerts"
import { voluntarySignOut } from "@/lib/active-session"
import { useToast } from "@/hooks/use-toast"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProfileSettingsDialog } from "@/components/dashboard/profile-settings-dialog"

interface DashboardHeaderProps {
  user?: any
  role?: "manager" | "org_admin" | "technician" | "super_admin"
  labName?: string
  inventory?: InventoryGroup[]
  activeLots?: LotInUseEntry[]
  labSettings?: LabSettings
  alertsLoading?: boolean
  onNavigate?: (page: SidebarPage) => void
  onProfileUpdated?: () => void | Promise<void>
  onMobileMenuOpen: () => void
}

interface SearchResult {
  id: string
  itemName: string
  lotNumber: string
  source: "Storage" | "Bench"
}

const MAX_BELL_ROWS = 20

const BELL_CATEGORY_META: Record<
  BellAlertCategory,
  { icon: typeof ClipboardCheck; color: string; bg: string; label: string }
> = {
  pendingApprovals: {
    icon: ClipboardCheck,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    label: "Pending Approvals",
  },
  requestsPending: {
    icon: ShoppingCart,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    label: "Requests Awaiting Approval",
  },
  orderedNotReceived: {
    icon: PackageSearch,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    label: "Ordered, Not Yet Received",
  },
  benchExpiring: {
    icon: FlaskConical,
    color: "text-red-500",
    bg: "bg-red-500/10",
    label: "Bench Expiry",
  },
  outOfStock: {
    icon: PackageX,
    color: "text-red-500",
    bg: "bg-red-500/10",
    label: "Out of Stock",
  },
}

type CategoryGroup = { cat: BellAlertCategory; rows: BellAlertRow[] }

export function DashboardHeader({
  user, role, labName, inventory = [], activeLots = [],
  onNavigate, onProfileUpdated, onMobileMenuOpen,
}: DashboardHeaderProps) {
  const router = useRouter()
  const { toast } = useToast()
  const userEmail = user?.email || "staff@lab.com"
  const userName = user?.user_metadata?.full_name || userEmail.split("@")[0]
  const initials = userName.substring(0, 2).toUpperCase()

  // ── PROFILE MENU ──
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // ── THEME (light / dark / system, OS-synced by default) ──
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) },[])
  // Until mounted, next-themes returns undefined — fall back to "system" to avoid hydration flicker.
  const activeTheme = mounted ? (theme ?? "system") : "system"
  const ThemeIcon =
    !mounted
      ? Palette
      : activeTheme === "system"
        ? Monitor
        : (resolvedTheme === "dark" ? Moon : Sun)

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    const { error } = await voluntarySignOut(user?.id)
    if (error) {
      setSigningOut(false)
      toast({
        variant: "destructive",
        title: "Sign out failed",
        description: error.message || "Please try again.",
      })
      return
    }
    router.replace("/login")
  }

  // ── BELL ALERTS ──
  const bellAlerts = useBellAlerts(role)

  // ── SEARCH STATE ──
  const [searchQuery, setSearchQuery] = useState("")
  const[searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── BELL STATE ──
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  // ── CLICK-OUTSIDE ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false)
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  },[])

  // ── BELL NOTIFICATION GROUPS (capped at MAX_BELL_ROWS total) ──
  const ORDERED_CATEGORIES: BellAlertCategory[] = [
    "pendingApprovals",
    "requestsPending",
    "orderedNotReceived",
    "benchExpiring",
    "outOfStock",
  ]

  const bellGroups: CategoryGroup[] = []
  let bellRowsShown = 0
  for (const cat of ORDERED_CATEGORIES) {
    if (bellRowsShown >= MAX_BELL_ROWS) break
    if (cat === "pendingApprovals" || cat === "requestsPending") {
      if (role !== "manager") continue
    }
    const rows = bellAlerts[cat]
    if (rows.length === 0) continue
    const visible = rows.slice(0, MAX_BELL_ROWS - bellRowsShown)
    bellRowsShown += visible.length
    bellGroups.push({ cat, rows: visible })
  }
  const bellMoreCount = bellAlerts.totalCount - bellRowsShown
  const bellBadgeText = bellAlerts.totalCount > 99 ? "99+" : String(bellAlerts.totalCount)

  const handleBellClick = () => setBellOpen((prev) => !prev)

  const handleBellRowClick = (row: BellAlertRow) => {
    setBellOpen(false)
    onNavigate?.(row.targetTab)
  }

  // ── SEARCH LOGIC ──
  const q = searchQuery.toLowerCase().trim()

  const searchResults: SearchResult[] = q.length < 2 ? [] : (() => {
    const results: SearchResult[] =[]

    for (const group of inventory) {
      for (const lot of group.lots) {
        if (
          (group.name || "").toLowerCase().includes(q) ||
          (lot.lot || "").toLowerCase().includes(q)
        ) {
          results.push({
            id: lot.lotId,
            itemName: group.name,
            lotNumber: lot.lot,
            source: "Storage",
          })
        }
        if (results.length >= 5) break
      }
      if (results.length >= 5) break
    }

    if (results.length < 5) {
      for (const lot of activeLots) {
        if (results.length >= 5) break
        if (
          (lot.itemName || "").toLowerCase().includes(q) ||
          (lot.lotNumber || "").toLowerCase().includes(q)
        ) {
          results.push({
            id: lot.id,
            itemName: lot.itemName,
            lotNumber: lot.lotNumber,
            source: "Bench",
          })
        }
      }
    }

    return results.slice(0, 5)
  })()

  const showSearchDropdown = searchFocused && q.length >= 2

  return (
    <header className="sticky top-0 z-30 flex h-12 lg:h-16 items-center justify-between border-b border-border bg-background/95 px-8 backdrop-blur supports-[backdrop-filter]:bg-background/60 print:hidden">
      <button
        type="button"
        onClick={onMobileMenuOpen}
        className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      {/* ── LEFT SIDE: TITLE & FEEDBACK BUTTON ── */}
      <div className="flex items-center gap-4">
        <h1 className="max-w-[150px] truncate text-xl font-black text-foreground tracking-tight lg:max-w-[200px] xl:max-w-none">{labName || "My Lab"}</h1>
        
        <Link 
          href="/dashboard/feedback" 
          target="_blank" 
          rel="noopener noreferrer"
          className="ml-4 inline-flex items-center gap-2 bg-muted border border-border p-1.5 lg:p-2 lg:px-4 lg:py-1.5 rounded-lg shadow-sm hover:bg-muted/80 text-xs font-bold transition-colors text-muted-foreground hover:text-foreground"
        >
          <MessageSquareDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="hidden sm:inline">Feedback & Support</span>
        </Link>
      </div>

      {/* ── RIGHT SIDE: SEARCH, ALERTS, PROFILE ── */}
      <div className="flex items-center gap-3 lg:gap-6">

        {/* ── GLOBAL SEARCH ── */}
        <div ref={searchRef} className="relative hidden lg:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            placeholder="Search reagents, lots..."
            className="w-64 h-9 bg-muted border border-border rounded-lg pl-9 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />

          {showSearchDropdown && (
            <div className="absolute top-full left-0 mt-1 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-50">
              {searchResults.length > 0 ? (
                <div className="py-1">
                  {searchResults.map(r => (
                    <div key={`${r.source}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-default">
                      {r.source === "Storage"
                        ? <Package className="size-4 text-blue-500 shrink-0" />
                        : <FlaskConical className="size-4 text-green-500 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{r.itemName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">Lot: {r.lotNumber}</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${
                        r.source === "Storage"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-green-500/10 text-green-600"
                      }`}>
                        {r.source}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No matches found for &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── NOTIFICATION BELL ── */}
        <div ref={bellRef} className="static sm:relative">
          <button
            onClick={handleBellClick}
            className="relative p-1.5 lg:p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
          >
            <Bell className="size-5" />
            {bellAlerts.totalCount > 0 && !bellAlerts.isLoading && (
              <span className="absolute right-1 top-1 flex min-w-4 h-4 px-0.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-2 ring-background">
                {bellBadgeText}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute top-full mt-1 right-0 w-screen max-w-[calc(100vw-2rem)] sm:w-96 rounded-xl border border-border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-50">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Lab Alerts</p>
                {bellAlerts.totalCount > 0 && (
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {bellAlerts.totalCount} item{bellAlerts.totalCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {bellAlerts.totalCount > 0 ? (
                <div className="max-h-[60vh] overflow-y-auto">
                  {bellGroups.map(({ cat, rows }, groupIdx) => {
                    const meta = BELL_CATEGORY_META[cat]
                    const Icon = meta.icon
                    return (
                      <div key={cat}>
                        {groupIdx > 0 && <div className="border-t border-border/60" />}
                        <p className="px-4 pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                          {meta.label}
                        </p>
                        {rows.map(row => (
                          <button
                            key={row.id}
                            onClick={() => handleBellRowClick(row)}
                            className="flex items-center gap-3 w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors group"
                          >
                            <div className={`p-1.5 rounded-lg shrink-0 ${meta.bg}`}>
                              <Icon className={`size-3.5 ${meta.color}`} />
                            </div>
                            <p className="text-sm text-foreground flex-1 min-w-0 whitespace-normal">
                              {row.message}
                            </p>
                            <ChevronRight className="size-3.5 text-muted-foreground/40 shrink-0 group-hover:text-foreground transition-colors" />
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {bellMoreCount > 0 && (
                    <p className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground border-t border-border/40">
                      and {bellMoreCount} more alert{bellMoreCount !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-5 text-muted-foreground/50" />
                  <p className="text-sm">No alerts right now</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── USER PROFILE ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex items-center gap-3 border-l border-border pl-6 outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-primary/30"
              aria-label="Open profile menu"
            >
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-sm font-black text-foreground capitalize leading-tight">{userName}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {role === "manager" ? "Manager" : "Technician"}
                </span>
              </div>

              <div className={`relative size-8 lg:size-9 rounded-xl flex items-center justify-center text-sm font-black shadow-sm transition-all group-hover:scale-105 ${
                role === "manager"
                  ? "bg-primary text-primary-foreground shadow-primary/20"
                  : "bg-muted text-muted-foreground border border-border"
              }`}>
                {initials}
              </div>

              <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={10}
            className="w-60 overflow-visible rounded-xl border-border bg-card shadow-xl p-1.5"
          >
            <DropdownMenuLabel className="px-2.5 pb-2 pt-1.5">
              <p className="text-sm font-black text-foreground capitalize leading-tight truncate">
                {userName}
              </p>
              <p className="text-[11px] font-medium text-muted-foreground truncate mt-0.5">
                {userEmail}
              </p>
              <span className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                role === "manager"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}>
                {role === "manager" ? "Manager" : "Technician"}
              </span>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setProfileDialogOpen(true)
              }}
              className="gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold focus:bg-muted"
            >
              <UserCog className="size-4" />
              Profile Settings
            </DropdownMenuItem>

            {/* ── THEME SUB-MENU (Light / Dark / System) ── */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold focus:bg-muted data-[state=open]:bg-muted">
                <ThemeIcon className="size-4" />
                <span className="flex-1">Appearance</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground capitalize">
                  {mounted ? activeTheme : ""}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={6}
                className="z-[100] w-48 rounded-xl border-border bg-card shadow-xl p-1.5"
              >
                <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Theme
                </DropdownMenuLabel>
                {mounted ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => setTheme("light")}
                      onSelect={() => setTheme("light")}
                      className={`gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold focus:bg-muted ${
                        activeTheme === "light" ? "bg-muted text-foreground" : ""
                      }`}
                    >
                      <Sun className="size-4" />
                      <span className="flex-1">Light</span>
                      {activeTheme === "light" ? (
                        <Check className="size-4 text-primary" aria-hidden />
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("dark")}
                      onSelect={() => setTheme("dark")}
                      className={`gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold focus:bg-muted ${
                        activeTheme === "dark" ? "bg-muted text-foreground" : ""
                      }`}
                    >
                      <Moon className="size-4" />
                      <span className="flex-1">Dark</span>
                      {activeTheme === "dark" ? (
                        <Check className="size-4 text-primary" aria-hidden />
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("system")}
                      onSelect={() => setTheme("system")}
                      className={`gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold focus:bg-muted ${
                        activeTheme === "system" ? "bg-muted text-foreground" : ""
                      }`}
                    >
                      <Monitor className="size-4" />
                      <span className="flex-1">System</span>
                      {activeTheme === "system" ? (
                        <Check className="size-4 text-primary" aria-hidden />
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                handleSignOut()
              }}
              disabled={signingOut}
              variant="destructive"
              className="gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-bold"
            >
              <LogOut className="size-4" />
              {signingOut ? "Signing out..." : "Log Out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>

      <ProfileSettingsDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        user={user}
        role={role ?? "technician"}
        onProfileUpdated={onProfileUpdated}
      />
    </header>
  )
}