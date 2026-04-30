import { google } from 'googleapis'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

type FeedbackType = 'bug' | 'support' | 'feedback'

type FeedbackRecord = {
  id: string
  type: FeedbackType
  title: string
  description: string
  lab_id: string
  user_id: string
  created_at: string
  status: string
}

type WebhookPayload = {
  record?: FeedbackRecord
}

const resend = new Resend(process.env.RESEND_API_KEY)

type SubmitterInfo = {
  fullName: string
  email: string
  labName: string
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate)
  return Number.isNaN(date.getTime()) ? isoDate : date.toISOString()
}

const formatReadableDate = (isoDate: string): string => {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return isoDate
  const datePart = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${datePart} at ${timePart}`
}

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required env var: ${key}`)
  }
  return value
}

const validateRecord = (record: WebhookPayload['record']): FeedbackRecord => {
  if (!record) {
    throw new Error('Missing record in webhook payload')
  }
  if (!['bug', 'support', 'feedback'].includes(record.type)) {
    throw new Error('Invalid feedback type')
  }
  if (!record.title || !record.description || !record.lab_id || !record.user_id || !record.created_at) {
    throw new Error('Webhook record is missing required fields')
  }
  return record
}

const getSupabaseAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('Missing required env var: NEXT_PUBLIC_SUPABASE_URL')
  }
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

const fetchSubmitterInfo = async (record: FeedbackRecord): Promise<SubmitterInfo> => {
  const admin = getSupabaseAdminClient()

  const [{ data: profile }, { data: lab }] = await Promise.all([
    admin.from('profiles').select('full_name, email').eq('id', record.user_id).maybeSingle(),
    admin.from('labs').select('name').eq('id', record.lab_id).maybeSingle(),
  ])

  return {
    fullName: profile?.full_name || 'Unknown User',
    email: profile?.email || 'Unknown Email',
    labName: lab?.name || 'Unknown Lab',
  }
}

const getTypeLabel = (type: FeedbackType): string => {
  if (type === 'bug') return 'Bug Report'
  if (type === 'support') return 'Support Request'
  return 'Feedback'
}

const sendFeedbackEmail = async (record: FeedbackRecord, submitter: SubmitterInfo) => {
  const typeLabel = getTypeLabel(record.type)
  const subject = `[Buddy Lab] New ${typeLabel}: ${record.title}`
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin-bottom: 12px;">New ${typeLabel}</h2>
      <p><strong>Type:</strong> ${escapeHtml(typeLabel)}</p>
      <p><strong>Title:</strong> ${escapeHtml(record.title)}</p>
      <p><strong>Description:</strong><br/>${escapeHtml(record.description).replaceAll('\n', '<br/>')}</p>
      <p><strong>Lab Name:</strong> ${escapeHtml(submitter.labName)}</p>
      <p><strong>Submitted By:</strong> ${escapeHtml(submitter.fullName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(submitter.email)}</p>
      <p><strong>Date:</strong> ${escapeHtml(formatReadableDate(record.created_at))}</p>
    </div>
  `

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: 'yiyao3112@gmail.com',
    subject,
    html,
  })
}

const appendFeedbackToSheet = async (record: FeedbackRecord, submitter: SubmitterInfo) => {
  const serviceAccountEmail = getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, '')
  if (!privateKey) {
    throw new Error('Missing required env var: GOOGLE_PRIVATE_KEY')
  }
  const sheetId = getRequiredEnv('GOOGLE_SHEET_ID')
  const range = 'Log!A:G'
  const values = [
    [
      formatReadableDate(record.created_at),
      record.type,
      record.title,
      record.description,
      submitter.labName,
      submitter.fullName,
      record.status,
    ],
  ]

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({ version: 'v4', auth })
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values,
      },
    })
  } catch (error) {
    console.error('Failed to append feedback row to Google Sheets', {
      message: error instanceof Error ? error.message : String(error),
      range,
      values,
      sheetId,
      recordId: record.id,
    })
    throw error
  }
}

export async function POST(request: Request) {
  try {
    const requestSecret = request.headers.get('x-webhook-secret')
    const expectedSecret = process.env.SUPABASE_WEBHOOK_SECRET

    if (!requestSecret || !expectedSecret || requestSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as WebhookPayload
    const record = validateRecord(payload.record)

    getRequiredEnv('RESEND_API_KEY')
    const submitterInfo = await fetchSubmitterInfo(record)
    await sendFeedbackEmail(record, submitterInfo)
    await appendFeedbackToSheet(record, submitterInfo)

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('feedback-notify route failed', { message })
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}
