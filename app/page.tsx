import { redirect } from "next/navigation"

type HomePageProps = {
  searchParams?: {
    error?: string | string[]
  }
}

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedParams = await searchParams
  const rawError = resolvedParams?.error
  const error = Array.isArray(rawError) ? rawError[0] : rawError

  // Preserve dashboard redirect errors when forwarding / -> /login.
  if (error?.trim()) {
    redirect(`/login?error=${encodeURIComponent(error.trim())}`)
  }

  // Instantly redirect anyone who visits the root URL to the login page.
  redirect("/login")
}