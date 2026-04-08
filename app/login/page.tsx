"use client"

import { useState } from "react"
import { Loader2, ShieldCheck, X } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showForgotMessage, setShowForgotMessage] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 2000))
    console.log("Simulating login for:", email)
    setIsLoading(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans antialiased">
      {/* Grid background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden>
        <div
          className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)]"
          style={{ backgroundSize: "48px 48px" }}
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
          style={{ backgroundSize: "48px 48px" }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5 md:px-14">
          <p className="text-lg font-semibold uppercase tracking-[0.35em] text-muted-foreground">
            Clinical access
          </p>
          <div className="flex items-center gap-3 text-lg font-medium uppercase tracking-wider text-muted-foreground">
            <span className="size-3 rounded-full bg-primary" aria-hidden />
            <span>Inventory systems</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex flex-1 items-center justify-center p-6 md:p-14">
        <div className="w-full max-w-3xl">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-2 ring-border/60">

            {/* Status strip */}
            <div className="flex items-center justify-between gap-6 border-b border-border bg-muted/40 px-8 py-5">
              <span className="text-lg font-medium uppercase tracking-wide text-muted-foreground">
                Secure gateway
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 text-lg font-medium text-foreground">
                <ShieldCheck className="size-5 text-primary" aria-hidden />
                TLS
              </span>
            </div>

            <div className="space-y-14 p-14 md:p-16">

              {/* Branding */}
              <div className="flex flex-col items-center text-center">
                <div className="mb-10 flex items-center justify-center">
                  <img
                    src="/buddy-logo.png"
                    alt="Buddy Logo"
                    className="h-16 w-auto object-contain drop-shadow-sm"
                  />
                </div>
                <div className="space-y-3">
                  <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                    Oakwood Clinical Lab
                  </h1>
                  <div className="flex items-center justify-center gap-3 text-xl text-muted-foreground">
                    <ShieldCheck className="size-7 shrink-0 text-primary" strokeWidth={2} aria-hidden />
                    <span className="font-medium">Secure Inventory Portal</span>
                  </div>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-8">
                {/* Email */}
                <div className="space-y-3">
                  <label
                    htmlFor="email"
                    className="text-lg font-semibold uppercase tracking-wide text-foreground"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="flex h-16 w-full rounded-lg border border-input bg-background px-6 text-lg text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="name@facility.org"
                    required
                    disabled={isLoading}
                    autoComplete="email"
                  />
                </div>

                {/* Password */}
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-6">
                    <label
                      htmlFor="password"
                      className="text-lg font-semibold uppercase tracking-wide text-foreground"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowForgotMessage(true)}
                      className="text-lg font-medium text-primary underline-offset-8 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-card"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="flex h-16 w-full rounded-lg border border-input bg-background px-6 text-lg text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Enter your password"
                    required
                    disabled={isLoading}
                    autoComplete="current-password"
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-4 inline-flex h-16 w-full items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoading && (
                    <Loader2 className="mr-3 size-6 animate-spin" aria-hidden />
                  )}
                  {isLoading ? "Authenticating…" : "Secure Sign In"}
                </button>
              </form>
            </div>
          </div>

          <p className="mt-8 text-center text-lg font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Authorized personnel only
          </p>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {showForgotMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-8 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-title"
        >
          <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-2 ring-border/60">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-8 py-6">
              <div className="flex items-center gap-5">
                <div className="flex size-14 items-center justify-center rounded-full border border-border bg-background">
                  <ShieldCheck className="size-7 text-primary" aria-hidden />
                </div>
                <div>
                  <h2 id="forgot-title" className="text-2xl font-semibold text-foreground">
                    Reset password
                  </h2>
                  <p className="text-lg text-muted-foreground">
                    Secure recovery workflow
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotMessage(false)}
                className="rounded-lg p-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-card"
                aria-label="Close"
              >
                <X className="size-7" />
              </button>
            </div>

            <div className="space-y-8 p-10">
              <p className="text-lg leading-relaxed text-muted-foreground">
                Enter your clinical email address. We will send a secure reset link.
              </p>
              <div className="space-y-3">
                <label
                  htmlFor="forgot-email"
                  className="text-lg font-semibold uppercase tracking-wide text-foreground"
                >
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  placeholder="name@facility.org"
                  className="flex h-16 w-full rounded-lg border border-input bg-background px-6 text-lg text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                />
              </div>
              <button
                type="button"
                className="inline-flex h-16 w-full items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-card"
              >
                Send reset link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}