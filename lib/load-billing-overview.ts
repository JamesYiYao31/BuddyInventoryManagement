import type { Anomaly, EventRow, TenantRow } from "./billing-overview-model.ts"
import { resolveBillingOverviewErrorCode } from "./billing-overview-error-code.ts"

export type BillingOverviewData = {
  tenants: TenantRow[]
  anomalies: Anomaly[]
  events: EventRow[]
  generatedAt: string | null
}

export type BillingOverviewResult =
  | { ok: true; data: BillingOverviewData }
  | { ok: false; status: number; code: string }

type LoadBillingOverviewDeps = {
  getSession?: () => Promise<{ accessToken: string | null }>
  fetchFn?: typeof fetch
}

/**
 * Fetch the super-admin billing overview. Never throws; never returns a
 * partial success. Optional deps are for node --test injection only —
 * production callers pass nothing. Supabase is lazy-imported on the
 * default path so tests never load Next/browser client (same technique
 * as resolveBillingOwner's optional client).
 */
export async function loadBillingOverview(
  deps?: LoadBillingOverviewDeps,
): Promise<BillingOverviewResult> {
  try {
    const getSession =
      deps?.getSession ??
      (async () => {
        const { supabase } = await import("./supabase.ts")
        const {
          data: { session },
        } = await supabase.auth.getSession()
        return { accessToken: session?.access_token ?? null }
      })
    const fetchFn = deps?.fetchFn ?? fetch

    const { accessToken } = await getSession()
    if (!accessToken) {
      return { ok: false, status: 401, code: "not_authenticated" }
    }

    const response = await fetchFn("/api/super-admin/billing-overview", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const bodyText = await response.text()
      const code = resolveBillingOverviewErrorCode(bodyText)
      return { ok: false, status: response.status, code }
    }

    const data = (await response.json().catch(() => ({}))) as {
      tenants?: TenantRow[]
      anomalies?: Anomaly[]
      events?: EventRow[]
      generatedAt?: string
    }

    return {
      ok: true,
      data: {
        tenants: Array.isArray(data.tenants) ? data.tenants : [],
        anomalies: Array.isArray(data.anomalies) ? data.anomalies : [],
        events: Array.isArray(data.events) ? data.events : [],
        generatedAt:
          typeof data.generatedAt === "string" ? data.generatedAt : null,
      },
    }
  } catch {
    return { ok: false, status: 0, code: "request_failed" }
  }
}
