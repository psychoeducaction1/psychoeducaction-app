import 'server-only'
import { CLINICAL_GROUNDING_RULES } from '@/lib/clinicalNoteAnalysisServer'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { clinicalReviewSchema } from '@/lib/clinicalNoteEngineSchemas'
import { parseClinicalAlerts } from '@/lib/clinicalNoteEngine'
import type { ClinicalAnalysis, ClinicalEngineDraft, ClinicalEngineResult, ClinicalSources } from '@/lib/clinicalNoteEngine'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { ClinicalNotesAiError, requestClinicalStructured } from '@/lib/clinicalNotesAiServer'

export async function reviewClinicalDraft(sources: ClinicalSources, analysis: ClinicalAnalysis, draft: ClinicalEngineDraft, noteType: ClinicalNoteType, signal: AbortSignal): Promise<ClinicalEngineResult> {
  const raw = await requestClinicalStructured('clinical_fidelity_review', `${CLINICAL_GROUNDING_RULES}
ÉTAPE CONTRÔLE: vérifie le brouillon ET l'extraction avec les sources originales, pas seulement leurs références. Le JSON structuré ne prouve pas la fidélité. Contrôle: 1 faits soutenus; 2 interventions non inventées; 3 réactions non inventées; 4 observations distinctes des propos; 5 attribution correcte; 6 hypothèses attribuées/provisoires; 7 aucun diagnostic ajouté; 8 aucun score/norme/interprétation non justifié; 9 aucun consentement inventé; 10 aucun plan/date inventé; 11 omissions significatives; 12 conflits avec contexte antérieur; 13 concision; 14 modèle/champ d'exercice; 15 risque rapporté sans fausse évaluation. Une référence exacte n'autorise pas une reformulation qui change le sens.
fidelityPassed=false si ajout non soutenu, attribution trompeuse, omission clinique significative, conflit masqué ou confusion fait/hypothèse/contexte qui exige une nouvelle rédaction. Sinon true ne signifie JAMAIS validation clinique; maintiens les limites et lacunes dans alerts. Risque=alerte prioritaire, pas conclusion de danger. Alertes jusqu'à 30, factIds connus ou [] si absent. Aucun nouveau conseil thérapeutique.`, { sources, analysis, draft, template: CLINICAL_NOTE_BLUEPRINTS[noteType] }, clinicalReviewSchema, signal)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('fidelityPassed' in raw) || !('alerts' in raw)
    || Object.keys(raw).length !== 2 || typeof raw.fidelityPassed !== 'boolean') throw new ClinicalNotesAiError('Contrôle de fidélité incomplet. Le brouillon précédent est conservé.', 502)
  const alerts = parseClinicalAlerts(raw.alerts, analysis.facts)
  if (!alerts) throw new ClinicalNotesAiError('Contrôle de fidélité invalide. Le brouillon précédent est conservé.', 502)
  if (!raw.fidelityPassed) throw new ClinicalNotesAiError('La vérification a repéré une incohérence, un ajout ou une omission. Aucun nouveau brouillon accepté; votre travail précédent est conservé. Vérifiez les sources avant de relancer.', 422)
  const all = [...analysis.alerts, ...draft.alerts, ...alerts]
  // Une alerte de risque est maintenue même si les étapes suivantes l'omettent.
  for (const fact of analysis.facts.filter(fact => fact.kind === 'risque')) {
    if (!all.some(alert => alert.category === 'risque' && alert.factIds.includes(fact.id))) all.unshift({ category: 'risque', priority: 'prioritaire', text: 'Propos potentiellement préoccupants à revoir par le professionnel. Aucune évaluation du risque ne peut être déduite de cet indicateur.', factIds: [fact.id] })
  }
  const unique = [...new Map(all.map(alert => [JSON.stringify(alert), alert])).values()]
  if (unique.length > 30) throw new ClinicalNotesAiError('Trop d’éléments à vérifier pour ce court essai. Réduisez la source.', 422)
  return { formatVersion: 2, noteType, analysis, draft: { ...draft, alerts: unique } }
}
