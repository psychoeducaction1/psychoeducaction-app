import { defaultInvoiceEmailTemplate, renderInvoiceEmail, type InvoiceEmailTemplate } from '../clinical-finance/invoiceEmailTemplate.ts'

/** Canal distinct de l'assignation en service. Désactivé par défaut. */
export function realInvoiceEmailConfiguration(recipient: string) {
  const mode = process.env.PEA_REAL_INVOICE_EMAIL_MODE
  const contact = process.env.PEA_REAL_CLINIC_EMAIL?.trim().toLowerCase()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  const apiKey = process.env.RESEND_API_KEY
  if (process.env.PEA_CLINICAL_RUNTIME !== 'real-db' || !(['allowlist','live'].includes(mode ?? '') || mode === 'manual' && process.env.PEA_CONTROLLED_MANUAL_INVOICE_EMAIL === 'true')
    || !contact || !from || !apiKey || !recipient) throw new Error('REAL_INVOICE_EMAIL_DISABLED')
  const sender = from.match(/<([^<>]+)>$/)?.[1]?.toLowerCase() ?? from.toLowerCase()
  if (sender !== contact) throw new Error('REAL_INVOICE_SENDER_MISMATCH')
  if (mode === 'allowlist' && recipient.toLowerCase() !==
      process.env.PEA_REAL_INVOICE_TEST_RECIPIENT?.trim().toLowerCase())
    throw new Error('REAL_INVOICE_RECIPIENT_NOT_ALLOWED')
  return { apiKey, from }
}

export async function sendRealInvoiceEmail(input: {
  to: string; number: number; pdfBase64: string; invoiceId: string; renderedMessage?: InvoiceEmailTemplate;
}): Promise<{ id: string }> {
  const { apiKey, from } = realInvoiceEmailConfiguration(input.to)
  const { subject, text } = input.renderedMessage ?? renderInvoiceEmail(defaultInvoiceEmailTemplate, input.number)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `clinical-invoice/${input.invoiceId}` },
    body: JSON.stringify({ from, to: [input.to],
      subject, text,
      attachments: [{ filename: `facture-${input.number}.pdf`, content: input.pdfBase64,
        content_type: 'application/pdf' }] }),
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error('REAL_INVOICE_PROVIDER_REJECTED')
  if (!result || typeof result !== 'object' || !('id' in result)
    || typeof result.id !== 'string') throw new Error('REAL_INVOICE_PROVIDER_UNCERTAIN')
  return { id: result.id }
}
