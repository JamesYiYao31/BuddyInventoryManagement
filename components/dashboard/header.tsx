"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import Link from "next/link"
import {
  Bell, Search, XCircle, Timer, PackageSearch, Package, FlaskConical,
  ChevronRight, ChevronDown, UserCog, LogOut, Sun, Moon, Monitor, Palette, Check, Menu,
} from "lucide-react"
import {
  DashboardStats, InventoryGroup, LotInUseEntry, LabSettings, SidebarPage,
  daysUntilExpiry, getEarliestExpiry
} from "@/lib/inventory-utils"
import { supabase } from "@/lib/supabase"
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
  role?: "manager" | "technician"
  labName?: string
  stats?: DashboardStats | null
  inventory?: InventoryGroup[]
  activeLots?: LotInUseEntry[]
  labSettings?: LabSettings
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

type AlertCategory = "expired" | "expiring" | "lowstock"

interface NotificationItem {
  id: string
  message: string
  category: AlertCategory
  targetTab: SidebarPage
}

const CATEGORY_META: Record<AlertCategory, { icon: typeof XCircle; color: string; bg: string }> = {
  expired:  { icon: XCircle,       color: "text-red-500",    bg: "bg-red-500/10" },
  expiring: { icon: Timer,         color: "text-orange-500", bg: "bg-orange-500/10" },
  lowstock: { icon: PackageSearch,  color: "text-yellow-600", bg: "bg-yellow-500/10" },
}

const MAX_NOTIFICATIONS = 12

export function DashboardHeader({
  user, role, labName, stats, inventory = [], activeLots =[],
  labSettings, onNavigate, onProfileUpdated, onMobileMenuOpen,
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
    const { error } = await supabase.auth.signOut()
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

  const tz = labSettings?.labTimezone ?? "America/Chicago"
  const lowThreshold = labSettings?.lowStockThreshold ?? 5

  // ── SEARCH STATE ──
  const [searchQuery, setSearchQuery] = useState("")
  const[searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── BELL STATE ──
  const [bellOpen, setBellOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
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

  // ── GENERATE SPECIFIC NOTIFICATIONS ──
  const notifications: NotificationItem[] = useMemo(() => {
    const items: NotificationItem[] =[]

    for (const group of inventory) {
      let groupTotalUnits = 0

      for (const lot of group.lots) {
        groupTotalUnits += lot.totalUnits ?? 0
        const days = daysUntilExpiry(lot.expiry, tz)

        if (days < 0 && lot.expiry) {
          items.push({
            id: `exp-${lot.lotId}`,
            message: `${group.name} (Lot ${lot.lot}) is Expired`,
            category: "expired",
            targetTab: "inventory",
          })
        } else if (days >= 0 && days <= 7 && lot.expiry) {
          items.push({
            id: `urg-${lot.lotId}`,
            message: `${group.name} (Lot ${lot.lot}) expires in ${days}d`,
            category: "expiring",
            targetTab: "inventory",
          })
        }

        if (items.length >= MAX_NOTIFICATIONS) break
      }

      if (items.length < MAX_NOTIFICATIONS && groupTotalUnits <= lowThreshold) {
        items.push({
          id: `low-${group.itemId}`,
          message: `${group.name} is low stock (${groupTotalUnits} units)`,
          category: "lowstock",
          targetTab: "inventory",
        })
      }

      if (items.length >= MAX_NOTIFICATIONS) break
    }

    if (items.length < MAX_NOTIFICATIONS) {
      for (const lot of activeLots) {
        const eff = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
        const days = daysUntilExpiry(eff, tz)

        if (days < 0) {
          items.push({
            id: `bench-exp-${lot.id}`,
            message: `${lot.itemName} (Lot ${lot.lotNumber}) expired on bench`,
            category: "expired",
            targetTab: "lotinuse",
          })
        } else if (days >= 0 && days <= 7) {
          items.push({
            id: `bench-urg-${lot.id}`,
            message: `${lot.itemName} (Lot ${lot.lotNumber}) bench expiry in ${days}d`,
            category: "expiring",
            targetTab: "lotinuse",
          })
        }

        if (items.length >= MAX_NOTIFICATIONS) break
      }
    }

    return items.slice(0, MAX_NOTIFICATIONS)
  }, [inventory, activeLots, tz, lowThreshold])

  // Mark unread whenever notifications change and there are new ones
  useEffect(() => {
    if (notifications.length > 0) setHasUnread(true)
  }, [notifications])

  const handleBellClick = () => {
    setBellOpen(prev => !prev)
    setHasUnread(false)
  }

  const handleNotificationClick = (n: NotificationItem) => {
    setBellOpen(false)
    onNavigate?.(n.targetTab)
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
        <h1 className="max-w-[150px] truncate text-xl font-black text-foreground tracking-tight sm:max-w-none">{labName || "My Lab"}</h1>
        
        <Link 
          href="/dashboard/feedback" 
          target="_blank" 
          rel="noopener noreferrer"
          className="ml-4 inline-flex items-center gap-2 bg-muted border border-border p-1.5 lg:p-2 lg:px-4 lg:py-1.5 rounded-lg shadow-sm hover:bg-muted/80 text-xs font-bold transition-colors text-muted-foreground hover:text-foreground"
        >
          <span>🐞</span>
          <span className="hidden sm:inline">Submit Feedback / Report Bug</span>
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
            {hasUnread && notifications.length > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white ring-2 ring-background">
                {notifications.length > 9 ? "9+" : notifications.length}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute top-full mt-1 right-0 w-screen max-w-[calc(100vw-2rem)] sm:w-96 rounded-xl border border-border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-50">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Lab Alerts</p>
                {notifications.length > 0 && (
                  <span className="text-[10px] font-bold text-muted-foreground">{notifications.length} item{notifications.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              {notifications.length > 0 ? (
                <div className="max-h-[60vh] overflow-y-auto">
                  {notifications.map(n => {
                    const meta = CATEGORY_META[n.category]
                    const Icon = meta.icon
                    return (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors border-t border-border/40 first:border-t-0 group"
                      >
                        <div className={`p-1.5 rounded-lg shrink-0 ${meta.bg}`}>
                          <Icon className={`size-3.5 ${meta.color}`} />
                        </div>
                        <p className="text-sm text-foreground flex-1 min-w-0 truncate">
                          {n.message}
                        </p>
                        <ChevronRight className="size-3.5 text-muted-foreground/40 shrink-0 group-hover:text-foreground transition-colors" />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No active alerts. All clear.
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