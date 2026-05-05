"use client"

import { useMemo } from "react"
import {
  type InventoryGroup,
  type LabSettings,
  type LotInUseEntry,
  daysUntilExpiry,
  getEarliestExpiry,
} from "@/lib/inventory-utils"

export type LabAlertExpiredLot = {
  key: string
  itemName: string
  lotNumber: string
  expiry: string
  target: "inventory" | "lotinuse"
}

export type LabAlertExpiryLot = {
  key: string
  itemName: string
  lotNumber: string
  expiry: string
  daysLeft: number
  onBench: boolean
}

export type LabAlertLowStockItem = {
  key: string
  itemName: string
  count: number
  threshold: number
}

function thresholdsForGroup(g: InventoryGroup, lab: LabSettings) {
  return {
    urgentDays: g.urgent_days ?? lab.urgentDays,
    expiringSoonDays: g.expiring_soon_days ?? lab.expiringSoonDays,
    lowStockThreshold: g.low_stock_threshold ?? lab.lowStockThreshold,
  }
}

export function computeLabAlerts(
  inventory: InventoryGroup[],
  lotsInUse: LotInUseEntry[],
  labSettings: LabSettings
) {
  const tz = labSettings.labTimezone

  const expiredLots: LabAlertExpiredLot[] = []
  for (const g of inventory) {
    for (const l of g.lots) {
      if (daysUntilExpiry(l.expiry, tz) < 0) {
        expiredLots.push({
          key: `s-${l.lotId}`,
          itemName: g.name,
          lotNumber: l.lot,
          expiry: l.expiry,
          target: "inventory",
        })
      }
    }
  }
  for (const l of lotsInUse) {
    const eff = getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate)
    if (daysUntilExpiry(eff, tz) < 0) {
      expiredLots.push({
        key: `b-${l.id}`,
        itemName: l.itemName,
        lotNumber: l.lotNumber,
        expiry: eff,
        target: "lotinuse",
      })
    }
  }

  const urgentLots: LabAlertExpiryLot[] = []
  for (const g of inventory) {
    const { urgentDays } = thresholdsForGroup(g, labSettings)
    for (const l of g.lots) {
      const days = daysUntilExpiry(l.expiry, tz)
      if (days >= 0 && days <= urgentDays) {
        urgentLots.push({
          key: l.lotId,
          itemName: g.name,
          lotNumber: l.lot,
          expiry: l.expiry,
          daysLeft: days,
          onBench: false,
        })
      }
    }
  }
  const benchUrgentDays = labSettings.urgentDays
  for (const l of lotsInUse) {
    const eff = getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate)
    const days = daysUntilExpiry(eff, tz)
    if (days >= 0 && days <= benchUrgentDays) {
      urgentLots.push({
        key: `b-${l.id}`,
        itemName: l.itemName,
        lotNumber: l.lotNumber,
        expiry: eff,
        daysLeft: days,
        onBench: true,
      })
    }
  }
  urgentLots.sort((a, b) => a.daysLeft - b.daysLeft)

  const expiringSoonLots: LabAlertExpiryLot[] = []
  for (const g of inventory) {
    const { urgentDays, expiringSoonDays } = thresholdsForGroup(g, labSettings)
    for (const l of g.lots) {
      const days = daysUntilExpiry(l.expiry, tz)
      if (days > urgentDays && days <= expiringSoonDays) {
        expiringSoonLots.push({
          key: l.lotId,
          itemName: g.name,
          lotNumber: l.lot,
          expiry: l.expiry,
          daysLeft: days,
          onBench: false,
        })
      }
    }
  }
  const benchUrgentDaysForSoon = labSettings.urgentDays
  const benchExpiringSoonDays = labSettings.expiringSoonDays
  for (const l of lotsInUse) {
    const eff = getEarliestExpiry(l.workingExpiryDate, l.actualExpiryDate)
    const days = daysUntilExpiry(eff, tz)
    if (days > benchUrgentDaysForSoon && days <= benchExpiringSoonDays) {
      expiringSoonLots.push({
        key: `b-${l.id}`,
        itemName: l.itemName,
        lotNumber: l.lotNumber,
        expiry: eff,
        daysLeft: days,
        onBench: true,
      })
    }
  }
  expiringSoonLots.sort((a, b) => a.daysLeft - b.daysLeft)

  const lowStockItems: LabAlertLowStockItem[] = []
  for (const g of inventory) {
    const { lowStockThreshold } = thresholdsForGroup(g, labSettings)
    const totalCount = g.lots.reduce((acc, lot) => acc + (lot.totalUnits || 0), 0)
    if (totalCount <= lowStockThreshold) {
      lowStockItems.push({
        key: g.itemId,
        itemName: g.name,
        count: totalCount,
        threshold: lowStockThreshold,
      })
    }
  }
  lowStockItems.sort((a, b) => a.count - b.count)

  const totalCount =
    expiredLots.length + urgentLots.length + expiringSoonLots.length + lowStockItems.length

  return {
    expiredLots,
    urgentLots,
    expiringSoonLots,
    lowStockItems,
    totalCount,
  }
}

export function useLabAlerts(input: {
  inventory: InventoryGroup[]
  lotsInUse: LotInUseEntry[]
  labSettings: LabSettings
  isLoading?: boolean
}) {
  const { inventory, lotsInUse, labSettings, isLoading = false } = input

  const data = useMemo(
    () => computeLabAlerts(inventory, lotsInUse, labSettings),
    [inventory, lotsInUse, labSettings]
  )

  return {
    ...data,
    isLoading,
  }
}
