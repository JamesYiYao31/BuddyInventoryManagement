import { google } from 'googleapis'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

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

const sendBugOrSupportEmail = async (record: FeedbackRecord) => {
  const typeLabel = record.type === 'bug' ? 'Bug Report' : 'Support Request'
  const subject = `[Buddy Lab] New ${typeLabel}: ${record.title}`
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin-bottom: 12px;">New ${typeLabel}</h2>
      <p><strong>Type:</strong> ${escapeHtml(typeLabel)}</p>
      <p><strong>Title:</strong> ${escapeHtml(record.title)}</p>
      <p><strong>Description:</strong><br/>${escapeHtml(record.description).replaceAll('\n', '<br/>')}</p>
      <p><strong>Lab ID:</strong> ${escapeHtml(record.lab_id)}</p>
      <p><strong>User ID:</strong> ${escapeHtml(record.user_id)}</p>
      <p><strong>Date:</strong> ${escapeHtml(formatDate(record.created_at))}</p>
    </div>
  `

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: 'yiyao3112@gmail.com',
    subject,
    html,
  })
}

const appendFeedbackToSheet = async (record: FeedbackRecord) => {
  const serviceAccountEmail = getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  const privateKey = getRequiredEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n')
  const sheetId = getRequiredEnv('GOOGLE_SHEET_ID')

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Log!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[formatDate(record.created_at), 'feedback', record.title, record.description, record.lab_id, record.status]],
    },
  })
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

    if (record.type === 'bug' || record.type === 'support') {
      getRequiredEnv('RESEND_API_KEY')
      await sendBugOrSupportEmail(record)
    } else {
      await appendFeedbackToSheet(record)
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
