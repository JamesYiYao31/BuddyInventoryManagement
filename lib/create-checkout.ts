import { supabase } from "@/lib/supabase"

export type CreateCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; errorCode: string }

/**
 * Calls POST /api/stripe/checkout with the viewer's bearer token.
 * Shared by manager Billing tab and /org-admin Billing section.
 */
export async function createCheckoutSession(): Promise<CreateCheckoutResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, errorCode: "not_authenticated" }

    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    })

    const data = (await response.json().catch(() => ({}))) as {
      error_code?: string
      url?: string
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: typeof data.error_code === "string" ? data.error_code : "request_failed",
      }
    }

    if (typeof data.url !== "string" || !data.url) {
      return { ok: false, errorCode: "request_failed" }
    }

    return { ok: true, url: data.url }
  } catch {
    return { ok: false, errorCode: "request_failed" }
  }
}

/** Human copy for route error_codes, shared so all surfaces stay consistent. */
export function createCheckoutErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "actor_inactive":
      return "Your account is inactive."
    case "forbidden":
      return "You don't have permission to manage billing."
    case "already_subscribed":
      return "This account already has an active subscription."
    case "no_active_labs":
      return "No active labs to subscribe."
    case "not_authenticated":
      return "You must be signed in to upgrade."
    default:
      return "Could not start checkout."
  }
}
