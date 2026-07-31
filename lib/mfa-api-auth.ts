import { createClient, type User } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8")
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export type BearerAuthResult =
  | { ok: true; user: User; accessToken: string; sessionId: string | null }
  | { ok: false; response: NextResponse }

export async function authenticateBearerRequest(
  authHeader: string | null,
): Promise<BearerAuthResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authenticated", error_code: "not_authenticated" },
        { status: 401 },
      ),
    }
  }

  const accessToken = authHeader.replace("Bearer ", "")
  const admin = createAdminClient()
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken)

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authenticated", error_code: "not_authenticated" },
        { status: 401 },
      ),
    }
  }

  const payload = decodeJwtPayload(accessToken)
  const sessionId =
    typeof payload?.session_id === "string" ? payload.session_id : null

  return { ok: true, user, accessToken, sessionId }
}
