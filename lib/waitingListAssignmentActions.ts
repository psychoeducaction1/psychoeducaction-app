import { buildServiceAppointment, type ServiceOfficeAddresses } from '@/lib/serviceAppointment'

type Authorization = { actorId: string } | { error: string; status: number }
type Dependencies = {
  officeAddresses?: () => ServiceOfficeAddresses
  authorize: () => Promise<Authorization>
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}

export type WaitingListAssignmentAction = 'assign' | 'restore' | 'mark_off_platform'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const errors: Record<string, { status: number; message: string }> = {
  DIRECTION_REQUIRED: { status: 403, message: 'Accès réservé à la direction.' },
  PLATFORM_ACCESS_DISABLED: { status: 403, message: 'Votre accès à la plateforme est désactivé.' },
  WAITING_CLIENT_NOT_FOUND: { status: 404, message: 'Le dossier source est introuvable.' },
  PROFESSIONAL_UNAVAILABLE: { status: 409, message: 'Ce professionnel est archivé ou introuvable.' },
  NO_ASSIGNMENT_CAPACITY: { status: 409, message: 'Ce professionnel n’a aucune demande active avec place restante.' },
  ACTIVE_ASSIGNMENT_EXISTS: { status: 409, message: 'Ce dossier possède déjà une assignation en attente ou un service pris. Annulez cette assignation avant de le remettre en attente ou de le reclasser.' },
  ACTIVE_ASSIGNMENT_PROCESS: { status: 409, message: 'Une démarche d’assignation est en cours. Utilisez les actions de cette démarche pour conserver son historique.' },
  WAITING_CLIENT_NOT_ASSIGNABLE: { status: 409, message: 'Ce dossier n’est plus en attente. Actualisez la liste avant de l’assigner.' },
  ASSIGNMENT_PROCESS_MISMATCH: { status: 409, message: 'La démarche ou le professionnel a changé. Actualisez la fiche.' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: 'Cette tentative correspond à une autre opération. Actualisez la fiche.' },
  ASSIGNMENT_RETIRED: { status: 409, message: 'Cette assignation a été annulée ou supprimée. Actualisez la fiche avant une nouvelle opération.' },
  SERVICE_APPOINTMENT_REQUIRED: { status: 400, message: 'La date, l’heure et la modalité du rendez-vous sont obligatoires avant de confirmer le service pris.' },
}

export async function runWaitingListAssignmentAction(
  action: WaitingListAssignmentAction, clientId: string, body: unknown, dependencies: Dependencies
) {
  const actor = await dependencies.authorize()
  if ('error' in actor) return { status: actor.status, body: { error: actor.error } }
  if (!uuid.test(clientId)) return { status: 400, body: { error: 'Identifiant de dossier invalide.' } }
  let name: string
  let args: Record<string, unknown>
  if (action === 'assign') {
    const input = body as Record<string, unknown> | null
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.professionalId !== 'string' || !uuid.test(input.professionalId)
      || typeof input.idempotencyKey !== 'string' || !uuid.test(input.idempotencyKey)
      || (input.outcome !== 'pending' && input.outcome !== 'service_taken')
      || (input.assignmentProcessId != null && (typeof input.assignmentProcessId !== 'string' || !uuid.test(input.assignmentProcessId)))) {
      return { status: 400, body: { error: 'Les paramètres de l’assignation sont invalides.' } }
    }
    name = 'create_waiting_list_assignment'
    args = {
      p_waiting_list_client_id: clientId, p_professional_id: input.professionalId,
      p_outcome: input.outcome, p_idempotency_key: input.idempotencyKey,
      p_assignment_process_id: input.assignmentProcessId ?? null, p_actor_id: actor.actorId,
    }
    if (input.outcome === 'service_taken') {
      try {
        args.p_appointment = buildServiceAppointment(input.appointment, dependencies.officeAddresses?.() ?? { montreal: '', longueuil: '' })
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : 'Rendez-vous invalide.' } }
      }
      name = 'create_scheduled_waiting_list_assignment'
    } else if (input.appointment != null) {
      return { status: 400, body: { error: 'Un rendez-vous confirmé exige le statut service pris.' } }
    }
  } else {
    name = 'transition_unassigned_waiting_list_client'
    args = { p_waiting_list_client_id: clientId, p_action: action, p_actor_id: actor.actorId }
  }
  const { data, error } = await dependencies.rpc(name, args)
  if (error) {
    const failure = errors[error.message]
    if (failure) return { status: failure.status, body: { error: failure.message } }
    // Une ancienne base échoue sans reprendre les écritures navigateur non atomiques.
    const migrationMissing = error.code === 'PGRST202' || error.code === '42883'
    return { status: migrationMissing ? 503 : 500, body: { error: migrationMissing
      ? 'La mise à jour transactionnelle des assignations doit être appliquée avant cette action.'
      : 'L’opération n’a pas pu être confirmée. Actualisez la fiche avant de réessayer.' } }
  }
  if (!data || typeof data !== 'object') return { status: 500, body: { error: 'Le résultat de l’opération est introuvable. Actualisez la fiche.' } }
  return { status: 200, body: data }
}
