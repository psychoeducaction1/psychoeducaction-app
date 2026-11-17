/** Fixed wording checked against the frozen, signed clinical convention in the laboratory. */
export const AI_CONSENT_CLAUSE = 'Je consens à l’enregistrement audio de mes rencontres, à leur transcription et à l’utilisation d’une aide à la rédaction de notes cliniques par intelligence artificielle. Le texte préparé et dépersonnalisé peut être transmis à un fournisseur externe de rédaction après confirmation du professionnel. Je peux retirer ce consentement à tout moment; aucun nouvel enregistrement ni traitement IA ne sera effectué après ce retrait. Les personnes supplémentaires audibles doivent donner leur propre accord.'

export function withAiConsentClause(text: string): string {
  return text.includes(AI_CONSENT_CLAUSE) ? text : `${text.trim()}\n\n${AI_CONSENT_CLAUSE}`.trim()
}
