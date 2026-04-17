"use client"

import { useState } from "react"
import { Search, MapPin, ChevronsRight, ShieldCheck, Mail, Send } from "lucide-react"

export default function LabSharingTab() {
  // ── STATE ──
  const [searchTerm, setSearchTerm] = useState("")
  const [requestedItems, setRequestedItems] = useState<number[]>([])

  // ── MOCK DATA ──
  const nearbyLabs = [
    { name: "City General Hospital", distance: "1.2 mi", sharedCount: 14, rating: "98%" },
    { name: "Westside Clinic", distance: "3.4 mi", sharedCount: 5, rating: "92%" },
    { name: "Downtown Research Center", distance: "5.0 mi", sharedCount: 2, rating: "85%" },
  ]

  const sharedReagents = [
    { id: 1, item: "FACS Clean", lab: "City General Hospital", distance: "1.2 mi", status: "Available to Share", qty: "2 Bottles" },
    { id: 2, item: "BioBall", lab: "Westside Clinic", distance: "3.4 mi", status: "Emergency Only", qty: "1 Box" },
    { id: 3, item: "DMSO (Cell Culture Grade)", lab: "City General Hospital", distance: "1.2 mi", status: "Available to Share", qty: "500 mL" },
    { id: 4, item: "Phosphate-Buffered Saline", lab: "Downtown Research Center", distance: "5.0 mi", status: "Available to Share", qty: "10 L" },
  ]

  // ── LOGIC ──
  const filteredReagents = sharedReagents.filter(r => 
    r.item.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.lab.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleRequest = (id: number) => {
    setRequestedItems(prev => [...prev, id])
    // In a real app, this would trigger a Supabase insert to a 'network_requests' table
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 max-w-6xl">
      {/* HEADER */}
      <div className="bg-primary/10 border-2 border-primary/20 rounded-[2.5rem] p-10 flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-xs">
            <ShieldCheck className="size-4" /> BuddyLab Verified Network
          </div>
          <h1 className="text-3xl font-black text-foreground">Lab Sharing System</h1>
          <p className="text-muted-foreground max-w-lg">
            Locate and request emergency reagents from trusted partner labs in your geographical area.
          </p>
        </div>
        <div className="relative w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
          <input 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search network for a reagent or lab..." 
            className="w-full h-14 pl-12 pr-4 bg-background border border-border rounded-2xl shadow-sm focus:ring-2 focus:ring-primary outline-none font-medium transition-all" 
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* MAIN TABLE */}
        <div className="col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-foreground px-2">Network Inventory Matches</h2>
          <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-[2.5fr_2fr_1fr_1.5fr] border-b border-border bg-muted/30 px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Reagent & Qty</span><span>Partner Lab</span><span>Distance</span><span>Action</span>
            </div>
            
            {filteredReagents.length > 0 ? (
              filteredReagents.map((item) => {
                const isRequested = requestedItems.includes(item.id)
                return (
                  <div key={item.id} className="grid grid-cols-[2.5fr_2fr_1fr_1.5fr] px-6 py-5 items-center border-t border-border/50 text-sm hover:bg-muted/20 transition-all">
                    <div>
                      <span className="font-bold text-foreground block">{item.item}</span>
                      <span className="text-xs text-muted-foreground">{item.qty} • {item.status}</span>
                    </div>
                    <span className="font-medium text-muted-foreground flex items-center gap-2">
                      <MapPin className="size-3.5 text-primary" /> {item.lab}
                    </span>
                    <span className="font-mono text-muted-foreground">{item.distance}</span>
                    <button 
                      onClick={() => handleRequest(item.id)}
                      disabled={isRequested}
                      className={`flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-bold text-xs shadow-sm transition-all ${
                        isRequested 
                          ? "bg-muted text-muted-foreground border border-border cursor-not-allowed" 
                          : "bg-primary text-primary-foreground hover:opacity-90"
                      }`}
                    >
                      {isRequested ? "Request Sent" : "Request Asset"} 
                      {isRequested ? <Send className="size-3" /> : <ChevronsRight className="size-3" />}
                    </button>
                  </div>
                )
              })
            ) : (
              <div className="p-10 text-center text-muted-foreground font-medium">
                No reagents found matching "{searchTerm}"
              </div>
            )}
          </div>
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
           <h2 className="text-lg font-bold text-foreground px-2">Your Trusted Network</h2>
           <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
             {nearbyLabs.map((lab, i) => (
               <div key={i} className="flex justify-between items-center p-3 hover:bg-muted/30 rounded-xl transition-all cursor-pointer border border-transparent hover:border-border">
                 <div>
                   <p className="font-bold text-sm text-foreground">{lab.name}</p>
                   <p className="text-xs text-muted-foreground mt-0.5">{lab.distance} away • {lab.sharedCount} items</p>
                 </div>
                 <button title="Message Lab" className="p-2 bg-muted rounded-full hover:bg-primary/10 hover:text-primary transition-colors">
                    <Mail className="size-4" />
                 </button>
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