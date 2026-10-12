type DirectionAuthorization = { actorId: string } | { error: string; status: number }
type RpcError = { message: string; code?: string }
type Dependencies = {
  authorize: () => Promise<DirectionAuthorization>
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: RpcError | null; data: unknown }>
}

// The privileged client is obtained by the route's rpc callback only AFTER authorization.
export async function runProspectTestAction(
  action: 'mark' | 'delete', id: string, body: unknown, dependencies: Dependencies
) {
  const authorization = await dependencies.authorize()
  if ('error' in authorization) return { status: authorization.status, body: { error: authorization.error } }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { status: 400, body: { error: 'Identifiant invalide.' } }
  }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (input.confirmed !== true || (action === 'mark' && typeof input.isTest !== 'boolean')) {
    return { status: 400, body: { error: 'Confirmation explicite requise.' } }
  }
  const { data, error } = await dependencies.rpc(
    action === 'mark' ? 'mark_intake_prospect_test' : 'delete_intake_test_prospect',
    {
      p_prospect_id: id,
      p_actor_id: authorization.actorId,
      ...(action === 'mark' ? { p_is_test: input.isTest } : {}),
    }
  )
  if (error) {
    const errors: Record<string, { status: number; error: string }> = {
      PROSPECT_NOT_FOUND: { status: 404, error: 'Prospect introuvable.' },
      PROSPECT_NOT_TEST: { status: 409, error: 'La suppression est réservée aux dossiers marqués comme tests.' },
      PROSPECT_ALREADY_TRANSFERRED: { status: 409, error: 'Un dossier transféré vers la liste d’attente ne peut pas être supprimé ici.' },
      DIRECTION_REQUIRED: { status: 403, error: 'Accès réservé à la direction.' },
    }
    const known = errors[error.message]
    if (known) return { status: known.status, body: { error: known.error } }
    return { status: 500, body: { error: 'Action impossible. Vérifiez que le script SQL prospects-and-calls.sql a été installé.' } }
  }
  return { status: 200, body: data }
}
