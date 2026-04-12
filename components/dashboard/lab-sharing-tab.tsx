"use client"

import { Search, MapPin, ChevronsRight, ShieldCheck } from "lucide-react"

export default function LabSharingTab() {
  const nearbyLabs = [
    { name: "City General Hospital", distance: "1.2 mi", stock: "High" },
    { name: "Westside Clinic", distance: "3.4 mi", stock: "Medium" },
    { name: "Downtown Research Center", distance: "5.0 mi", stock: "Low" },
  ]

  const sharedReagents = [
    { item: "FACS Clean", lab: "City General Hospital", distance: "1.2 mi", status: "Available to Share" },
    { item: "BioBall", lab: "Westside Clinic", distance: "3.4 mi", status: "Emergency Only" },
    { item: "DMSO", lab: "City General Hospital", distance: "1.2 mi", status: "Available to Share" },
  ]

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 max-w-6xl">
      <div className="bg-primary/10 border-2 border-primary/20 rounded-[2.5rem] p-10 flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-xs"><ShieldCheck className="size-4" /> BuddyLab Verified Network</div>
          <h1 className="text-3xl font-black text-foreground">Lab Sharing System</h1>
          <p className="text-muted-foreground max-w-lg">Locate and request emergency reagents from trusted partner labs in your geographical area using the BuddyLab network.</p>
        </div>
        <div className="relative w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
          <input placeholder="Search network for a reagent..." className="w-full h-14 pl-12 pr-4 bg-background border border-border rounded-2xl shadow-sm focus:ring-2 focus:ring-primary outline-none font-medium" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8">
        <div className="col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-foreground px-2">Network Inventory Matches</h2>
          <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-[2fr_2fr_1fr_1.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Reagent</span><span>Partner Lab</span><span>Distance</span><span>Action</span>
            </div>
            {sharedReagents.map((item, i) => (
              <div key={i} className="grid grid-cols-[2fr_2fr_1fr_1.5fr] px-6 py-5 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-all">
                <span className="font-bold text-foreground">{item.item}</span>
                <span className="font-medium text-muted-foreground flex items-center gap-2"><MapPin className="size-3.5 text-primary" /> {item.lab}</span>
                <span className="font-mono text-muted-foreground">{item.distance}</span>
                <button className="flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 px-4 rounded-xl font-bold text-xs shadow-sm hover:opacity-90 transition-all">
                  Request <ChevronsRight className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
           <h2 className="text-lg font-bold text-foreground px-2">Your Trusted Network</h2>
           <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
             {nearbyLabs.map((lab, i) => (
               <div key={i} className="flex justify-between items-center p-3 hover:bg-muted/30 rounded-xl transition-all cursor-pointer border border-transparent hover:border-border">
                 <div>
                   <p className="font-bold text-sm text-foreground">{lab.name}</p>
                   <p className="text-xs text-muted-foreground mt-0.5">{lab.distance} away</p>
                 </div>
                 <div className={`size-3 rounded-full ${lab.stock === "High" ? "bg-green-500" : lab.stock === "Medium" ? "bg-yellow-500" : "bg-red-500"}`} />
               </div>
             ))}
             <button className="w-full py-3 mt-2 border-2 border-dashed border-border rounded-xl text-xs font-bold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
               + Invite a Lab to Network
             </button>
           </div>
        </div>
      </div>
    </div>
  )
}