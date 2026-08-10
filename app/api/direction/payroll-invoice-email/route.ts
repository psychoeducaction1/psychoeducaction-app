import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type PayrollInvoiceEmailBody = {
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
    body = (await request.json()) as PayrollInvoiceEmailBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const to = normalizeText(body.to)
  const subject = normalizeText(body.subject)
  const message = normalizeText(body.message)
  const attachmentBase64 = normalizeText(body.attachmentBase64)
  const attachmentFileName = normalizeText(body.attachmentFileName)
  const professionalId = normalizeText(body.professionalId)
  const professionalName = normalizeText(body.professionalName)
  const invoiceNumber = normalizeText(body.invoiceNumber)
  const paymentDate = normalizeText(body.paymentDate)

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
        invoice_number: invoiceNumber || null,
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
