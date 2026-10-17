import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { getClinicalNoteTemplate, isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

export const CLINICAL_CONTEXT_MAX_CHARS = 8_000
export const CLINICAL_FACT_KINDS = ['propos', 'observation', 'intervention', 'reaction', 'hypothese', 'decision', 'administratif', 'risque'] as const
export const CLINICAL_ALERT_CATEGORIES = ['information_manquante', 'attribution', 'ambiguite', 'contradiction', 'fidelite', 'champ_exercice', 'risque', 'suggestion'] as const
export type ClinicalSources = { transcript: string; history: string; metadata: string }
export type ClinicalFact = { id: string; kind: typeof CLINICAL_FACT_KINDS[number]; speaker: string; text: string; source: keyof ClinicalSources; quote: string }
export type ClinicalAlert = { category: typeof CLINICAL_ALERT_CATEGORIES[number]; priority: 'normal' | 'prioritaire'; text: string; factIds: string[] }
export type ClinicalAnalysis = { facts: ClinicalFact[]; alerts: ClinicalAlert[] }
export type ClinicalParagraph = { text: string; factIds: string[] }
export type ClinicalTableRow = { cells: string[]; factIds: string[] }
export type ClinicalSection = { id: string; paragraphs: ClinicalParagraph[]; rows: ClinicalTableRow[] }
export type ClinicalEngineDraft = { sections: ClinicalSection[]; alerts: ClinicalAlert[] }
export type ClinicalEngineResult = { formatVersion: 2; noteType: ClinicalNoteType; analysis: ClinicalAnalysis; draft: ClinicalEngineDraft }

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
const text = (value: unknown, max = 4_000): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max
const list = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max
const contains = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T)
function refs(value: unknown, facts: ClinicalFact[], required: boolean): value is string[] {
  return list(value, 30) && (!required || value.length > 0) && new Set(value).size === value.length && value.every(id => typeof id === 'string' && facts.some(fact => fact.id === id))
}

export function parseClinicalAlerts(value: unknown, facts: ClinicalFact[]): ClinicalAlert[] | null {
  if (!list(value, 30)) return null
  for (const item of value) {
    if (!object(item) || !keys(item, ['category', 'priority', 'text', 'factIds']) || !contains(CLINICAL_ALERT_CATEGORIES, item.category)
      || !contains(['normal', 'prioritaire'], item.priority) || !text(item.text, 1_500) || !refs(item.factIds, facts, false)
      || (item.category === 'risque' && item.priority !== 'prioritaire')) return null
  }
  return value as ClinicalAlert[]
}

// Les citations doivent exister dans la source autorisée. Cela ne prouve pas, à soi seul, la fidélité sémantique.
export function parseClinicalAnalysis(value: unknown, sources: ClinicalSources): ClinicalAnalysis | null {
  if (!object(value) || !keys(value, ['facts', 'alerts']) || !list(value.facts, 80)) return null
  const ids = new Set<string>()
  for (const item of value.facts) {
    if (!object(item) || !keys(item, ['id', 'kind', 'speaker', 'text', 'source', 'quote']) || !text(item.id, 30)
      || !/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id) || !contains(CLINICAL_FACT_KINDS, item.kind)
      || !text(item.speaker, 160) || !text(item.text, 2_000) || !contains(['transcript', 'history', 'metadata'], item.source)
      || !text(item.quote, 2_000) || !sources[item.source as keyof ClinicalSources].includes(item.quote)) return null
    ids.add(item.id)
  }
  const facts = value.facts as ClinicalFact[]
  const alerts = parseClinicalAlerts(value.alerts, facts)
  return alerts ? { facts, alerts } : null
}

