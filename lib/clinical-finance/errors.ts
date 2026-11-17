/** Only known domain codes leave the RPC boundary; raw database messages stay private. */
export const financialErrors: Record<string, string> = { CLINICAL_FEE_CONTRACT_REQUIRED: 'Une entente d’honoraires applicable à la date de la rencontre manque. Vérifiez les contrats dans Honoraires.', BILLING_FINANCIAL_TERMS_REQUIRED: 'Le mandat ne contient pas encore toutes les conditions financières nécessaires. Vérifiez le tarif et les payeurs.', BILLING_PAYER_TOTAL: 'La répartition des payeurs du mandat doit totaliser 100 %.', BILLING_RATE_UNSUPPORTED: 'Le tarif du mandat ne permet pas de facturer cette prestation.', BILLING_TRAVEL_RATE_REQUIRED: 'Le tarif de déplacement applicable à cette date manque.', ACTIVITY_FINANCE_MANDATE_CHANGED: 'Les conditions financières de la rencontre diffèrent du mandat. Vérifiez-les avant de préparer la facture.' }
export function financialFailureCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('message' in value) || typeof value.message !== 'string') return null
  return Object.hasOwn(financialErrors, value.message) ? value.message : null
}
