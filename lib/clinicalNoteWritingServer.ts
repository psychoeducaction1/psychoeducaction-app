import 'server-only'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { getClinicalNoteTemplate } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import type { ClinicalAnalysis } from '@/lib/clinicalNoteEngine'
import { parseClinicalEngineDraft } from '@/lib/clinicalNoteEngine'
import { CLINICAL_GROUNDING_RULES } from '@/lib/clinicalNoteAnalysisServer'
import { clinicalDraftSchema } from '@/lib/clinicalNoteEngineSchemas'
import { requestClinicalStructured, ClinicalNotesAiError } from '@/lib/clinicalNotesAiServer'

export async function writeClinicalDraft(analysis: ClinicalAnalysis, type: ClinicalNoteType, signal: AbortSignal) {
  const raw = await requestClinicalStructured('clinical_section_draft', `${CLINICAL_GROUNDING_RULES}
ÉTAPE RÉDACTION: type ${getClinicalNoteTemplate(type).label}. Rédige seulement à partir des faits extraits ci-dessous. Chaque paragraphe et ligne de tableau doit référencer les factIds qui soutiennent TOUT son contenu. Une référence ne permet pas d'ajouter des détails. Regroupe sans répéter et sans métacommentaire sur la transcription. Max 20 paragraphes ou lignes par rubrique. Respecte les rubriques de cette configuration: ${JSON.stringify(CLINICAL_NOTE_BLUEPRINTS[type])}.
Rubriques absentes: omettre la rubrique ou laisser paragraphs=[] et rows=[]. Rubrique texte: paragraphs, rows=[]. Tableau: rows avec cells dans l'ordre exact des colonnes, paragraphs=[]. Pour ABC, les trois cellules doivent être documentées et leur lien explicite. Un épisode partiel reste dans la description factuelle avec la limite explicitement dictée, sans ligne ABC reconstruite. Pour le plan, ne compléter que les cellules documentées. Pas de valeurs de remplissage « Non documenté ». Date/durée et personnes seulement si confirmées, surtout en fermeture. Informations antérieures attribuées à leur source, jamais présentées comme actuelles. En évaluation 3, reprendre l'objectif annoncé, synthétiser les points de vue avec leurs sources et conserver toute divergence explicitement déclarée inexpliquée. Réserver les capacités personnelles au PAD et les soutiens du milieu au PEX; ne répéter ni exemples ni conclusions entre ces rubriques et la synthèse. Les hypothèses et le jugement du professionnel sont provisoires à valider. Ne recopie pas les alertes IA dans les rubriques; conserve cependant les faits cliniques cités qui expriment une limite dictée ou une divergence non résolue, dans la rubrique concernée.`, analysis, clinicalDraftSchema, signal)
  const draft = parseClinicalEngineDraft(raw, type, analysis.facts)
  if (!draft) throw new ClinicalNotesAiError('Le brouillon contient des rubriques ou références invalides. Votre travail précédent est conservé.', 502)
  return draft
}
