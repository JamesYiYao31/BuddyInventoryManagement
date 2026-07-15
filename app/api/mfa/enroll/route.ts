import { createClient } from '@supabase/supabase-js'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: true,
})

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'anonymous'
  // Prefixed so this route cannot share a per-IP bucket with other limiters.
  const { success, limit, reset, remaining } = await ratelimit.limit(`mfa-enroll:${ip}`)

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
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const accessToken = authHeader.replace('Bearer ', '')

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: factorsData } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
    for (const factor of factorsData?.factors ?? []) {
      if (factor.status === 'unverified') {
        await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id })
      }
    }

    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    )

    const { data, error: enrollError } = await userClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Buddy Inventory Management',
    })
    if (enrollError || !data) {
      console.error('MFA enroll failed:', enrollError)
      return NextResponse.json(
        { error: enrollError?.message ?? 'Enroll failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      qrCodeUrl: data.totp.qr_code,
      secret: data.totp.secret,
      factorId: data.id,
    })
  } catch (error) {
    console.error('MFA enroll route failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
