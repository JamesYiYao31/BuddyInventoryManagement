"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ActivityItem {
  id: string
  time: string
  user: string
  userInitials: string
  action: string
  type: "open" | "usage" | "disposal" | "reorder"
}

const activities: ActivityItem[] = [
  {
    id: "1",
    time: "08:15 AM",
    user: "James",
    userInitials: "JM",
    action: "opened a new bottle of SuperMix",
    type: "open",
  },
  {
    id: "2",
    time: "09:30 AM",
    user: "Sarah",
    userInitials: "SL",
    action: "logged 5mL usage of Buffer A",
    type: "usage",
  },
  {
    id: "3",
    time: "10:45 AM",
    user: "James",
    userInitials: "JM",
    action: "flagged Lot #4521 for disposal",
    type: "disposal",
  },
  {
    id: "4",
    time: "11:20 AM",
    user: "Mike",
    userInitials: "MK",
    action: "initiated reorder for PCR Kit",
    type: "reorder",
  },
  {
    id: "5",
    time: "01:05 PM",
    user: "Sarah",
    userInitials: "SL",
    action: "logged 10mL usage of Taq Poly",
    type: "usage",
  },
  {
    id: "6",
    time: "02:30 PM",
    user: "James",
    userInitials: "JM",
    action: "received new shipment of DNA Kit",
    type: "open",
  },
]

function getActivityColor(type: ActivityItem["type"]) {
  switch (type) {
    case "open":
      return "bg-success text-success-foreground"
    case "usage":
      return "bg-primary text-primary-foreground"
    case "disposal":
      return "bg-destructive text-destructive-foreground"
    case "reorder":
      return "bg-warning text-warning-foreground"
    default:
      return "bg-muted text-muted-foreground"
  }
}

export function ActivityFeed() {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-card-foreground">
            Activity Log
          </h2>
          <p className="text-xs text-muted-foreground">Recent audit trail</p>
        </div>
        <button className="text-xs font-medium text-primary hover:underline">
          View All
        </button>
      </div>
      <div className="divide-y divide-border">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback
                className={`text-[10px] font-medium ${getActivityColor(activity.type)}`}
              >
                {activity.userInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-0.5">
              <p className="text-sm text-card-foreground">
                <span className="font-medium">{activity.user}</span>{" "}
                <span className="text-muted-foreground">{activity.action}</span>
              </p>
              <p className="text-xs text-muted-foreground">{activity.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
