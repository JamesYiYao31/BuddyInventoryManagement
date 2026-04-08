"use client"

import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Settings,
  FlaskConical,
} from "lucide-react"

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  active?: boolean
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "#", icon: LayoutDashboard, active: true },
  { label: "Inventory", href: "#", icon: Package },
  { label: "Activity Log", href: "#", icon: ClipboardList },
  { label: "Settings", href: "#", icon: Settings },
]

export function DashboardSidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-sidebar">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <FlaskConical className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-sidebar-foreground">
            BuddyLab
          </span>
          <span className="text-xs text-muted-foreground">Tracker</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              item.active
                ? "bg-sidebar-accent text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-lg bg-sidebar-accent p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Lab License
          </p>
          <p className="mt-1 text-sm font-semibold text-sidebar-foreground">
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
