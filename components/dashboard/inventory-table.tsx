"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface Reagent {
  id: string
  name: string
  lotNumber: string
  expirationDate: string
  volumeRemaining: string
  status: "Good" | "Low Volume" | "Expiring"
}

function getStatusStyles(status: Reagent["status"]) {
  switch (status) {
    case "Good":
      return "bg-success/15 text-success border-success/30"
    case "Low Volume":
      return "bg-warning/15 text-warning border-warning/30"
    case "Expiring":
      return "bg-destructive/15 text-destructive border-destructive/30"
    default:
      return ""
  }
}

function getVolumeBarColor(status: Reagent["status"]) {
  switch (status) {
    case "Good":
      return "bg-success"
    case "Low Volume":
      return "bg-warning"
    case "Expiring":
      return "bg-destructive"
    default:
      return "bg-muted"
  }
}

interface InventoryTableProps {
  items: Reagent[]
  loading: boolean
}

export function InventoryTable({ items, loading }: InventoryTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-card-foreground">
            Current Inventory
          </h2>
          <p className="text-xs text-muted-foreground">
            {loading ? "…" : `${items.length} reagents in stock`}
          </p>
        </div>
        <button className="text-xs font-medium text-primary hover:underline">
          View All
        </button>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs text-muted-foreground font-medium">
              Reagent Name
            </TableHead>
            <TableHead className="text-xs text-muted-foreground font-medium">
              Lot Number
            </TableHead>
            <TableHead className="text-xs text-muted-foreground font-medium">
              Expiration Date
            </TableHead>
            <TableHead className="text-xs text-muted-foreground font-medium">
              Volume Remaining
            </TableHead>
            <TableHead className="text-xs text-muted-foreground font-medium">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                Loading...
              </TableCell>
            </TableRow>
          ) : (
            items.map((reagent) => (
              <TableRow
                key={reagent.id}
                className="border-border hover:bg-muted/50"
              >
                <TableCell className="font-medium text-card-foreground">
                  {reagent.name}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {reagent.lotNumber}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(reagent.expirationDate).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          getVolumeBarColor(reagent.status)
                        )}
                        style={{ width: reagent.volumeRemaining }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {reagent.volumeRemaining}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-medium",
                      getStatusStyles(reagent.status)
                    )}
                  >
                    {reagent.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
