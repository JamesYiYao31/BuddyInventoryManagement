"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Settings,
  PackageOpen,
  Activity,
  BarChart3,
  Network,
  Shield,
  ShieldCheck,
} from "lucide-react"
import { SidebarPage } from "@/lib/inventory-utils"
import Image from "next/image"

interface DashboardSidebarProps {
  activePage: SidebarPage
  setActivePage: (page: SidebarPage) => void
  /** When true, show internal link to the super-admin control panel (never for manager/technician). */
  showSuperAdminLink?: boolean
  userRole?: "manager" | "technician"
}

export function DashboardSidebar({ activePage, setActivePage, showSuperAdminLink = false, userRole }: DashboardSidebarProps) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "lotinuse", label: "Lot in Use", icon: PackageOpen },
    { id: "requests", label: "Requests", icon: ClipboardList },
    { id: "activitylog", label: "Activity Log", icon: Activity },
    ...(userRole === "manager" ? [{ id: "validation", label: "Validation & COA", icon: ShieldCheck }] : []),
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "labsharing", label: "Lab Sharing", icon: Network },
    { id: "settings", label: "Settings", icon: Settings },
  ]

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center px-6 border-b border-border">
        <Image src="/buddy-logo.png" alt="Buddy Logo" width={40} height={40} className="h-10 w-auto object-contain" priority />
      </div>
      <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id as SidebarPage)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all",
              activePage === item.id
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </button>
        ))}

        {showSuperAdminLink ? (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <Link
              href="/super-admin"
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Shield className="h-5 w-5 shrink-0" />
              Admin Panel
            </Link>
          </>
        ) : null}
      </nav>
      <div className="p-4 border-t border-border">
        <div className="rounded-2xl bg-muted/50 p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Lab License</p>
          <p className="mt-1 text-sm font-black text-foreground">Enterprise Plan</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Valid until Dec 2026</p>
        </div>
      </div>
    </aside>
  )
}