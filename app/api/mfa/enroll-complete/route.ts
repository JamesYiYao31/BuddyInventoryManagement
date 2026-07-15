import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateBearerRequest, createAdminClient } from '@/lib/mfa-api-auth'
import {
  appendSecurityLogDetails,
  logSecurityEvent,
  resolveSecurityLogIdentity,
} from '@/lib/log-security-event-server'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: true,
})

/**
 * Records mfa_factor_enrolled / mfa_factor_replaced after client-side
 * challengeAndVerify succeeds. The factor check makes the event attest to
 * actual server state; only the enrolled-vs-replaced label trusts the client,
 * which is low-stakes (both mean a factor became active).
 */
export async function POST(request: NextRequest) {
  const logIp =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    null
  const rateLimitKey = logIp ?? 'anonymous'
  const { success, limit, reset, remaining } = await ratelimit.limit(
    `mfa-enroll-complete:${rateLimitKey}`,
  )

  if (!success) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    const auth = await authenticateBearerRequest(request.headers.get('Authorization'))
    if (!auth.ok) return auth.response

    const { user, accessToken } = auth

    let body: { replaced?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const replaced = body.replaced === true

    const admin = createAdminClient()

    // Server-side fact check: a verified TOTP factor must exist before we log.
    const { data: factorsData } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
    const hasVerifiedTotp = (factorsData?.factors ?? []).some(
      (f) => f.factor_type === 'totp' && f.status === 'verified',
    )
    if (!hasVerifiedTotp) {
      return NextResponse.json(
        { error: 'No verified TOTP factor found.', error_code: 'no_verified_factor' },
        { status: 409 },
      )
    }

    const { detailsSuffix, ...identity } = await resolveSecurityLogIdentity(
      admin,
      user,
      accessToken,
    )
    const eventType = replaced ? 'mfa_factor_replaced' : 'mfa_factor_enrolled'
    const detailsBase = replaced
      ? 'TOTP factor replaced and verified'
      : 'TOTP factor verified'

    await logSecurityEvent(admin, {
      ...identity,
      eventType,
      outcome: 'success',
      details: appendSecurityLogDetails(detailsBase, detailsSuffix),
      ipAddress: logIp,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('MFA enroll-complete route failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