export function parseClinicalEngineDraft(value: unknown, type: ClinicalNoteType, facts: ClinicalFact[]): ClinicalEngineDraft | null {
  if (!object(value) || !keys(value, ['sections', 'alerts']) || !list(value.sections, 20)) return null
  const config = CLINICAL_NOTE_BLUEPRINTS[type]
  const seen = new Set<string>()
  for (const item of value.sections) {
    if (!object(item) || !keys(item, ['id', 'paragraphs', 'rows']) || typeof item.id !== 'string' || seen.has(item.id)) return null
    const section = config.find(section => section.id === item.id)
    if (!section || !list(item.paragraphs, 20) || !list(item.rows, 20)) return null
    seen.add(item.id)
    for (const paragraph of item.paragraphs) {
      if (!object(paragraph) || !keys(paragraph, ['text', 'factIds']) || !text(paragraph.text) || /^non document[eé][.\s]*$/i.test(paragraph.text.trim()) || !refs(paragraph.factIds, facts, true)) return null
    }
    if (!section.columns && item.rows.length > 0) return null
    if (section.columns && item.paragraphs.length > 0) return null
    for (const row of item.rows) {
      if (!object(row) || !keys(row, ['cells', 'factIds']) || !Array.isArray(row.cells) || row.cells.length !== section.columns?.length
        || !row.cells.every(cell => typeof cell === 'string' && cell.length <= 2_000) || !row.cells.some(cell => cell.trim()) || !refs(row.factIds, facts, true)) return null
      if (section.id === 'abc' && row.cells.some(cell => !cell.trim())) return null
    }
  }
  const alerts = parseClinicalAlerts(value.alerts, facts)
  if (!alerts) return null
  // Ordre stable et rubriques vides disponibles pour la correction humaine, sans texte de remplissage.
  return { sections: config.map(section => (value.sections as ClinicalSection[]).find(item => item.id === section.id) ?? { id: section.id, paragraphs: [], rows: [] }), alerts }
}

export function parseClinicalEngineResult(value: unknown, sources: ClinicalSources): ClinicalEngineResult | null {
  if (!object(value) || !keys(value, ['formatVersion', 'noteType', 'analysis', 'draft']) || value.formatVersion !== 2 || !isClinicalNoteType(value.noteType)) return null
  const analysis = parseClinicalAnalysis(value.analysis, sources)
  const draft = analysis && parseClinicalEngineDraft(value.draft, value.noteType, analysis.facts)
  return analysis && draft ? { formatVersion: 2, noteType: value.noteType, analysis, draft } : null
}

export function clinicalSourceSnapshot(type: ClinicalNoteType | '', sources: ClinicalSources) {
  // Empreinte de comparaison uniquement en mémoire; jamais journalisée ou persistée.
  return JSON.stringify([type, sources.transcript, sources.history, sources.metadata])
}

export function formatClinicalEngineNote(type: ClinicalNoteType, sections: ClinicalSection[]) {
  const contents = sections.flatMap(section => {
    const config = CLINICAL_NOTE_BLUEPRINTS[type].find(item => item.id === section.id)
    if (!config) return []
    const paragraphs = section.paragraphs.map(item => item.text.trim()).filter(Boolean)
    const rows = section.rows.filter(row => row.cells.some(cell => cell.trim()))
    if (!paragraphs.length && !rows.length) return []
    const table = rows.map(row => row.cells.map((cell, index) => `${config.columns?.[index] ?? ''} : ${cell.trim()}`).join('\n')).join('\n\n')
    return [`${config.title.toLocaleUpperCase('fr-CA')}\n${[...paragraphs, table].filter(Boolean).join('\n\n')}`]
  })
  return `DONNÉES FICTIVES — NE PAS DÉPOSER DANS UN VRAI DOSSIER\nTYPE DE NOTE : ${getClinicalNoteTemplate(type).label}\n\n${contents.join('\n\n')}`
}

export type ClinicalWorkingVersion = { id: number; label: string; result: ClinicalEngineResult; sources: ClinicalSources; original: string; snapshot: string }
export function retainClinicalVersion(versions: ClinicalWorkingVersion[], version: ClinicalWorkingVersion) {
  // React utilise des modifications immuables; clone défensif pour ne jamais modifier une version archivée.
  return [...versions, structuredClone(version)].slice(-5)
}
export function canValidateClinicalDraft(stale: boolean, sections: ClinicalSection[], checks: readonly boolean[]) {
  return !stale && checks.length === 3 && checks.every(Boolean) && sections.some(section => section.paragraphs.some(item => item.text.trim()) || section.rows.some(row => row.cells.some(cell => cell.trim())))
}
