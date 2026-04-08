"use client"

import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Settings,
  PackageOpen,
  Activity
} from "lucide-react"
import { SidebarPage } from "@/lib/inventory-utils"

interface NavItem {
  id: SidebarPage
  label: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "lotinuse", label: "Lot in Use", icon: PackageOpen },
  { id: "activitylog", label: "Activity Log", icon: Activity },
  { id: "requests", label: "Requests", icon: ClipboardList },
]

interface DashboardSidebarProps {
  activePage: SidebarPage
  setActivePage: (page: SidebarPage) => void
}

export function DashboardSidebar({ activePage, setActivePage }: DashboardSidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-card">
      {/* ── LOGO SECTION ── */}
      <div className="flex h-16 items-center px-6 border-b border-border">
        {/* Assuming your logo is saved as public/buddy-logo.png */}
        <img 
          src="/buddy-logo.png" 
          alt="Buddy Logo" 
          className="h-10 w-auto object-contain" 
        />
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activePage === item.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Settings at bottom */}
      <div className="p-4 border-t border-border">
         <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Settings className="h-4 w-4" />
            Settings
         </button>
      </div>

      <div className="p-4 border-t border-border">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Lab License
          </p>
          <p className="mt-1 text-sm font-semibold">
            Enterprise Plan
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Valid until Dec 2026
          </p>
        </div>
      </div>
    </aside>
  )
}