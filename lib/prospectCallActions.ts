import { INTAKE_CALL_MINUTES, INTAKE_SLOT_MINUTES, isValidIntakeSlot } from '@/lib/publicIntakeSchedule'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Dependencies = {
  authorize: () => Promise<{ actorId: string } | { error: string; status: number }>
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export async function runProspectCallAction(
  action: 'outcome' | 'followup', id: string, body: unknown, dependencies: Dependencies, now = new Date()
) {
  const authorization = await dependencies.authorize()
  if ('error' in authorization) return { status: authorization.status, body: { error: authorization.error } }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const reason = typeof input.outcomeReason === 'string' ? input.outcomeReason.trim().slice(0, 1000) : ''
  const currentAppointmentId = input.appointmentId == null ? null : input.appointmentId
  if (!uuid.test(id) || (currentAppointmentId !== null && (typeof currentAppointmentId !== 'string' || !uuid.test(currentAppointmentId)))) {
    return { status: 400, body: { error: 'Identifiant invalide.' } }
  }
  if (!reason) return { status: 400, body: { error: 'Précisez la situation avant d’enregistrer.' } }
  const args: Record<string, unknown> = {
    p_prospect_id: id, p_actor_id: authorization.actorId, p_outcome_reason: reason,
    p_current_appointment_id: currentAppointmentId,
  }
  if (action === 'outcome') {
    if (input.status !== 'other' && input.status !== 'service_not_taken') {
      return { status: 400, body: { error: 'Résultat invalide.' } }
    }
    args.p_status = input.status
  } else {
    const startAt = typeof input.startAt === 'string' ? new Date(input.startAt) : new Date('invalid')
    if (!isValidIntakeSlot(startAt, now) || startAt.getUTCSeconds() !== 0 || startAt.getUTCMilliseconds() !== 0
      || typeof input.idempotencyKey !== 'string' || !uuid.test(input.idempotencyKey)) {
      return { status: 400, body: { error: 'Le nouveau créneau ou la clé de réservation est invalide.' } }
    }
    Object.assign(args, {
      p_start_at: startAt.toISOString(),
      p_end_at: new Date(startAt.getTime() + INTAKE_CALL_MINUTES * 60_000).toISOString(),
      p_buffer_end_at: new Date(startAt.getTime() + INTAKE_SLOT_MINUTES * 60_000).toISOString(),
      p_idempotency_key: input.idempotencyKey,
    })
  }
  const { data, error } = await dependencies.rpc(action === 'outcome' ? 'record_prospect_call_outcome' : 'create_prospect_followup_appointment', args)
  if (error) {
    const errors: Record<string, { status: number; error: string }> = {
      DIRECTION_REQUIRED: { status: 403, error: 'Accès réservé à la direction.' },
      PROSPECT_NOT_FOUND: { status: 404, error: 'Prospect introuvable.' },
      PROSPECT_ALREADY_TRANSFERRED: { status: 409, error: 'Ce dossier a déjà été transféré vers la liste d’attente.' },
      SLOT_UNAVAILABLE: { status: 409, error: 'Ce créneau n’est plus disponible. Choisissez une autre heure.' },
      APPOINTMENT_MISMATCH: { status: 409, error: 'Le rendez-vous ne correspond plus à cette fiche. Rechargez-la.' },
      IDEMPOTENCY_CONFLICT: { status: 409, error: 'Cette réservation a déjà été utilisée pour une autre fiche.' },
      INVALID_RANGE: { status: 400, error: 'Le créneau est invalide.' },
    }
    const known = errors[error.message]
    return known ? { status: known.status, body: { error: known.error } }
      : { status: 500, body: { error: 'Enregistrement indisponible. Le traitement serveur des appels doit être configuré.' } }
  }
  return { status: 200, body: data }
}
