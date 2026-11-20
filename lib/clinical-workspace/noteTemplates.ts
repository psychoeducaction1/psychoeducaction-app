import { CLINICAL_NOTE_TEMPLATES, isClinicalNoteType, type ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { clinicalNoteDraftText } from '@/lib/clinical-workspace/noteScaffold'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'

export type PersonalNoteTemplate = { id: string; title: string; noteType: ClinicalNoteType; document: string; version: number; archived: boolean }
export const commonNoteTemplates = CLINICAL_NOTE_TEMPLATES.map(item => ({ id: item.id, title: item.label, noteType: item.id, document: clinicalNoteDraftText(item.id) }))
export function isPersonalNoteTemplate(value: unknown): value is PersonalNoteTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 6 && typeof item.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 120 && isClinicalNoteType(item.noteType)
    && typeof item.document === 'string' && item.document.trim().length > 0 && item.document.length <= 24000
    && Number.isSafeInteger(item.version) && Number(item.version) >= 1 && typeof item.archived === 'boolean'
}
export function isNoteTemplateList(value: unknown): value is { templates: PersonalNoteTemplate[] } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && Array.isArray((value as { templates: unknown }).templates)
    && (value as { templates: unknown[] }).templates.length <= 200 && (value as { templates: unknown[] }).templates.every(isPersonalNoteTemplate))
}

export function selectedNoteTemplate(id: string, personal: PersonalNoteTemplate[]) {
  const item = id.startsWith('personal:') ? personal.find(item => 'personal:' + item.id === id && !item.archived) : commonNoteTemplates.find(item => item.id === id)
  if (!item) throw new Error('Ce gabarit est indisponible. Choisissez un gabarit actuel.')
  return { noteType: item.noteType, title: item.title, document: item.document }
}

/** Only canonical section IDs leave the template store; personal template text is never sent to the AI. */
export function clinicalTemplateFocus(noteType: ClinicalNoteType, document: string): string[] {
  const normalized = document.toLocaleLowerCase('fr-CA').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const terms: Record<string, string[]> = {
    developpement: ['developpement'], famille: ['familial', 'familiale', 'famille'],
    ecole_travail: ['scolaire', 'ecole', 'travail', 'professionnelle'],
    social_affectif: ['sociale', 'social', 'affectif', 'emotion'],
    habitudes: ['habitudes', 'sommeil', 'alimentation'], fonctionnelle: ['fonctionnelle'],
    protection: ['protection'], vulnerabilite: ['vulnerabilite'], normative: ['normative'],
    pad: ['adaptatif', 'pad'], pex: ['experientiel', 'pex'],
  }
  return CLINICAL_NOTE_BLUEPRINTS[noteType].filter(section => {
    const title = section.title.toLocaleLowerCase('fr-CA').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return normalized.includes(title) || (terms[section.id] ?? []).some(term => normalized.includes(term))
  }).map(section => section.id)
}
