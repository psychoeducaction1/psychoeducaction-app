import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { loadWaitingListDuplicateCandidates } from '@/lib/waitingListDuplicates'

const priorities = new Set(['normal', 'urgent', 'existing_or_transfer'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  const { id } = await params
  const body = (await request.json().catch(() => null)) as
    | { priorityLevel?: unknown; consultationReason?: unknown }
    | null
  const priorityLevel = typeof body?.priorityLevel === 'string'
    ? body.priorityLevel
    : ''
  const consultationReason =
    typeof body?.consultationReason === 'string'
      ? body.consultationReason.trim().slice(0, 5000)
      : ''
  if (!priorities.has(priorityLevel)) {
    return NextResponse.json({ error: 'Priorité invalide.' }, { status: 400 })
  }
  if (!consultationReason) {
    return NextResponse.json(
      { error: "Ajoutez le motif de consultation avant le transfert vers la liste d'attente." },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: prospect, error: prospectError } = await supabase
    .from('public_intake_prospects')
    .select('id, first_name, last_name, birth_date, email, phone, waiting_list_client_id')
    .eq('id', id).maybeSingle()
  if (prospectError) return NextResponse.json({ error: 'Vérification du dossier impossible.' }, { status: 500 })
  if (!prospect) return NextResponse.json({ error: 'Prospect introuvable.' }, { status: 404 })
  if (!prospect.waiting_list_client_id) {
    try {
      const matches = await loadWaitingListDuplicateCandidates(supabase, {
        client_name: [prospect.first_name, prospect.last_name].filter(Boolean).join(' '),
        birth_date: prospect.birth_date, contact_email: prospect.email, contact_phone: prospect.phone,
        service_requested: 'Psychoéducation',
      }, 'id, client_name, birth_date, service_requested, contact_email, contact_emails, contact_phone, contact_phones')
      if (matches.length) return NextResponse.json({
        error: 'Une fiche correspondante existe déjà dans la liste des clients. Consultez-la avant de créer un nouveau dossier.',
      }, { status: 409 })
    } catch {
      return NextResponse.json({ error: 'Vérification des doublons impossible. Aucun transfert effectué.' }, { status: 500 })
    }
  }
  const { error: updateError } = await supabase
    .from('public_intake_prospects')
    .update({
      consultation_reason: consultationReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { data, error } = await supabase.rpc(
    'transfer_prospect_to_waiting_list',
    {
      p_prospect_id: id,
      p_priority_level: priorityLevel,
      p_actor_id: direction.context.user.id,
      p_actor_name:
        direction.context.profile.full_name ??
        direction.context.user.email ??
        'Direction',
    }
  )
  if (error) {
    const status = error.message.includes('PROSPECT_NOT_FOUND')
      ? 404
      : error.message.includes('EXISTING_WAITING_LIST_CLIENT') ? 409
        : error.message.includes('DIRECTION_REQUIRED') ? 403 : 500
    return NextResponse.json(
      {
        error:
          status === 404
            ? 'Prospect introuvable.'
            : status === 409
              ? 'Une fiche correspondante existe déjà. Consultez la liste des clients avant de transférer.'
              : status === 403 ? 'Accès réservé à la direction.' : 'Transfert indisponible.',
      },
      { status }
    )
  }
  return NextResponse.json(data)
}
