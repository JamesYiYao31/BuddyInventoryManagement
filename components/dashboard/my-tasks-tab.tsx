"use client"

import { CheckCircle2, Circle, Clock, Thermometer, PenTool, FlaskConical } from "lucide-react"

export default function MyTasksTab() {
  const tasks = [
    {
      id: 1,
      title: "Morning Equipment Calibration",
      description: "Perform daily calibration on all pH meters and scales in Lab B.",
      time: "08:00 AM",
      icon: PenTool,
      completed: true,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      id: 2,
      title: "Freezer Temperature Log",
      description: "Record temperatures for -80°C and -20°C storage units.",
      time: "10:00 AM",
      icon: Thermometer,
      completed: false,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
    },
    {
      id: 3,
      title: "Restock Bench Reagents",
      description: "Ensure all active benches have sufficient buffer solutions and pipettes.",
      time: "01:00 PM",
      icon: FlaskConical,
      completed: false,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      id: 4,
      title: "End of Day Cleanup",
      description: "Wipe down all surfaces, secure hazardous materials, and lock cabinets.",
      time: "05:00 PM",
      icon: Clock,
      completed: false,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    }
  ]

  return (
    <div className="flex flex-col gap-10 animate-in fade-in duration-700">

      {/* ── HEADER ── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">My Tasks</h1>
          <p className="text-base text-muted-foreground mt-2 font-medium">Daily operational checklist and responsibilities.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[2.5rem] p-10 shadow-sm">
        <h2 className="text-2xl font-black text-foreground mb-6">Today's Schedule</h2>

        <div className="space-y-4">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-6 p-6 rounded-2xl border border-border hover:border-primary/20 transition-all hover:bg-muted/50 group">
              <div className={`mt-1 size-12 rounded-xl flex items-center justify-center shrink-0 ${task.bgColor}`}>
                <task.icon className={`size-6 ${task.color}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className={`text-lg font-bold ${task.completed ? "text-muted-foreground line-through decoration-2" : "text-foreground"}`}>
                    {task.title}
                  </h3>
                  <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground tracking-widest uppercase">
                    {task.time}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground font-medium">{task.description}</p>
              </div>

              <div className="shrink-0 flex items-center justify-center">
                <button className={`size-8 rounded-full flex items-center justify-center transition-all ${task.completed ? "text-green-500" : "text-muted-foreground hover:text-primary"}`}>
                  {task.completed ? <CheckCircle2 className="size-8" /> : <Circle className="size-8 stroke-[1.5]" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
