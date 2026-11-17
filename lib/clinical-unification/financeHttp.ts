import { financialErrors } from '../clinical-finance/errors.ts'
import { createHash } from 'node:crypto'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { authenticateUnifiedRequest, UnifiedAuthenticationError } from './auth.ts'
import { assertUnificationRuntime } from './isolation.ts'
import { realClinicalTransport } from '../clinical-real/transport.ts'
import { createUnifiedWorkspaceReader } from './workspace.ts'
import { parseUnifiedBillingFilters, projectUnifiedBilling } from './financeProjection.ts'
import { isDurableBillingCommand } from '../clinical-finance/validation.ts'
import { isDurableBillingAck } from '../clinical-finance/transport.ts'
import { isFeeCommand } from '../clinical-finance/feeValidation.ts'
import { isFeeAck, isFeeWorkspace, isFeeQuote } from '../clinical-finance/feeTransport.ts'
import { calculateFeeQuote } from '../clinical-finance/durableFees.ts'

type Transport = ReturnType<typeof realClinicalTransport>
type Dependencies = { transport?: Transport; assertIsolation?: () => void; now?: () => Date }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v)
const id = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
async function body(request: Request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new Error('INVALID_INPUT')
  return readBoundedJsonObject(request, 32768)
}
function pdf(bytes: Uint8Array, name: string) {
  return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${name}.pdf"`, 'X-Document-SHA256': createHash('sha256').update(bytes).digest('hex') } })
}
function storedPdf(value: unknown, name: string) {
  if (!object(value) || typeof value.base64 !== 'string' || typeof value.sha256 !== 'string'
    || value.base64.length > 7_000_000) throw new Error('INVALID_RESPONSE')
  const bytes = new Uint8Array(Buffer.from(value.base64, 'base64'))
  if (createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new Error('DOCUMENT_HASH_INVALID')
  return pdf(bytes, name)
}
/** Receives the original /billing path segments, after the billing prefix. */
export async function handleUnifiedFinanceHttp(originalRequest: Request, segments: string[], deps: Dependencies = {}): Promise<Response> {
  try {
    const assertIsolation = deps.assertIsolation ?? assertUnificationRuntime
    assertIsolation()
    const transport = deps.transport ?? realClinicalTransport()
    let request = originalRequest
    const feeDocument = segments.length === 5 && segments[0] === 'fees' && segments[1] === 'documents' && id(segments[2])
      && ['clinical', 'administration'].includes(segments[3]) && segments[4] === 'download'
    const invoiceDocument = segments.length === 4 && segments[0] === 'documents' && id(segments[1])
      && segments[2] === 'administration' && segments[3] === 'download'
    if (feeDocument || invoiceDocument) {
      const context = segments[feeDocument ? 3 : 2]
      const old = request.headers.get('X-Clinical-Context')
      if (old && old !== context) throw new UnifiedAuthenticationError(403, 'CONTEXT_REFUSED')
      const h = new Headers(request.headers); h.set('X-Clinical-Context', context)
      request = new Request(request, { headers: h })
    }
    const { token, context } = await authenticateUnifiedRequest(request, transport, assertIsolation)
    const rpc = (name: string, args: Record<string, unknown> = {}) => transport.rpc(name, args, token)
    const identity = await createUnifiedWorkspaceReader(transport).identity(token, context)
    if (context !== 'administration' && !(segments[0] === 'fees' && request.method === 'GET'))
      throw new UnifiedAuthenticationError(403, 'FORBIDDEN')
    if (segments.join('/') === 'stripe/card' && request.method === 'GET') {
      const query = new URL(request.url).searchParams
      if (!id(query.get('patientId')) || !id(query.get('payerId')) || [...query.keys()].some(key => !['patientId','payerId'].includes(key)))
        throw new Error('INVALID_INPUT')
      await createUnifiedWorkspaceReader(transport).clientOverview(token, context, query.get('patientId')!)
      // Local isolation deliberately has no card vault or Stripe provider.
      return reply({ enabled: false, mode: 'disabled', hasCard: false, brand: '', last4: '', expMonth: null, expYear: null })
    }
    if (request.method === 'GET' && invoiceDocument)
      return storedPdf(await rpc('clinical_unified_billing_document', { p_document_id: segments[1] }), 'facture')
    if (request.method === 'GET' && feeDocument) {
      return storedPdf(await rpc('clinical_unified_fee_pdf', { p_statement_id: segments[2] }), 'honoraires')
    }
    if (request.method === 'GET' && segments.length === 3 && segments[0] === 'invoices' && id(segments[1]) && segments[2] === 'pdf') {
      const kind = new URL(request.url).searchParams.get('kind') === 'receipt' ? 'receipt' : 'invoice'
      // Preview is read-only. Opening a PDF must never close or number the invoice.
      return storedPdf(await rpc('clinical_unified_invoice_pdf', { p_invoice_id: segments[1], p_kind: kind }), kind)
    }
    if (segments.length === 0 && request.method === 'GET') {
      const { filters, invoiceId } = parseUnifiedBillingFilters(request.url)
      const data = await rpc('clinical_unified_billing_data_870')
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format((deps.now ?? (() => new Date()))())
      const workspace = projectUnifiedBilling(data, identity.actor, filters, invoiceId, day)
      if (workspace.eligibleActivities.some(activity => !activity.prepared)) {
        const fees = await rpc('clinical_unified_fee_workspace', { p_context: context })
        if (!isFeeWorkspace(fees, context, identity.actor.id) || fees.kind !== 'administrative') throw new Error('INVALID_RESPONSE')
        workspace.eligibleActivities = workspace.eligibleActivities.map(activity => {
          const missingContract = !fees.contracts.some(contract => contract.professionalId === activity.professionalId && contract.effectiveFrom <= activity.serviceDate)
          return !activity.prepared && !activity.blockedReason && missingContract ? { ...activity, blockedReason: 'FEE_CONTRACT_REQUIRED' } : activity
        })
      }
      return reply(workspace)
    }
    if (segments.length === 1 && segments[0] === 'fees' && request.method === 'GET') {
      const value = await rpc('clinical_unified_fee_workspace', { p_context: context })
      if (!isFeeWorkspace(value, context, identity.actor.id)) throw new Error('INVALID_RESPONSE')
      return reply(value)
    }
    if (segments.join('/') === 'opening-policy' && ['GET','POST'].includes(request.method)) {
      const b = request.method === 'POST' ? await body(request) : { patientId: new URL(request.url).searchParams.get('patientId') }
      if (!id(b.patientId)) throw new Error('INVALID_INPUT')
      if (request.method === 'POST' && (!exact(b, ['patientId','charge','reason','expectedVersion']) || typeof b.charge !== 'boolean'
        || typeof b.reason !== 'string' || b.reason.length > 500 || !int(b.expectedVersion, 0, 1_000_000))) throw new Error('INVALID_INPUT')
      return reply(await rpc('clinical_unified_opening_policy', { p_patient_id: b.patientId,
        p_charge: request.method === 'POST' ? b.charge : null, p_reason: request.method === 'POST' ? b.reason : null,
        p_expected_version: request.method === 'POST' ? b.expectedVersion : null }))
    }
    if (segments.join('/') === 'settings/reminders' && ['GET','POST'].includes(request.method)) {
      let settings = await rpc('clinical_billing_settings')
      if (!object(settings) || !int(settings.openingFeeCents,0,1_000_000)
        || !int(settings.firstReminderDays,1,89) || !int(settings.secondReminderDays,2,90)
        || Number(settings.firstReminderDays)>=Number(settings.secondReminderDays) || !int(settings.version,1,1_000_000)) throw new Error('BILLING_SETTINGS_NOT_CONFIGURED')
      if (request.method === 'POST') {
        const b = await body(request)
        if (!exact(b, ['firstDays','secondDays','expectedVersion']) || !int(b.firstDays,1,89) || !int(b.secondDays,2,90)
          || Number(b.firstDays) >= Number(b.secondDays) || !int(b.expectedVersion,1,1_000_000)) throw new Error('INVALID_INPUT')
        settings = await rpc('clinical_set_billing_settings', { p_opening_fee_cents: settings.openingFeeCents,
          p_first_reminder_days: b.firstDays, p_second_reminder_days: b.secondDays, p_expected_version: b.expectedVersion })
        if (!object(settings) || !int(settings.firstReminderDays,1,89) || !int(settings.secondReminderDays,2,90)
          || Number(settings.firstReminderDays)>=Number(settings.secondReminderDays) || !int(settings.version,1,1_000_000)) throw new Error('INVALID_RESPONSE')
      }
      return reply({ firstDays: settings.firstReminderDays, secondDays: settings.secondReminderDays, version: settings.version })
    }
    if (segments.join('/') === 'commands' && request.method === 'POST') {
      const b = await body(request), command = { action: b.action, data: b.data }
      if (!exact(b, ['key','action','data']) || !id(b.key) || (!isDurableBillingCommand(command) && !isFeeCommand(command))) throw new Error('INVALID_INPUT')
      // The isolated SQL adapter retains the laboratory's simulated-send transitions.
      // No external provider or delivery queue is imported by this handler.
      let data: Record<string, unknown> = command.data
      if (command.action === 'fee.prepare' || command.action === 'fee.correct') {
        const quote = await rpc('clinical_unified_fee_quote', {
          p_professional_id: command.action === 'fee.prepare' ? command.data.professionalId : null,
          p_from: command.action === 'fee.prepare' ? command.data.from : null,
          p_to: command.action === 'fee.prepare' ? command.data.to : null,
          p_statement_id: command.action === 'fee.correct' ? command.data.statementId : null,
        })
        if (!isFeeQuote(quote) || (command.action === 'fee.prepare'
          ? quote.inputs.professional.id !== command.data.professionalId || quote.from !== command.data.from || quote.to !== command.data.to
          : quote.statementId !== command.data.statementId)) throw new Error('INVALID_RESPONSE')
        // Exact original laboratory calculator; SQL independently checks the source hash and every amount.
        data = { ...data, quoteHash: quote.inputHash, calculation: calculateFeeQuote(quote) }
      }
      const ack = await rpc('clinical_unified_finance_command', { p_key: b.key, p_action: command.action, p_data: data })
      if (isFeeCommand(command) ? !isFeeAck(ack, command.action) : !isDurableBillingAck(ack, command.action)) throw new Error('INVALID_RESPONSE')
      return reply(ack)
    }
    return reply({ code: 'NOT_FOUND', error: 'Ressource financière introuvable.' }, 404)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return reply({ code: 'INVALID_INPUT', error: 'La demande financière est invalide ou trop volumineuse.' }, cause.status)
    if (cause instanceof UnifiedAuthenticationError) return reply({ code: cause.code, error: 'La session ou les droits ne permettent pas cette action.' }, cause.status)
    const code = object(cause) && typeof cause.code === 'string' ? cause.code : cause instanceof Error ? cause.message : 'FINANCE_UNAVAILABLE'
    const status = code === '42501' ? 403 : ['40001','22023'].includes(code) ? 409 : code === 'INVALID_INPUT' ? 400
      : ['0A000','FILTER_NOT_CONNECTED'].includes(code) ? 501 : code === 'INVALID_RESPONSE' ? 502 : 503
    const message = object(cause) && typeof cause.message === 'string' ? cause.message : ''

    if (code === 'FINANCE_RPC_REJECTED') return reply({ code, error: 'L’opération financière a été refusée par la base et n’a pas été enregistrée. La configuration de facturation doit être vérifiée avant de réessayer.' }, 409)
    for (const [key, error] of Object.entries(financialErrors)) if (code === key || message === key) return reply({ code: key, error }, 409)
    if (message.includes('PAYMENT_ADMIN_REQUIRED')) return reply({ code: 'PAYMENT_ADMIN_REQUIRED', error: 'Seuls la Direction et les administrateurs peuvent modifier les paiements.' },403)
    if (message.includes('REPLACEMENT_PAYMENT_REVIEW_REQUIRED')) return reply({ code: 'PAYMENT_REVIEW_REQUIRED', error: 'Retirez ou réaffectez d’abord les paiements de la facture annulée.' },409)
    if (message.includes('INVOICE_VOIDED')) return reply({ code: 'INVOICE_VOIDED', error: 'Cette facture est annulée.' },409)
    if (message.includes('PAYMENT_CORRECTION_BALANCE_INVALID')) return reply({ code: 'PAYMENT_BALANCE_INVALID', error: 'Vérifiez le montant et les remboursements avant de modifier ce paiement.' },409)
    return reply({ code, error: status === 501 ? 'Cette opération financière reste à raccorder; aucune modification n’a été faite.'
      : status === 409 ? 'Les données ou l’état ont changé. Actualisez avant de reprendre.'
      : status === 400 ? 'La demande financière est invalide.' : 'La facturation est temporairement indisponible.' }, status)
  }
}
