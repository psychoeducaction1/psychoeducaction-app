import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' }
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Direction-only snapshot. Never mint a target session or expose a write endpoint. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await getDirectionContext(request)
  if (access.error) return reply({ error: 'Accès réservé à la direction.' }, access.error.status)
  const { id } = await context.params
  if (!uuid.test(id) || new URL(request.url).search) return reply({ error: 'Professionnel invalide.' }, 400)
  try {
    const db = getSupabaseAdmin()
    const { data: professional, error } = await db.from('profiles')
      .select('id,full_name,email,role,platform_access_enabled,pref_languages,pref_age_ranges,pref_client_groups,pref_service_types,pref_office_locations,pref_meeting_modes,pref_motifs,pref_exclusions,pref_matching_notes')
      .eq('id', id).maybeSingle()
    if (error) throw error
    if (!professional || professional.role !== 'professionnel') return reply({ error: 'Professionnel introuvable.' }, 404)
    const read = async (table: 'assigned_clients' | 'assignment_requests', columns: string) => {
      const rows: Record<string, unknown>[] = []
      for (let offset = 0; offset < 10000; offset += 500) {
        let query = db.from(table).select(columns).eq('professional_id', id).order('id').range(offset, offset + 499)
        if (table === 'assigned_clients') query = query.is('canceled_at', null)
        const response = await query
        if (response.error) throw response.error
        const page = response.data ?? []
        rows.push(...page as unknown as Record<string, unknown>[])
        if (page.length < 500) return rows
      }
      throw new Error('PREVIEW_TOO_LARGE')
    }
    const [assignments, requests] = await Promise.all([
      read('assigned_clients', 'id,assignment_request_id,first_name,last_name,email,phone,requester_name,assigned_date,contacted,is_active,short_comment,meeting_modality,service_address,closure_reason'),
      read('assignment_requests', 'id,professional_id,is_active,requested_count,assigned_count,remaining_count,request_comment,created_at'),
    ])
    return reply({ professional, assignments, requests })
  } catch { return reply({ error: 'Impossible de charger cet aperçu. Réessayez.' }, 503) }
}
