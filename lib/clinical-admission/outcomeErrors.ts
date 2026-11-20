export const assignmentEncounterCode = 'ASSIGNMENT_ENCOUNTER_EXISTS'
export const assignmentEncounterLinkCode = 'ASSIGNMENT_ENCOUNTER_LINK_REQUIRED'
export const assignmentEncounterLinkMessage = 'Le dossier clinique de ce service pris doit être vérifié par la direction avant de pouvoir choisir « Service non pris ». Aucun changement n’a été enregistré.'
export const assignmentEncounterMessage = 'Une rencontre a déjà eu lieu dans ce dossier. Le statut « Service non pris » ne peut plus être utilisé. Ouvrez la fiche client, puis « Statut du dossier » pour fermer le dossier.'

export function isAssignmentEncounterFailure(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const error = cause as { code?: unknown; message?: unknown }
  return error.code === assignmentEncounterCode || error.code === '40001' && error.message === assignmentEncounterCode
}

export function isAssignmentEncounterLinkFailure(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const error = cause as { code?: unknown; message?: unknown }
  return error.code === assignmentEncounterLinkCode || error.code === '40001' && error.message === assignmentEncounterLinkCode
}
