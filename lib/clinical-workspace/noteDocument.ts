import type { ClinicalNoteContent, NoteTypeOption } from '@/lib/clinical-core/types'

/** Keep older, section-based notes readable as one document without changing signed versions. */
export function clinicalNoteDocumentText(type: NoteTypeOption, content: ClinicalNoteContent): string {
  if (typeof content.document === 'string') return content.document
  return type.sections.flatMap(section => {
    const value = content[section.id]?.trim()
    return value ? [`${section.title}\n${value}`] : []
  }).join('\n\n')
}
