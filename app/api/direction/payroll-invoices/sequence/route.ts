import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function authorize(request: NextRequest) {
  const result = await getDirectionContext(request)
  if (result.error) return json({ error: result.error.message }, result.error.status)
  if (!isPayrollAuthorized(result.context.user, result.context.profile)) return json({ error: 'Accès réservé à la paie.' }, 403)
  return null
}
export async function GET(request: NextRequest) {
  const denied = await authorize(request); if (denied) return denied
  const { data, error } = await getSupabaseAdmin().from('payroll_invoice_counters').select('professional_id,prefix,last_number')
  return error ? json({ error: 'Séquences indisponibles.' }, 503) : json({ sequences: data })
}
export async function POST(request: NextRequest) {
  const denied = await authorize(request); if (denied) return denied
  try {
    const body = await readBoundedJsonObject(request, 4096)
    const id = body.professionalId, reference = body.lastReference
    if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) || typeof reference !== 'string') return json({ error: 'Professionnel ou référence invalide.' }, 400)
    const match = /^(PEA-[\p{L}\d-]{1,40})-(\d{1,8})$/u.exec(reference.trim())
    if (!match) return json({ error: 'Indiquez la dernière référence envoyée, par exemple PEA-ABC-009. Pour une première facture, confirmez PEA-ABC-000.' }, 400)
    const admin = getSupabaseAdmin()
    const { data: profile } = await admin.from('profiles').select('id').eq('id', id).eq('role', 'professionnel').maybeSingle()
    if (!profile) return json({ error: 'Professionnel introuvable.' }, 404)
    const { error } = await admin.from('payroll_invoice_counters').insert({ professional_id: id, prefix: match[1], last_number: Number(match[2]), evidence: `Dernière référence confirmée manuellement : ${reference.trim()}` })
    return error ? json({ error: 'Séquence déjà configurée ou préfixe utilisé par un autre professionnel. Aucun compteur modifié.' }, 409) : json({ saved: true })
  } catch (error) { return json({ error: error instanceof JsonBodyError ? error.message : 'Configuration impossible.' }, error instanceof JsonBodyError ? error.status : 400) }
}
