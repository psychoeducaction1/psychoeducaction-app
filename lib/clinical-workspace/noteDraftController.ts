import type { ClinicalNoteContent, ClinicalNoteView } from '@/lib/clinical-core/types'

export type NoteDraftSnapshot = { view: ClinicalNoteView; content: ClinicalNoteContent; revision: number; dirty: boolean; saving: boolean; error: string; conflict: boolean }
type Save = (expectedVersion: number, content: ClinicalNoteContent) => Promise<ClinicalNoteView>

// Sérialise les sauvegardes et garde les frappes saisies pendant une requête.
// Un conflit n'entraîne jamais un écrasement ou un réessai automatique.
export class NoteDraftController {
  private view: ClinicalNoteView
  private content: ClinicalNoteContent
  private revision = 0
  private pending: Promise<ClinicalNoteView> | null = null
  private error = ''
  private conflict = false
  private listeners = new Set<(snapshot: NoteDraftSnapshot) => void>()
  private save: Save

  constructor(view: ClinicalNoteView, save: Save) { this.save = save; this.view = structuredClone(view); this.content = structuredClone(view.content) }
  snapshot(): NoteDraftSnapshot {
    return { view: structuredClone(this.view), content: structuredClone(this.content), revision: this.revision,
      dirty: JSON.stringify(this.content) !== JSON.stringify(this.view.content), saving: this.pending !== null,
      error: this.error, conflict: this.conflict }
  }
  subscribe(listener: (snapshot: NoteDraftSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot) }
  edit(section: string, value: string) {
    if (this.view.note.status !== 'draft') throw new Error('Une note signée est verrouillée.')
    this.content = { ...this.content, [section]: value }; this.revision++; this.emit()
  }
  editDocument(value: string) {
    if (this.view.note.status !== 'draft') throw new Error('Une note signée est verrouillée.')
    this.content = { document: value }; this.revision++; this.emit()
  }
  replace(view: ClinicalNoteView) {
    if (this.pending) throw new Error('Une sauvegarde est encore en cours.')
    this.view = structuredClone(view); this.content = structuredClone(view.content); this.error = ''; this.conflict = false; this.revision++; this.emit()
  }
  async flush(): Promise<ClinicalNoteView> {
    if (this.pending) { await this.pending; return this.flush() }
    if (this.conflict) throw new Error('Conflit de versions : votre texte est conservé localement. Rechargez explicitement la version serveur.')
    if (!this.snapshot().dirty) return structuredClone(this.view)
    const revision = this.revision
    const content = structuredClone(this.content)
    const expectedVersion = this.view.note.version
    this.error = ''
    const operation = this.save(expectedVersion, content)
    this.pending = operation; this.emit()
    try {
      const saved = await operation
      if (saved.note.id !== this.view.note.id || saved.note.version <= expectedVersion || saved.note.status !== 'draft') throw new Error('La sauvegarde n’a pas retourné une nouvelle version de ce brouillon.')
      this.view = structuredClone(saved)
      if (revision === this.revision) this.content = structuredClone(saved.content)
    } catch (cause) {
      this.conflict = typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 409
      this.error = cause instanceof Error ? cause.message : 'Sauvegarde impossible. Votre texte est conservé localement.'
      throw cause
    } finally { this.pending = null; this.emit() }
    if (this.snapshot().dirty) return this.flush()
    return structuredClone(this.view)
  }
}
