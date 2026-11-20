import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { getClinicalNoteTemplate } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteContent, ClinicalNoteSummary } from '@/lib/clinical-core/types'

/** Export local de la rédaction affichée; ni audit, ni données administratives ou financières. */
export function clinicalFixtureNoteText(note: ClinicalNoteSummary, content: ClinicalNoteContent, unsaved = false): string {
  const state = note.status === 'signed' ? 'SIGNÉE DANS LE LABORATOIRE' : note.status === 'awaiting_cosignature' ? 'EN ATTENTE DE COSIGNATURE' : 'BROUILLON À RELIRE'
  const sections = typeof content.document === 'string' ? [content.document.trim()] : CLINICAL_NOTE_BLUEPRINTS[note.noteType].flatMap(section => {
    const value = content[section.id]?.trim()
    return value ? [`${section.title.toLocaleUpperCase('fr-CA')}\n${value}`] : []
  })
  return [
    'DONNÉES FICTIVES — NE PAS DÉPOSER DANS UN VRAI DOSSIER',
    state,
    unsaved ? 'TEXTE LOCAL NON ENREGISTRÉ — VERSION SERVEUR NON ACTUALISÉE' : '',
    `TYPE DE NOTE : ${getClinicalNoteTemplate(note.noteType).label}`,
    note.title,
    note.encounterDate ? `Date de rencontre déclarée : ${note.encounterDate}` : '',
    `Version ${note.version}${note.amendsNoteId ? ' — correction ou complément lié à une note signée, sans modification de l’original' : ''}`,
    note.amendsNoteId && note.signedAt ? `Correction validée le ${new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(note.signedAt))}` : '',
  ].filter(Boolean).join('\n') + '\n\n' + sections.join('\n\n')
}
