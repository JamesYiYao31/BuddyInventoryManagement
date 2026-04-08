"use client"

import { Button } from "@/components/ui/button"
import { Beaker, Plus, Trash2 } from "lucide-react"

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
        <Beaker className="h-4 w-4" />
        Log Reagent Usage
      </Button>
      <Button
        variant="secondary"
        className="gap-2 border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
      >
        <Plus className="h-4 w-4" />
        Add New Bottle
      </Button>
      <Button
        variant="outline"
        className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
        Flag for Disposal
      </Button>
    </div>
  )
}
