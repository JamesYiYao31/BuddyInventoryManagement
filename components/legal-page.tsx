import Link from "next/link"
import type { ReactNode } from "react"

type LegalPageProps = {
  title: string
  lastUpdated: string
  children: ReactNode
}

export function LegalPage({ title, lastUpdated, children }: LegalPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background font-sans antialiased">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-[720px] px-6 py-5 md:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Buddy Inventory Management
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 py-12 md:py-16">
        <h1 className="text-3xl font-black tracking-tight text-foreground md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

        <article className="mt-10 space-y-6 text-base leading-relaxed [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_p]:text-muted-foreground">
          {children}
        </article>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <Link href="/terms" className="transition-colors hover:text-foreground">
          Terms
        </Link>
        <span aria-hidden> · </span>
        <Link href="/privacy" className="transition-colors hover:text-foreground">
          Privacy
        </Link>
        <span aria-hidden> · </span>
        <a href="mailto:support@yourbuddyapp.com" className="transition-colors hover:text-foreground">
          support@yourbuddyapp.com
        </a>
      </footer>
    </div>
  )
}
