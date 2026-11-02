import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { Packer } from 'docx'
import { createClient } from '@supabase/supabase-js'
import { getDirectionContext } from '@/lib/directionServer'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import { getBearerToken } from '@/lib/superAdminServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { calculatePayroll, isPayrollDate, PAYROLL_CATEGORY_OPTIONS, type PayrollCategory } from '@/lib/payrollCalculator'
import { generatePayrollInvoiceDocumentFromData, toPayrollInvoiceData, type InvoicePeriod } from '@/lib/generatePayrollInvoiceDocx'
import { applyInvoiceEdit } from '@/lib/payrollInvoiceEditor'
import { payrollInvoiceSnapshot, validateInvoiceRevision, type PayrollInvoiceRecord } from '@/lib/payrollInvoiceRegistry'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function authorize(request: NextRequest) {
  const result = await getDirectionContext(request)
  if (result.error) return { error: json({ error: result.error.message }, result.error.status) }
  if (!isPayrollAuthorized({ email: result.context.user.email }, result.context.profile)) {
    return { error: json({ error: 'Accès réservé à la paie.' }, 403) }
  }
  return { actor: result.context }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request)
  if (auth.error) return auth.error
  try {
    const body = await readBoundedJsonObject(request, 16 * 1024 * 1024)
    const professionalId = typeof body.professionalId === 'string' ? body.professionalId : ''
    if (!uuid.test(professionalId)) return json({ error: 'Professionnel invalide.' }, 400)
    const period = body.period as InvoicePeriod | undefined
    if (!period || !isPayrollDate(period.startDate) || !isPayrollDate(period.endDate) || !isPayrollDate(period.dueDate) || period.startDate > period.endDate) {
      return json({ error: 'Période ou échéance invalide.' }, 400)
    }
    const action = body.action ?? 'prepare'
    if (!['prepare', 'revise'].includes(String(action))) return json({ error: 'Action invalide.' }, 400)
    const revision = action === 'revise' ? validateInvoiceRevision(body.reason, body.expectedVersion) : null
    // Profil relu sous les droits de l'utilisateur; aucun profil/total du navigateur accepté.
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${getBearerToken(request)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: profiles, error: profileError } = await supabase.from('profiles')
      .select('id, full_name, email, professional_phone, professional_title, professional_address, payroll_category')
      .eq('role', 'professionnel')
    if (profileError) return json({ error: 'Lecture des profils impossible.' }, 500)
    if (!profiles?.some(p => p.id === professionalId)) return json({ error: 'Professionnel introuvable.' }, 404)
    let snapshot = null
    if (body.edit !== undefined) {
      if (action !== 'revise' || !revision) return json({ error: 'Une rectification nécessite une facture existante.' }, 400)
      const admin = getSupabaseAdmin()
      const { data: invoice } = await admin.from('payroll_invoices').select('id').eq('professional_id', professionalId).eq('period_start', period.startDate).eq('period_end', period.endDate).maybeSingle()
      if (!invoice) return json({ error: 'Facture introuvable.' }, 404)
      const { data: current } = await admin.from('payroll_invoice_versions').select('snapshot').eq('invoice_id', invoice.id).order('version', { ascending: false }).limit(1).maybeSingle()
      if (!current?.snapshot) return json({ error: 'Facture modifiée depuis son ouverture : rechargez la page.' }, 409)
      const saved = current.snapshot as import('@/lib/payrollInvoiceRegistry').PayrollInvoiceSnapshot
      snapshot = payrollInvoiceSnapshot(saved.period, applyInvoiceEdit(saved.invoice, body.edit), saved.sourceSha256)
    } else {
      if (!Array.isArray(body.rows) || body.rows.length > 50000 || !body.rows.every(row => Array.isArray(row) && row.length <= 40 && row.every(cell => cell === null || typeof cell === 'string' || typeof cell === 'number'))) {
        return json({ error: 'Export d’activités invalide.' }, 400)
      }
      const professionals = profiles.map(p => ({ id: p.id, fullName: p.full_name ?? '', email: p.email,
        payrollCategory: PAYROLL_CATEGORY_OPTIONS.includes(p.payroll_category as PayrollCategory) ? p.payroll_category as PayrollCategory : null,
        professionalTitle: p.professional_title, professionalAddress: p.professional_address, professionalPhone: p.professional_phone }))
      const calculation = calculatePayroll(body.rows as unknown[][], professionals, period)
      const result = calculation.professionalResults.find(p => p.professional.id === professionalId)
      if (!result) return json({ error: 'Aucune activité calculable pour ce professionnel.' }, 422)
      if (result.requiresWeeklyReview && body.weeklyContextConfirmed !== true) return json({ error: 'Confirmez les semaines complètes.' }, 422)
      if (calculation.warnings.some(w => !['partial_week', 'out_of_period', 'invalid_duration'].includes(w.type))) {
        return json({ error: 'Corrigez les activités exclues, montants, dates, correspondances et catégories signalés avant émission.' }, 422)
      }
      snapshot = payrollInvoiceSnapshot(period, toPayrollInvoiceData(result), createHash('sha256').update(JSON.stringify(body.rows)).digest('hex'))
    }
    // Registre privé, réservé au serveur; l'identité et le droit paie ont été vérifiés.
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('prepare_payroll_invoice', {
      p_professional_id: professionalId, p_start: period.startDate, p_end: period.endDate, p_actor: auth.actor!.user.id,
      p_snapshot: snapshot, p_action: action, p_expected_version: revision?.expectedVersion ?? null,
      p_reason: revision?.reason ?? null, p_legacy_number: typeof body.legacyNumber === 'string' ? body.legacyNumber : null,
      p_original_base64: null, p_original_sha256: null,
      p_original_name: null, p_original_signed: false,
    })
    if (error) {
      const conflict = /CONFLICT|HISTORICAL/.test(error.message)
      return json({ error: conflict ? error.message : 'Registre de factures indisponible. La migration doit être validée et installée; aucune numérotation locale de remplacement.' }, conflict ? 409 : 503)
    }
    const record = data as PayrollInvoiceRecord
    if (record.snapshot) {
      const doc = generatePayrollInvoiceDocumentFromData(record.snapshot.invoice, record.snapshot.period, null, { record })
      const bytes = await Packer.toBuffer(doc)
      const { error: sealError } = await admin.from('payroll_invoice_versions').update({
        document_base64: bytes.toString('base64'), document_sha256: createHash('sha256').update(bytes).digest('hex'),
        document_name: `Facture-${record.number}-v${record.version}-${record.id}.docx`,
      }).eq('invoice_id', record.id).eq('version', record.version).is('document_base64', null)
      if (sealError) return json({ error: 'Version réservée mais document non finalisé. Réessayez la même demande.' }, 503)
    }
    return json({ record })
  } catch (error) {
    return json({ error: error instanceof JsonBodyError ? error.message : error instanceof Error ? error.message : 'Facture invalide.' }, error instanceof JsonBodyError ? error.status : 422)
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request)
  if (auth.error) return auth.error
  const id = request.nextUrl.searchParams.get('id') ?? ''
  const version = Number(request.nextUrl.searchParams.get('version'))
  const professionalId = request.nextUrl.searchParams.get('professionalId')
  if (professionalId) {
    const start = request.nextUrl.searchParams.get('start') ?? '', end = request.nextUrl.searchParams.get('end') ?? ''
    if (!uuid.test(professionalId) || !isPayrollDate(start) || !isPayrollDate(end) || start > end) return json({ error: 'Recherche invalide.' }, 400)
    const admin = getSupabaseAdmin()
    const { data: invoice, error } = await admin.from('payroll_invoices').select('id, number').eq('professional_id', professionalId)
      .eq('period_start', start).eq('period_end', end).maybeSingle()
    if (error) return json({ error: 'Registre indisponible.' }, 503)
    if (!invoice) return json({ record: null })
    const { data: revision, error: revisionError } = await admin.from('payroll_invoice_versions').select('version, reason, snapshot')
      .eq('invoice_id', invoice.id).order('version', { ascending: false }).limit(1).maybeSingle()
    if (revisionError || !revision) return json({ error: 'Version indisponible.' }, 503)
    return json({ record: { ...invoice, ...revision } })
  }
  if (!uuid.test(id)) return json({ error: 'Identifiant invalide.' }, 400)
  const admin = getSupabaseAdmin()
  if (request.nextUrl.searchParams.get('current') === '1') {
    const { data: invoice, error: invoiceError } = await admin.from('payroll_invoices').select('id, number, professional_id, period_start, period_end').eq('id', id).maybeSingle()
    const { data: current, error: currentError } = await admin.from('payroll_invoice_versions').select('version, reason, snapshot').eq('invoice_id', id).order('version', { ascending: false }).limit(1).maybeSingle()
    if (invoiceError || currentError) return json({ error: 'Lecture impossible.' }, 503)
    if (!invoice || !current?.snapshot) return json({ error: 'Facture sans données modifiables : recalculez sa période depuis l’export.' }, 404)
    return json({ record: { ...invoice, ...current } })
  }
  if (!request.nextUrl.searchParams.has('version')) {
    const { data, error } = await admin.from('payroll_invoice_versions').select('version, reason, original_signed, document_name, document_sha256, created_at')
      .eq('invoice_id', id).order('version', { ascending: false })
    return error ? json({ error: 'Historique indisponible.' }, 503) : json({ versions: data })
  }
  if (!Number.isSafeInteger(version) || version < 1) return json({ error: 'Version invalide.' }, 400)
  const { data, error } = await admin.from('payroll_invoice_versions').select('document_base64, document_name, document_sha256')
    .eq('invoice_id', id).eq('version', version).maybeSingle()
  if (error) return json({ error: 'Registre indisponible.' }, 503)
  if (!data?.document_base64) return json({ error: 'Document introuvable ou non finalisé.' }, 404)
  const bytes = Buffer.from(data.document_base64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== data.document_sha256) return json({ error: 'Intégrité du document non vérifiée.' }, 409)
  return new NextResponse(bytes, { headers: { 'Cache-Control': 'private, no-store',
    'Content-Type': data.document_name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(data.document_name)}` } })
}
