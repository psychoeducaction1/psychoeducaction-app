import 'server-only'

export async function sendResendEmail({
  to,
  cc,
  subject,
  text,
  html,
  idempotencyKey,
}: {
  to: string | string[]
  cc?: string[]
  subject: string
  text: string
  html?: string
  idempotencyKey?: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from =
    process.env.RESEND_FROM_EMAIL ??
    'Clinique PsychoÉducAction <onboarding@resend.dev>'

  if (!apiKey) throw new Error('RESEND_API_KEY est manquant.')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      ...(cc && cc.length > 0 ? { cc } : {}),
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(
      `Erreur Resend ${response.status}: ${responseText || response.statusText}`
    )
  }
}
