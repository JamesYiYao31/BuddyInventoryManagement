"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { resolveCurrentUserLabId } from "@/lib/inventory-utils"
import type { SidebarPage } from "@/lib/inventory-utils"

export type BellAlertCategory =
  | "pendingApprovals"
  | "requestsPending"
  | "orderedNotReceived"
  | "benchExpiring"
  | "outOfStock"

export interface BellAlertRow {
  id: string
  message: string
  category: BellAlertCategory
  targetTab: SidebarPage
}

export interface BellAlertGroups {
  pendingApprovals: BellAlertRow[]
  requestsPending: BellAlertRow[]
  orderedNotReceived: BellAlertRow[]
  benchExpiring: BellAlertRow[]
  outOfStock: BellAlertRow[]
  totalCount: number
  isLoading: boolean
}

const EMPTY_GROUPS: BellAlertGroups = {
  pendingApprovals: [],
  requestsPending: [],
  orderedNotReceived: [],
  benchExpiring: [],
  outOfStock: [],
  totalCount: 0,
  isLoading: true,
}

export function useBellAlerts(
  userRole: "manager" | "technician" | "org_admin" | "super_admin" | undefined,
) {
  const [groups, setGroups] = useState<BellAlertGroups>(EMPTY_GROUPS)

  const fetchAlerts = useCallback(async () => {
    const labId = await resolveCurrentUserLabId()
    if (!labId) {
      setGroups({ ...EMPTY_GROUPS, isLoading: false })
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split("T")[0]

    // For "requests pending > 3 days": date_requested <= 3 days ago
    const threeDaysAgo = new Date(today)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const threeDaysAgoStr = threeDaysAgo.toISOString().split("T")[0]

    const pendingApprovals: BellAlertRow[] = []
    const requestsPending: BellAlertRow[] = []
    const orderedNotReceived: BellAlertRow[] = []
    const benchExpiring: BellAlertRow[] = []
    const outOfStock: BellAlertRow[] = []

    const fetches: PromiseLike<void>[] = []

    // ── Manager-only queries ─────────────────────────────────────────────────
    if (userRole === "manager") {
      fetches.push(
        supabase
          .from("inventory_lots")
          .select("id, lot_number, validation_status, items(name)")
          .eq("lab_id", labId)
          .in("validation_status", ["pending_approval", "pending_coa"])
          .then(({ data }) => {
            for (const lot of data ?? []) {
              const item = Array.isArray(lot.items) ? lot.items[0] : lot.items
              const itemName = item?.name ?? "Unknown Item"
              pendingApprovals.push({
                id: `pa-${lot.id}`,
                message: `${itemName} — Pending Approval`,
                category: "pendingApprovals",
                targetTab: "validation",
              })
            }
          })
      )

      fetches.push(
        supabase
          .from("requests")
          .select("id, item_name")
          .eq("lab_id", labId)
          .eq("status", "pending")
          .lte("date_requested", threeDaysAgoStr)
          .then(({ data }) => {
            for (const req of data ?? []) {
              requestsPending.push({
                id: `rp-${req.id}`,
                message: `${req.item_name} — Request Pending Approval`,
                category: "requestsPending",
                targetTab: "requests",
              })
            }
          })
      )
    }

    // ── Shared queries (all roles) ───────────────────────────────────────────

    fetches.push(
      supabase
        .from("requests")
        .select("id, item_name")
        .eq("lab_id", labId)
        .eq("status", "ordered")
        .then(({ data }) => {
          for (const req of data ?? []) {
            orderedNotReceived.push({
              id: `on-${req.id}`,
              message: `${req.item_name} — Ordered, Not Yet Received`,
              category: "orderedNotReceived",
              targetTab: "requests",
            })
          }
        })
    )

    fetches.push(
      supabase
        .from("active_lots")
        .select("id, lot_number, working_expiry_date, items(name)")
        .eq("lab_id", labId)
        .gte("working_expiry_date", todayStr)
        .lte("working_expiry_date", tomorrowStr)
        .then(({ data }) => {
          for (const lot of data ?? []) {
            const item = Array.isArray(lot.items) ? lot.items[0] : lot.items
            const itemName = item?.name ?? "Unknown"
            const isToday = (lot.working_expiry_date as string)?.startsWith(todayStr)
            benchExpiring.push({
              id: `be-${lot.id}`,
              message: `${itemName} — Bench expiry ${isToday ? "today" : "tomorrow"}`,
              category: "benchExpiring",
              targetTab: "lotinuse",
            })
          }
        })
    )

    fetches.push(
      Promise.all([
        supabase.from("items").select("id, name").eq("lab_id", labId),
        supabase
          .from("inventory_lots")
          .select("item_id, count")
          .eq("lab_id", labId)
          .eq("status", "In Storage"),
      ]).then(([{ data: itemsData }, { data: lotsData }]) => {
        const stockByItem: Record<string, number> = {}
        for (const lot of lotsData ?? []) {
          stockByItem[lot.item_id] =
            (stockByItem[lot.item_id] ?? 0) + (lot.count ?? 0)
        }
        for (const item of itemsData ?? []) {
          if ((stockByItem[item.id] ?? 0) === 0) {
            outOfStock.push({
              id: `os-${item.id}`,
              message: `${item.name} — Out of Stock`,
              category: "outOfStock",
              targetTab: "inventory",
            })
          }
        }
      })
    )

    await Promise.all(fetches)

    const totalCount =
      pendingApprovals.length +
      requestsPending.length +
      orderedNotReceived.length +
      benchExpiring.length +
      outOfStock.length

    setGroups({
      pendingApprovals,
      requestsPending,
      orderedNotReceived,
      benchExpiring,
      outOfStock,
      totalCount,
      isLoading: false,
    })
  }, [userRole])

  useEffect(() => {
    if (!userRole) return
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 60_000)
    return () => clearInterval(interval)
  }, [fetchAlerts, userRole])

  return groups
}
