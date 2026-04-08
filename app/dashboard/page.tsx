"use client"

import { useState } from "react"
import { SidebarPage, InventoryGroup, LabSettings, daysUntilExpiry } from "@/lib/inventory-utils"

// Modular UI Components
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { DashboardHeader } from "@/components/dashboard/header"
import { AlertCards } from "@/components/dashboard/alert-cards"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import InventoryTab from "@/components/dashboard/inventory-table"

export default function DashboardPage() {
  const [activePage, setActivePage] = useState<SidebarPage>("dashboard")
  
  // Dummy data for Inventory logic
  const [inventory, setInventory] = useState<InventoryGroup[]>([]) 
  const [labSettings] = useState<LabSettings>({ lowStockCount: 5, expiryWarnDays: 30, expiryUrgentDays: 7 })

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar with your Logo */}
      <DashboardSidebar activePage={activePage} setActivePage={setActivePage} />

      <div className="flex flex-1 flex-col pl-64">
        {/* Top Header with Search/Profile */}
        <DashboardHeader />

        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            
            {/* --- DASHBOARD VIEW --- */}
            {activePage === "dashboard" && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">Dashboard Overview</h1>
                    <p className="text-muted-foreground">Summary of your lab status and recent actions.</p>
                  </div>
                </div>

                {/* Log Reagent / Add Bottle Buttons */}
                <QuickActions />

                {/* Expiry / Low Stock Cards */}
                <AlertCards />

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                  {/* Left Column: Stats or Small Table */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="rounded-xl border border-border bg-card p-6 h-[400px] flex items-center justify-center text-muted-foreground">
                       Inventory Analytics Chart Placeholder
                    </div>
                  </div>
                  
                  {/* Right Column: Recent Log */}
                  <ActivityFeed />
                </div>
              </div>
            )}

            {/* --- INVENTORY VIEW --- */}
            {activePage === "inventory" && (
              <InventoryTab 
                inventory={inventory}
                setInventory={setInventory}
                sortedFlatInventory={[]} // Passes current inventory list
                labSettings={labSettings}
                selectedItems={new Set()}
              />
            )}

            {/* --- OTHER PAGES --- */}
            {activePage === "lotinuse" && (
              <div className="p-10 text-center border-2 border-dashed rounded-3xl">Lot in Use Content</div>
            )}
            {activePage === "activitylog" && (
              <div className="max-w-3xl mx-auto">
                <ActivityFeed />
              </div>
            )}
            {activePage === "requests" && (
              <div className="p-10 text-center border-2 border-dashed rounded-3xl">Requests Content</div>
            )}

          </div>
        </main>
      </div>
    </div>
  )
}