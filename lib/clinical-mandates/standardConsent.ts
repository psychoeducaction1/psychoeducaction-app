import { withAiConsentClause } from '@/lib/clinical-mandates/aiConsent'

/** Laboratory model adapted from the sections of the supplied Psylog convention. */
export const STANDARD_CONSENT_HEADING = 'CADRE DES SERVICES ET CONSENTEMENT CLINIQUE'

export const STANDARD_CLINICAL_CONSENT = `${STANDARD_CONSENT_HEADING}

Services et démarche. Le professionnel explique la nature du service indiqué dans ce mandat, ses objectifs, son approche et les limites de son intervention. Les rencontres peuvent être individuelles, familiales ou de groupe selon ce qui est convenu. La fréquence et la durée du suivi sont adaptées aux besoins du client et peuvent être révisées avec lui.

Participation et choix. Le client peut poser des questions, discuter des objectifs, refuser une intervention ou mettre fin au suivi. Le travail clinique peut susciter temporairement des émotions difficiles. Le professionnel présente les options pertinentes et documente les décisions prises avec le client.

Confidentialité. Les renseignements sont conservés au dossier clinique et accessibles seulement aux personnes autorisées dans le cadre de leurs fonctions. Les limites de la confidentialité, notamment une obligation légale de signalement ou une situation de danger sérieux et immédiat, sont expliquées au client. La communication à un tiers suit les autorisations applicables, sauf obligation légale. Le dossier peut être consulté dans le cadre de l'inspection professionnelle prévue par les règles applicables.

Supervision et continuité. Lorsqu'un superviseur est désigné dans ce mandat, le professionnel peut discuter avec lui des informations nécessaires au suivi; leurs rôles sont précisés au client. En cas de changement de professionnel, l'accès aux notes antérieures est limité aux personnes autorisées pour assurer la continuité du suivi.

Rencontres à distance. Une rencontre par vidéoconférence exige un lieu suffisamment privé, une connexion adéquate et des précautions de confidentialité de chaque participant. Une difficulté technique peut nécessiter une autre modalité ou le report de la rencontre.

Enregistrement et aide à la note. Le consentement ci-dessous couvre l'enregistrement audio, la transcription et l'aide à la rédaction de la note. Le professionnel relit et valide la note clinique avant son inscription au dossier. Les personnes supplémentaires audibles donnent leur propre accord. Le retrait du consentement empêche les nouveaux enregistrements et traitements concernés.`

export const STANDARD_ADMINISTRATIVE_CONSENT = `MODALITÉS DE LA CONVENTION

Le service, le professionnel, la date de référence et, le cas échéant, le superviseur sont ceux indiqués dans le mandat. Le tarif applicable, son unité de facturation et la répartition entre responsables des honoraires figurent dans la présente convention et ses annexes. Les services complémentaires convenus, comme les échanges prolongés avec des tiers, sont facturés selon le tarif et les modalités communiqués avant leur réalisation.

Les factures sont adressées aux payeurs désignés. Un paiement peut être enregistré avant l'envoi d'une facture; un reçu peut être transmis selon le choix fait au paiement. La carte enregistrée, si applicable, ne vaut pas autorisation de débit automatique. Les conditions de report, d'absence et d'annulation sont celles de la politique de la clinique applicable à ce mandat et doivent être communiquées au client.

La personne signataire reconnaît avoir pu poser ses questions sur les services, les honoraires et les modalités de communication et de paiement. Toute modification d'une convention préparée ou signée crée une nouvelle version à examiner et à signer; les versions et signatures antérieures restent conservées.`

export function withStandardClinicalConsent(text: string): string {
  const base = text.includes(STANDARD_CONSENT_HEADING) ? text.trim() : `${STANDARD_CLINICAL_CONSENT}\n\n${text.trim()}`.trim()
  return withAiConsentClause(base)
}

export function withStandardAdministrativeConsent(text: string): string {
  return text.includes('MODALITÉS DE LA CONVENTION') ? text.trim() : `${STANDARD_ADMINISTRATIVE_CONSENT}\n\n${text.trim()}`.trim()
}
