"use client"

import { Bell, Search, ShieldCheck, User } from "lucide-react"

interface DashboardHeaderProps {
  user?: any;
  role?: "manager" | "technician";
}

export function DashboardHeader({ user, role }: DashboardHeaderProps) {
  // Extract name and initials from the email or metadata
  const userEmail = user?.email || "staff@lab.com"
  const userName = user?.user_metadata?.full_name || userEmail.split('@')[0]
  const initials = userName.substring(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-8 backdrop-blur supports-[backdrop-filter]:bg-background/60 print:hidden">
      
      {/* ── LEFT SIDE: TITLE & ROLE BADGE ── */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-black text-foreground tracking-tight">BuddyLab Workspace</h1>
        
        {/* Dynamic Role Badge */}
        <div className={`hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full border ${
          role === 'manager' 
            ? 'bg-primary/10 border-primary/20 text-primary' 
            : 'bg-muted border-border text-muted-foreground'
        }`}>
          {role === 'manager' ? <ShieldCheck className="size-3.5" /> : <User className="size-3.5" />}
          <span className="text-[10px] font-black uppercase tracking-widest">
            {role === 'manager' ? 'Admin Access' : 'Tech Access'}
          </span>
        </div>
      </div>

      {/* ── RIGHT SIDE: SEARCH, ALERTS, PROFILE ── */}
      <div className="flex items-center gap-6">
        
        {/* Global Search Bar Placeholder */}
        <div className="relative hidden lg:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search reagents, lots..."
            className="w-64 h-9 bg-muted border border-border rounded-lg pl-9 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
        
        {/* Notification Bell */}
        <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted">
          <Bell className="size-5" />
          {role === 'manager' && (
            <span className="absolute right-1.5 top-1.5 flex size-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-background animate-pulse" />
          )}
        </button>

        {/* Dynamic User Profile */}
        <div className="flex items-center gap-3 border-l border-border pl-6">
          <div className="flex flex-col text-right hidden sm:flex">
            <span className="text-sm font-black text-foreground capitalize">{userName}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {role === 'manager' ? 'Lab Manager' : 'Lab Tech'}
            </span>
          </div>
          
          {/* Avatar Circle */}
          <div className={`size-9 rounded-xl flex items-center justify-center text-sm font-black shadow-sm ${
            role === 'manager' 
              ? 'bg-primary text-primary-foreground shadow-primary/20' 
              : 'bg-muted text-muted-foreground border border-border'
          }`}>
            {initials}
          </div>
        </div>

      </div>
    </header>
  )
}