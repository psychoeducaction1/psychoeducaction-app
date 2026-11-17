/** Expose only the provider's error category; never surface its raw response. */
export function clinicalOpenAiFailureMessage(status: number, code: unknown): string {
  if (status !== 429) return 'Le service IA n’a pas pu terminer cet essai.'
  switch (code) {
    case 'credit_balance_exhausted':
    case 'insufficient_quota':
      return 'Le solde de crédits API OpenAI est épuisé. Rechargez le compte API avant de réessayer.'
    case 'project_spend_limit_exceeded':
      return 'Le plafond de dépenses du projet OpenAI est atteint. Vérifiez les limites du projet API.'
    case 'organization_spend_limit_exceeded':
    case 'organization_usage_limit_exceeded':
      return 'La limite de dépenses de l’organisation OpenAI est atteinte. Vérifiez ses limites API.'
    case 'rate_limit_exceeded':
    case 'slow_down':
      return 'Trop de requêtes sont envoyées à OpenAI en ce moment. Attendez quelques instants avant de réessayer.'
    default:
      return 'L’API OpenAI a refusé la requête (limite ou crédits). Vérifiez le solde et les limites du projet API.'
  }
}
