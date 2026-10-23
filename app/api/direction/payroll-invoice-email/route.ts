import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { createHash } from 'node:crypto'
import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'
import type { PayrollInvoiceSnapshot } from '@/lib/payrollInvoiceRegistry'

const ACCOUNTANT_CC_EMAIL = 'DominiqueLeduc@gestionproled.com'

type PayrollInvoiceEmailBody = {
  invoiceId?: unknown
  version?: unknown
  to?: unknown
  subject?: unknown
  message?: unknown
  attachmentBase64?: unknown
  attachmentFileName?: unknown
  professionalId?: unknown
  professionalName?: unknown
  invoiceNumber?: unknown
  paymentDate?: unknown
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} est manquant.`)
  }

  return value
}

async function sendEmailWithAttachment({
  to,
  subject,
  text,
  attachmentBase64,
  attachmentFileName,
}: {
  to: string
  subject: string
  text: string
  attachmentBase64: string
  attachmentFileName: string
}) {
  const apiKey = getRequiredEnv('RESEND_API_KEY')
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    'Assignations PsychoÉducAction <onboarding@resend.dev>'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      cc: [ACCOUNTANT_CC_EMAIL],
      subject,
      text,
      attachments: [
        {
          filename: attachmentFileName,
          content: attachmentBase64,
        },
      ],
    }),
  })

  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(
      `Erreur Resend ${response.status}: ${responseText || response.statusText}`
    )
  }
}

export async function POST(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const actor = directionResult.context

  if (!isPayrollAuthorized({ email: actor.user.email }, actor.profile)) {
    return jsonResponse({ error: 'Accès réservé à la paie.' }, 403)
  }

  let body: PayrollInvoiceEmailBody

  try {
    body = await readBoundedJsonObject(request, 16384) as PayrollInvoiceEmailBody
  } catch (error) {
    return jsonResponse({ error: error instanceof JsonBodyError ? error.message : 'Body JSON invalide.' }, error instanceof JsonBodyError ? error.status : 400)
  }

  const invoiceId = normalizeText(body.invoiceId)
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId) || !Number.isSafeInteger(body.version) || Number(body.version) < 1) {
    return jsonResponse({ error: 'Une facture enregistrée et sa version sont requises.' }, 400)
  }
  const admin = getSupabaseAdmin()
  const { data: invoice, error: invoiceError } = await admin.from('payroll_invoices').select('professional_id, number').eq('id', invoiceId).maybeSingle()
  const { data: revision, error: revisionError } = await admin.from('payroll_invoice_versions')
    .select('snapshot, document_base64, document_name, document_sha256').eq('invoice_id', invoiceId).eq('version', Number(body.version)).maybeSingle()
  if (invoiceError || revisionError) return jsonResponse({ error: 'Registre de factures indisponible.' }, 503)
  if (!invoice || !revision?.snapshot || !revision.document_base64) return jsonResponse({ error: 'Facture non finalisée ou original historique : aucun envoi automatique.' }, 409)
  const snapshot = revision.snapshot as PayrollInvoiceSnapshot
  const bytes = Buffer.from(revision.document_base64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== revision.document_sha256) return jsonResponse({ error: 'Intégrité de la facture invalide.' }, 409)
  const to = normalizeText(snapshot.invoice.professional.email)
  const subject = normalizeText(body.subject)
  const message = normalizeText(body.message)
  const attachmentBase64 = revision.document_base64
  const attachmentFileName = revision.document_name
  const professionalId = invoice.professional_id
  const professionalName = snapshot.invoice.professional.fullName
  const invoiceNumber = invoice.number
  const paymentDate = snapshot.period.dueDate

  if (!to) return jsonResponse({ error: 'Le destinataire est requis.' }, 400)
  if (!subject) return jsonResponse({ error: 'Le sujet est requis.' }, 400)
  if (!message) return jsonResponse({ error: 'Le message est requis.' }, 400)
  if (!attachmentBase64) {
    return jsonResponse({ error: 'La facture en pièce jointe est requise.' }, 400)
  }
  if (!attachmentFileName) {
    return jsonResponse({ error: 'Le nom de la pièce jointe est requis.' }, 400)
  }

  try {
    await sendEmailWithAttachment({
      to,
      subject,
      text: message,
      attachmentBase64,
      attachmentFileName,
    })
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur inconnue pendant l'envoi courriel.",
      },
      500
    )
  }

  try {
    const supabaseAdmin = getSupabaseAdmin()

    await supabaseAdmin.from('audit_logs').insert({
      actor_profile_id: actor.user.id,
      actor_name: actor.profile.full_name ?? actor.user.email ?? null,
      actor_role: actor.profile.role,
      action: 'payroll_invoice_email_sent',
      entity_type: 'profile',
      entity_id: professionalId || null,
      description: `Facture de paie envoyée à ${professionalName || to}.`,
      metadata: {
        professional_id: professionalId || null,
        professional_name: professionalName || null,
        recipient_email: to,
        cc_emails: [ACCOUNTANT_CC_EMAIL],
        invoice_number: invoiceNumber || null,
        invoice_id: invoiceId,
        invoice_version: Number(body.version),
        document_sha256: revision.document_sha256,
        payment_date: paymentDate || null,
        attachment_file_name: attachmentFileName,
      },
    })
  } catch (error) {
    console.error('[payroll-invoice-email] Audit log non bloquant:', {
      message: error instanceof Error ? error.message : 'Erreur inconnue',
    })
  }

  return jsonResponse({ success: true }, 200)
}
