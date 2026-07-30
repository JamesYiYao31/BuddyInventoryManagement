import { supabase } from "@/lib/supabase"

export type CreateBillingPortalResult =
  | { ok: true; url: string }
  | { ok: false; errorCode: string }

/**
 * Calls POST /api/stripe/portal with the viewer's bearer token.
 * Shared by manager Billing tab and /org-admin Billing section.
 */
export async function createBillingPortalSession(): Promise<CreateBillingPortalResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, errorCode: "not_authenticated" }

    const response = await fetch("/api/stripe/portal", {
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
export function createBillingPortalErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "actor_inactive":
      return "Your account is inactive."
    case "forbidden":
      return "You don't have permission to manage billing."
    case "org_managed_billing":
      return "Billing for this lab is managed by your organization. Ask your organization administrator to make changes."
    case "role_not_permitted":
      return "You don't have permission to manage billing."
    case "profile_incomplete":
      return "Your account is not fully set up for billing. Please contact support."
    case "no_subscription":
      return "No subscription found. Upgrade first to manage billing."
    case "not_authenticated":
      return "You must be signed in to manage billing."
    default:
      return "Could not open billing portal."
  }
}
