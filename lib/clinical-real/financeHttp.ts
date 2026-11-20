import { realClinicalTransport } from './transport.ts'
import { createHash } from 'node:crypto'
import { renderRealInvoicePdf, type RealInvoice } from './invoicePdf.ts'
import { renderRealFeeStatementPdf } from './feeStatementPdf.ts'
import { realInvoiceEmailConfiguration, sendRealInvoiceEmail } from './invoiceEmail.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })

function value(body: Record<string, unknown>, key: string): unknown { return body[key] }
function id(body: Record<string, unknown>, key: string): string {
  const candidate = value(body, key)
  if (typeof candidate !== 'string' || !uuid.test(candidate)) throw new Error('INVALID_INPUT')
  return candidate
}
function integer(body: Record<string, unknown>, key: string, min: number, max: number): number {
  const candidate = value(body, key)
  if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < min || candidate > max) throw new Error('INVALID_INPUT')
  return candidate
}
function date(body: Record<string, unknown>, key: string): string {
  const candidate = value(body, key)
  if (typeof candidate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)
    || Number.isNaN(Date.parse(`${candidate}T12:00:00Z`))) throw new Error('INVALID_INPUT')
  return candidate
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('INVALID_INPUT')
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 16_384)) throw new Error('INVALID_INPUT')
  const raw = await request.text()
  if (raw.length > 16_384) throw new Error('INVALID_INPUT')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_INPUT')
  return parsed as Record<string, unknown>
}

