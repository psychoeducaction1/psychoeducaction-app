import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteContent, ClinicalNoteType } from './types'

const CLINICAL_ERROR_BRAND = Symbol.for('pea.clinical.fixture.error.v1')

export class ClinicalError extends Error {
  readonly [CLINICAL_ERROR_BRAND] = true
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.name = 'ClinicalError'; this.status = status; this.code = code }
}
export function isClinicalError(value: unknown): value is ClinicalError {
  return value instanceof ClinicalError || (value instanceof Error && CLINICAL_ERROR_BRAND in value && value[CLINICAL_ERROR_BRAND] === true && 'status' in value && typeof value.status === 'number' && 'code' in value && typeof value.code === 'string')
}
export function invalid(message = 'Données invalides.'): never { throw new ClinicalError(400, 'INVALID_INPUT', message) }
export function forbidden(): never { throw new ClinicalError(403, 'FORBIDDEN', 'Accès non autorisé.') }
export function missing(): never { throw new ClinicalError(404, 'NOT_FOUND', 'Ressource introuvable.') }
export function conflict(message = 'La version a changé. Rechargez avant de continuer.'): never { throw new ClinicalError(409, 'VERSION_CONFLICT', message) }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  if (Object.keys(value).some(key => !keys.includes(key))) return invalid('Un champ fourni n’est pas autorisé.')
  return value as Record<string, unknown>
}
export function text(value: unknown, max: number, required = true): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) return invalid()
  const result = value.trim()
  if (required && !result) return invalid('Un champ requis est vide.')
  return result
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return invalid('Identifiant invalide.')
  return value.toLowerCase()
}
export function date(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('Date invalide.')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Date invalide.')
  return value
}
export function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value }
export function version(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid('Version invalide.'); return value as number }
export function noteType(value: unknown): ClinicalNoteType { if (!isClinicalNoteType(value)) return invalid('Type de note invalide.'); return value }
export function content(value: unknown, type: ClinicalNoteType): ClinicalNoteContent {
  const sections = CLINICAL_NOTE_BLUEPRINTS[type]
  const input = object(value ?? {}, [...sections.map(section => section.id), 'document'])
  if (input.document !== undefined) {
    if (Object.keys(input).some(key => key !== 'document')) return invalid('Un document continu ne peut pas contenir de rubriques séparées.')
    return { document: text(input.document, 24000, false) }
  }
  const result: ClinicalNoteContent = {}
  let total = 0
  for (const section of sections) {
    const sectionText = text(input[section.id], 6000, false)
    total += sectionText.length
    result[section.id] = sectionText
  }
  if (total > 24000) return invalid('La note dépasse la longueur autorisée.')
  return result
}
export function email(value: unknown): string { const result = text(value, 254, false); if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) return invalid('Courriel invalide.'); return result }
