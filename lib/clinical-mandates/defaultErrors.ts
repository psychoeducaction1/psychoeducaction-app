/** Only these fixed prerequisite codes may cross the database boundary. */
const messages: Record<string, string> = {
  SUPERVISION_NOTES_PENDING: 'Terminez les notes en cours et leurs cosignatures avant de changer la supervision de ce dossier.',
  MANDATE_SUPERVISOR_SIGNATURE_REQUIRED: 'La superviseure doit enregistrer sa signature dans son profil avant de préparer la convention.',
  MANDATE_INVALID_SUPERVISOR: 'Choisissez un superviseur clinique actif, différent du professionnel intervenant.',
  MIGRATION_SERVICE_REQUIRED: 'Choisissez le service de chaque dossier avant de simuler ou confirmer le lot.',
  MANDATE_AGE_REQUIRED: 'Renseignez la date de naissance du client avant de créer son mandat.',
  MANDATE_PARENT_PAYER_REQUIRED: 'Renseignez un requérant responsable du paiement pour ce client de moins de 14 ans avant de créer son mandat.',
  MANDATE_REQUESTER_PAYER_REQUIRED: 'Renseignez un requérant responsable du paiement pour ce client de moins de 14 ans avant de créer son mandat.',
  MANDATE_FINANCIAL_TERMS_REQUIRED: 'Renseignez le tarif et les payeurs du mandat, avec une répartition totale de 100 %.',
  MANDATE_SERVICE_MAPPING_REQUIRED: 'Associez le service demandé à un service de la clinique avant de créer le mandat.',
  MANDATE_RATE_REQUIRED: 'Configurez un tarif applicable au service et au professionnel avant de créer le mandat.',
  MANDATE_TEMPLATE_REQUIRED: 'Configurez le gabarit de convention du service avant de créer le mandat.',
}

export function mandateDefaultFailure(error: unknown): { code: string; message: string; status: 400 } | null {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '22023'
    || !('message' in error) || typeof error.message !== 'string'
    || !Object.hasOwn(messages, error.message)) return null
  return { code: error.message, message: messages[error.message], status: 400 }
}
