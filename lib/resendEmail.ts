import 'server-only'

export async function sendResendEmail({
  to,
  cc,
  subject,
  text,
}: {
  to: string
  cc?: string[]
  subject: string
  text: string
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
    },
    body: JSON.stringify({
      from,
      to: [to],
      ...(cc && cc.length > 0 ? { cc } : {}),
      subject,
      text,
    }),
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(
      `Erreur Resend ${response.status}: ${responseText || response.statusText}`
    )
  }
}