/** Les RPC valident les droits de l'acteur et les versions sous verrou SQL. */
export async function handleRealFinanceHttp(request: Request, segments: string[]) {
  try {
    const transport = realClinicalTransport()
    const token = await transport.authenticate(request)
    if (!token) return reply({ code: 'UNAUTHORIZED', error: 'Connexion requise.' }, 401)
    const [area, action, resource, documentAction] = segments
    if (area === 'billing' && request.method === 'GET' && action === 'invoices' && !resource) {
      const status = new URL(request.url).searchParams.get('status')
      if (status && !['open', 'closed'].includes(status)) throw new Error('INVALID_INPUT')
      const reconciliation = await transport.rpc('clinical_reconcile_due_billing', { p_limit: 100 }, token)
      return reply({ invoices: await transport.rpc('clinical_billing_list', { p_status: status }, token), reconciliation })
    }
    if (area === 'billing' && request.method === 'GET' && action === 'invoices'
      && resource && uuid.test(resource) && documentAction === 'pdf') {
      const kind = new URL(request.url).searchParams.get('kind') === 'receipt' ? 'receipt' : 'invoice'
      const invoice = await transport.rpc('clinical_billing_detail', { p_invoice_id: resource }, token) as RealInvoice
      if (kind === 'receipt' && (invoice.status !== 'closed' || invoice.dueCents !== 0))
        return reply({ code: 'RECEIPT_NOT_READY', error: 'Le reçu exige un paiement complet.' }, 409)
      let stored = invoice.status === 'closed'
        ? await transport.rpc('clinical_billing_document', { p_invoice_id: resource, p_kind: kind }, token) as { base64: string; sha256: string } | null
        : null
      let bytes: Uint8Array
      if (stored) {
        bytes = new Uint8Array(Buffer.from(stored.base64, 'base64'))
        if (createHash('sha256').update(bytes).digest('hex') !== stored.sha256) throw new Error('INVOICE_DOCUMENT_HASH_INVALID')
      } else {
        const clinic = { name: process.env.PEA_REAL_CLINIC_NAME ?? '',
          address: process.env.PEA_REAL_CLINIC_ADDRESS ?? '',
          phone: process.env.PEA_REAL_CLINIC_PHONE ?? '', email: process.env.PEA_REAL_CLINIC_EMAIL ?? '' }
        if (!clinic.name || !clinic.address || !clinic.email) throw new Error('INVOICE_CLINIC_CONFIG_REQUIRED')
        bytes = await renderRealInvoicePdf(invoice, clinic)
        const recipient = invoice.status === 'closed' ? await transport.rpc('clinical_billing_recipient_options',
          { p_invoice_id: resource }, token) as { selected?: { email?: string } } : null
        if (invoice.status === 'closed' && recipient?.selected) {
          await transport.rpc('clinical_store_billing_document', { p_invoice_id: resource, p_kind: kind,
            p_base64: Buffer.from(bytes).toString('base64'),
            p_sha256: createHash('sha256').update(bytes).digest('hex') }, token)
          stored = await transport.rpc('clinical_billing_document', { p_invoice_id: resource, p_kind: kind }, token) as { base64: string; sha256: string }
          bytes = new Uint8Array(Buffer.from(stored.base64, 'base64'))
        }
      }
      return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${kind}-${resource}.pdf"`,
        'X-Document-SHA256': createHash('sha256').update(bytes).digest('hex') } })
    }
    if (area === 'billing' && request.method === 'GET' && action === 'invoices' && resource && uuid.test(resource) && !documentAction) {
      return reply({ invoice: await transport.rpc('clinical_billing_detail', { p_invoice_id: resource }, token) })
    }
    if (area === 'billing' && request.method === 'GET' && action === 'recipients' && resource && uuid.test(resource)) {
      return reply({ recipients: await transport.rpc('clinical_billing_recipient_options',
        { p_invoice_id: resource }, token) })
    }
    if (area === 'billing' && request.method === 'GET' && action === 'opening-fee' && resource && uuid.test(resource)) {
      return reply({ policy: await transport.rpc('clinical_opening_fee_policy',
        { p_patient_id: resource }, token) })
    }
    if (area === 'billing' && request.method === 'GET' && action === 'settings' && !resource) {
      return reply({ settings: await transport.rpc('clinical_billing_settings', {}, token) })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'statements' && !resource) {
      const professionalId = new URL(request.url).searchParams.get('professionalId')
      if (professionalId && !uuid.test(professionalId)) throw new Error('INVALID_INPUT')
      return reply({ statements: await transport.rpc('clinical_fee_list', { p_professional_id: professionalId }, token) })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'statements'
      && resource && uuid.test(resource) && documentAction === 'pdf') {
      const detail = await transport.rpc('clinical_fee_statement_detail', { p_statement_id: resource }, token)
      const bytes = await renderRealFeeStatementPdf(detail)
      return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="releve-honoraires-${resource}.pdf"`,
        'X-Document-SHA256': createHash('sha256').update(bytes).digest('hex') } })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'contracts' && !resource) {
      const professionalId = new URL(request.url).searchParams.get('professionalId')
      if (!professionalId || !uuid.test(professionalId)) throw new Error('INVALID_INPUT')
      return reply({ contracts: await transport.rpc('clinical_fee_contracts', {
        p_professional_id: professionalId,
      }, token) })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'cancellations' && !resource) {
      const query = new URL(request.url).searchParams
      const professionalId = query.get('professionalId')
      const serviceDate = query.get('serviceDate')
      if (!professionalId || !uuid.test(professionalId) || !serviceDate) throw new Error('INVALID_INPUT')
      return reply({ appointments: await transport.rpc('clinical_fee_cancellation_candidates', {
        p_professional_id: professionalId, p_service_date: date({ serviceDate }, 'serviceDate'),
      }, token) })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'billable-activities' && !resource) {
      const query = new URL(request.url).searchParams
      const professionalId = query.get('professionalId')
      const serviceDate = query.get('serviceDate')
      const kind = query.get('kind')
      if (!professionalId || !uuid.test(professionalId) || !serviceDate
        || !['report', 'travel'].includes(kind ?? '')) throw new Error('INVALID_INPUT')
      return reply({ appointments: await transport.rpc('clinical_fee_billable_activities', {
        p_professional_id: professionalId, p_service_date: date({ serviceDate }, 'serviceDate'),
        p_kind: kind,
      }, token) })
    }
    if (area === 'fees' && request.method === 'GET' && action === 'preview' && !resource) {
      const query = new URL(request.url).searchParams
      const professionalId = query.get('professionalId')
      const from = query.get('from'), to = query.get('to')
      if (!professionalId || !uuid.test(professionalId) || !from || !to
        || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
        || Number.isNaN(Date.parse(`${from}T12:00:00Z`))
        || Number.isNaN(Date.parse(`${to}T12:00:00Z`))) throw new Error('INVALID_INPUT')
      return reply({ preview: await transport.rpc('clinical_fee_preview', {
        p_professional_id: professionalId, p_from: from, p_to: to,
      }, token) })
    }
    if (request.method !== 'POST') return reply({ code: 'NOT_FOUND', error: 'Ressource introuvable.' }, 404)
    const body = await bodyOf(request)
    if (area === 'billing' && action === 'settings' && !resource) {
      return reply({ settings: await transport.rpc('clinical_set_billing_settings', {
        p_opening_fee_cents: integer(body, 'openingFeeCents', 0, 1_000_000),
        p_first_reminder_days: integer(body, 'firstReminderDays', 1, 89),
        p_second_reminder_days: integer(body, 'secondReminderDays', 2, 90),
        p_expected_version: integer(body, 'version', 1, 1_000_000),
      }, token) })
    }
    if (area === 'billing' && action === 'reconcile' && !resource) {
      return reply({ result: await transport.rpc('clinical_reconcile_billing', { p_case_id: id(body, 'caseId') }, token) })
    }
    if (area === 'billing' && action === 'opening-fee' && !resource) {
      const decision = value(body, 'decision')
      const reason = value(body, 'reason')
      if (!['charge', 'waive'].includes(String(decision)) || typeof reason !== 'string'
        || reason.trim().length < 3 || reason.length > 300) throw new Error('INVALID_INPUT')
      await transport.rpc('clinical_set_opening_fee_policy', {
        p_patient_id: id(body, 'patientId'), p_decision: decision, p_reason: reason.trim(),
      }, token)
      return reply({ saved: true })
    }
    if (area === 'billing' && action === 'recipient' && !resource) {
      const address = value(body, 'address')
      if (typeof address !== 'string' || address.length > 500) throw new Error('INVALID_INPUT')
      await transport.rpc('clinical_select_billing_recipient', {
        p_invoice_id: id(body, 'invoiceId'), p_payer_id: id(body, 'payerId'),
        p_address: address.trim(), p_expected_version: integer(body, 'version', 1, 1_000_000),
      }, token)
      return reply({ saved: true })
    }
    if (area === 'billing' && action === 'send' && !resource) {
      const invoiceId = id(body, 'invoiceId')
      const version = integer(body, 'version', 1, 1_000_000)
      // La configuration et le destinataire sont vérifiés avant toute fermeture.
      const options = await transport.rpc('clinical_billing_recipient_options',
        { p_invoice_id: invoiceId }, token) as { selected?: { email?: string } }
      const recipient = options.selected?.email ?? ''
      try { realInvoiceEmailConfiguration(recipient) }
      catch { return reply({ code: 'EMAIL_DISABLED', error: 'L’envoi des factures reste désactivé.' }, 503) }
      let invoice = await transport.rpc('clinical_billing_detail', { p_invoice_id: invoiceId }, token) as RealInvoice & { version: number }
      if (invoice.version !== version) return reply({ code: 'CONFLICT', error: 'La facture a changé.' }, 409)
      if (invoice.status === 'open') invoice = await transport.rpc('clinical_billing_close',
        { p_invoice_id: invoiceId, p_expected_version: version }, token) as RealInvoice & { version: number }
      // Le même chemin authentifié fige le PDF avant l’envoi.
      const pdfResponse = await handleRealFinanceHttp(new Request(request.url, {
        headers: { Authorization: request.headers.get('authorization') ?? '' },
      }), ['billing', 'invoices', invoiceId, 'pdf'])
      if (!pdfResponse.ok) throw new Error('REAL_INVOICE_PDF_UNAVAILABLE')
      const document = await transport.rpc('clinical_billing_document',
        { p_invoice_id: invoiceId, p_kind: 'invoice' }, token) as { base64: string; sha256: string }
      const claim = await transport.rpc('clinical_billing_send_claim',
        { p_invoice_id: invoiceId, p_expected_version: invoice.version }, token) as {
        status: string; attemptId?: string; recipientEmail?: string; documentSha256?: string
      }
      if (claim.status === 'sent') return reply({ sent: true, alreadySent: true })
      if (!claim.attemptId || claim.recipientEmail !== recipient || claim.documentSha256 !== document.sha256)
        return reply({ code: 'SEND_PENDING', error: 'L’envoi est déjà en cours ou doit être vérifié.' }, 409)
      try {
        const provider = await sendRealInvoiceEmail({ to: recipient, number: Number(invoice.number),
          pdfBase64: document.base64, invoiceId })
        await transport.rpc('clinical_billing_send_finish', { p_invoice_id: invoiceId,
          p_attempt_id: claim.attemptId, p_status: 'sent', p_provider_id: provider.id }, token)
        return reply({ sent: true })
      } catch (cause) {
        await transport.rpc('clinical_billing_send_finish', { p_invoice_id: invoiceId,
          p_attempt_id: claim.attemptId,
          p_status: cause instanceof Error && cause.message === 'REAL_INVOICE_PROVIDER_REJECTED' ? 'failed' : 'uncertain',
          p_provider_id: null }, token)
        return reply({ code: 'SEND_UNCONFIRMED', error: 'L’envoi n’a pas été confirmé. Vérifiez le journal avant de réessayer.' }, 502)
      }
    }
    if (area === 'billing' && action === 'appointment-policy' && !resource) {
      const reason = value(body, 'reason')
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300
        || typeof value(body, 'billable') !== 'boolean') throw new Error('INVALID_INPUT')
      await transport.rpc('clinical_set_appointment_billable', {
        p_appointment_id: id(body, 'appointmentId'),p_billable: body.billable,p_reason: reason.trim(),
      }, token)
      return reply({ saved: true })
    }
    if (area === 'billing' && action === 'appointment-revision' && !resource) {
      await transport.rpc('clinical_set_appointment_billing_revision', {
        p_appointment_id: id(body, 'appointmentId'), p_revision_id: id(body, 'revisionId'),
      }, token)
      return reply({ saved: true })
    }
    if (area === 'billing' && action === 'close' && !resource) {
      return reply({ invoice: await transport.rpc('clinical_billing_close', {
        p_invoice_id: id(body, 'invoiceId'), p_expected_version: integer(body, 'version', 1, 1_000_000),
      }, token) })
    }
    if (area === 'billing' && action === 'payment' && !resource) {
      const method = value(body, 'method')
      if (typeof method !== 'string' || !['cash', 'transfer', 'cheque', 'card_external', 'other'].includes(method)) throw new Error('INVALID_INPUT')
      const receivedAt = value(body, 'receivedAt')
      if (typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt))) throw new Error('INVALID_INPUT')
      return reply({ invoice: await transport.rpc('clinical_billing_payment', {
        p_invoice_id: id(body, 'invoiceId'), p_operation_key: id(body, 'operationKey'),
        p_amount_cents: integer(body, 'amountCents', 1, 100_000_000), p_method: method,
        p_received_at: receivedAt, p_expected_version: integer(body, 'version', 1, 1_000_000),
      }, token) })
    }
    if (area === 'fees' && action === 'contracts' && !resource) {
      const rule = value(body, 'rule'), category = value(body, 'category')
      const supervisorId = value(body, 'supervisorId'), reason = value(body, 'reason')
      if (typeof rule !== 'string' || !['standard','legacy_80','legacy_supervised_110_35',
        'owner_full_clinic','service_libre'].includes(rule)
        || (category !== null && (typeof category !== 'string' || ![
          'intervenant_psychoeducation','psychoeducateur_membre_ordre','psychotherapeute'].includes(category)))
        || (supervisorId !== null && (typeof supervisorId !== 'string' || !uuid.test(supervisorId)))
        || typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 2000)
        throw new Error('INVALID_INPUT')
      return reply({ contract: await transport.rpc('clinical_set_fee_contract', {
        p_professional_id: id(body, 'professionalId'), p_effective_from: date(body, 'effectiveFrom'),
        p_rule: rule, p_category: category, p_supervisor_id: supervisorId,
        p_reason: reason.trim(),
      }, token) })
    }
    if (area === 'fees' && action === 'adjustments' && !resource) {
      const kind = value(body, 'kind'), reason = value(body, 'reason')
      if (typeof kind !== 'string' || !['report','travel','cancellation'].includes(kind)
        || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 2000)
        throw new Error('INVALID_INPUT')
      return reply({ adjustment: await transport.rpc('clinical_add_fee_adjustment', {
        p_professional_id: id(body, 'professionalId'), p_service_date: date(body, 'serviceDate'),
        p_kind: kind, p_client_amount_cents: integer(body, 'clientAmountCents', 0, 100_000_000),
        p_duration_minutes: integer(body, 'durationMinutes', 0, 720),
        p_meeting_equivalent_half_units: integer(body, 'meetingEquivalentHalfUnits', 0, 2),
        p_appointment_id: id(body, 'appointmentId'),
        p_reason: reason.trim(),
      }, token) })
    }
    if (area === 'fees' && action === 'validate' && !resource) {
      const expectedHash = value(body, 'quoteHash')
      if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('INVALID_INPUT')
      return reply({ statement: await transport.rpc('clinical_fee_validate', {
        p_professional_id: id(body, 'professionalId'), p_from: date(body, 'from'), p_to: date(body, 'to'),
        p_expected_hash: expectedHash,
      }, token) })
    }
    return reply({ code: 'NOT_FOUND', error: 'Ressource introuvable.' }, 404)
  } catch (error) {
    if (error instanceof Error && (error.message === 'INVALID_INPUT' || error instanceof SyntaxError))
      return reply({ code: 'INVALID_INPUT', error: 'Paramètres invalides.' }, 400)
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null
    if (code === '42501') return reply({ code: 'FORBIDDEN', error: 'Accès refusé.' }, 403)
    if (code === '40001') return reply({ code: 'CONFLICT', error: 'Les données ont changé. Actualisez la page.' }, 409)
    if (code === '22023') return reply({ code: 'INVALID_STATE', error: 'Les paramètres, le contrat ou la période doivent être vérifiés.' }, 409)
    return reply({ code: 'REAL_FINANCE_UNAVAILABLE', error: 'La facturation est indisponible.' }, 503)
  }
}
