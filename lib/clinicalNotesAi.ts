import { DEFAULT_CLINICAL_NOTE_TYPE, getClinicalNoteTemplate } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

// Limites d'un essai court; les consultations completes seront une etape distincte.
export const CLINICAL_AUDIO_MAX_BYTES = 3_000_000
export const CLINICAL_TRANSCRIPT_MAX_CHARS = 16_000
export const CLINICAL_NOTE_FIELDS = ['objectif', 'informations', 'interventions', 'observations', 'plan', 'aVerifier'] as const
export type ClinicalNoteDraft = Record<typeof CLINICAL_NOTE_FIELDS[number], string>

export function parseClinicalNoteDraft(value: unknown): ClinicalNoteDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== CLINICAL_NOTE_FIELDS.length) return null
  for (const field of CLINICAL_NOTE_FIELDS) {
    if (typeof record[field] !== 'string' || !record[field].trim() || record[field].length > 6000) return null
  }
  return record as ClinicalNoteDraft
}

export function formatClinicalNoteDraft(draft: ClinicalNoteDraft, type: ClinicalNoteType = DEFAULT_CLINICAL_NOTE_TYPE) {
  const template = getClinicalNoteTemplate(type)
  return `ESSAI FICTIF — BROUILLON A RELIRE\nTYPE DE NOTE : ${template.label}\n\n${CLINICAL_NOTE_FIELDS.map(field => `${template.headings[field].toLocaleUpperCase('fr-CA')}\n${draft[field]}`).join('\n\n')}`
}

export function detectClinicalAudio(bytes: Uint8Array): { extension: string; type: string } | null {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (bytes.length < 12) return null
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return { extension: 'wav', type: 'audio/wav' }
  if (text(0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224) return { extension: 'mp3', type: 'audio/mpeg' }
  if (text(4, 8) === 'ftyp' && ['M4A ', 'isom', 'mp42', 'M4B '].includes(text(8, 12))) return { extension: 'm4a', type: 'audio/mp4' }
  if ([26, 69, 223, 163].every((byte, index) => bytes[index] === byte)) return { extension: 'webm', type: 'audio/webm' }
  return null
}
