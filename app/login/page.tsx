"use client"

import { useState } from "react"
import { Loader2, ShieldCheck, X, UserCircle, Key } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [isRegistering, setIsRegistering] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<"technician" | "manager">("technician")
  const [managerCode, setManagerCode] = useState("")
  
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const SECRET_MANAGER_CODE = "OAKWOOD-ADMIN" 

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (isRegistering) {
      // 1. Manager Validation
      if (role === "manager" && managerCode !== SECRET_MANAGER_CODE) {
        setError("Invalid Manager Authorization Code.")
        setIsLoading(false)
        return
      }

      // 2. Sign Up with Metadata
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { 
            full_name: fullName,
            role: role 
          }
        }
      })

      if (signUpError) {
        setError(signUpError.message)
      } else {
        alert("Account created! You can now sign in.")
        setIsRegistering(false)
      }
    } else {
      // 3. Sign In
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError(signInError.message)
      } else {
        router.push("/dashboard")
      }
    }
    setIsLoading(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased overflow-hidden">
      {/* ── BACKGROUND GRID ── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)]" style={{ backgroundSize: "48px 48px" }} />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]" style={{ backgroundSize: "48px 48px" }} />
      </div>

      {/* ── HEADER ── */}
      <header className="relative z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5 md:px-14">
          <p className="text-lg font-semibold uppercase tracking-[0.35em] text-muted-foreground">Clinical access</p>
          <div className="flex items-center gap-3 text-lg font-medium uppercase tracking-wider text-muted-foreground">
            <span className="size-3 rounded-full bg-primary" aria-hidden />
            <span>Inventory systems</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center p-6 md:p-14">
        <div className="w-full max-w-3xl animate-in fade-in zoom-in-95 duration-500">
          <div className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-2xl ring-2 ring-border/60">
            
            {/* TOGGLE TABS */}
            <div className="flex border-b border-border bg-muted/40 font-black uppercase tracking-widest text-xs">
               <button 
                 onClick={() => setIsRegistering(false)} 
                 className={`flex-1 py-6 transition-all ${!isRegistering ? "bg-background text-primary" : "text-muted-foreground hover:text-foreground"}`}
               >
                 Sign In
               </button>
               <button 
                 onClick={() => setIsRegistering(true)} 
                 className={`flex-1 py-6 transition-all ${isRegistering ? "bg-background text-primary" : "text-muted-foreground hover:text-foreground"}`}
               >
                 Register Tech
               </button>
            </div>

            <div className="p-14 md:p-16 space-y-10">
              <div className="flex flex-col items-center text-center">
                 <img src="/buddy-logo.png" alt="Logo" className="h-16 w-auto mb-8 drop-shadow-md" />
                 <h1 className="text-4xl font-black tracking-tight text-foreground">{isRegistering ? "Account Registration" : "Oakwood Clinical Portal"}</h1>
                 <p className="text-lg text-muted-foreground mt-2 font-medium">{isRegistering ? "Register your clinical credentials" : "Authorized Personnel Access Only"}</p>
              </div>

              <form onSubmit={handleAuth} className="space-y-6">
                {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 font-bold rounded-2xl text-center text-sm">{error}</div>}

                {isRegistering && (
                  <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Full Name</label>
                      <input value={fullName} onChange={e => setFullName(e.target.value)} className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all" placeholder="Dr. Jane Smith" required />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Laboratory Role</label>
                      <div className="flex gap-4">
                        <button type="button" onClick={() => setRole("technician")} className={`flex-1 h-16 rounded-2xl border-2 flex items-center justify-center gap-3 font-bold transition-all ${role === 'technician' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground opacity-60'}`}>
                          <UserCircle className="size-6" /> Technician
                        </button>
                        <button type="button" onClick={() => setRole("manager")} className={`flex-1 h-16 rounded-2xl border-2 flex items-center justify-center gap-3 font-bold transition-all ${role === 'manager' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground opacity-60'}`}>
                          <ShieldCheck className="size-6" /> Manager
                        </button>
                      </div>
                    </div>

                    {role === "manager" && (
                      <div className="space-y-2 animate-in slide-in-from-top-2">
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest ml-2">Admin Authorization Key</label>
                        <div className="relative">
                           <Key className="absolute left-5 top-5 size-6 text-primary" />
                           <input type="password" value={managerCode} onChange={e => setManagerCode(e.target.value)} className="h-16 w-full rounded-2xl border-2 border-primary/30 bg-primary/5 pl-14 pr-6 text-xl font-black text-primary outline-none" placeholder="Enter Secret Code" required />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all" placeholder="name@facility.org" required />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest ml-2">Secure Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="h-16 w-full rounded-2xl border border-input bg-background px-6 text-lg focus:ring-4 focus:ring-primary/10 outline-none transition-all" placeholder="••••••••" required />
                </div>

                <button type="submit" disabled={isLoading} className="h-16 w-full rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                  {isLoading ? <Loader2 className="size-8 animate-spin mx-auto" /> : isRegistering ? "Create Secure Identity" : "Authorize Access"}
                </button>
              </form>
            </div>
          </div>
          <p className="mt-8 text-center text-sm font-black uppercase tracking-[0.3em] text-muted-foreground">Authorized personnel only</p>
        </div>
      </main>
    </div>
  )
}