import { recentLegacyEncounters, type LegacyPdfSource } from './legacyRecentContext.ts'
import { realClinicalTransport } from './transport.ts'

type Transport = ReturnType<typeof realClinicalTransport>
type Note = { id: string; encounterDate: string | null; status: string; appointmentId: string | null; createdAt: string; title: string }
type Archive = { id: string; label: string }
type Candidate = { date: string; text: string; source: 'note' | 'archive' }

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
}

function dateOf(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

function torontoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export async function readLegacyArchivePages(base64: string): Promise<string[]> {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > 5_242_880 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('LEGACY_PDF_INVALID')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true })
  try {
    const pdf = await task.promise
    if (pdf.numPages > 200) throw new Error('LEGACY_PDF_TOO_LONG')
    const pages: string[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item
        ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}` : '').join('').trim())
    }
    return pages
  } finally { await task.destroy() }
}

/** Only one prior note, selected by encounter date. Never use a saved AI summary. */
export async function latestPriorNote(transport: Transport, token: string, caseId: string,
  appointmentId: string): Promise<string> {
  const overview = await transport.rpc('clinical_case_overview', { p_case_id: caseId }, token)
  const overviewObject = overview && typeof overview === 'object' ? overview as Record<string, unknown> : {}
  const appointment = objects(overviewObject.appointments).find(item => item.id === appointmentId)
  const cutoff = torontoDate(appointment?.startAt)
  if (!cutoff) throw new Error('REAL_AI_APPOINTMENT_MISSING')

  const rawNotes = objects(await transport.rpc('clinical_list_notes', { p_case_id: caseId }, token))
  const lastNote = rawNotes.filter(item => item.status === 'signed' && item.appointmentId !== appointmentId
    && dateOf(item.encounterDate) && dateOf(item.encounterDate)! < cutoff)
    .sort((a, b) => String(b.encounterDate).localeCompare(String(a.encounterDate))
      || String(b.createdAt).localeCompare(String(a.createdAt)))[0] as Note | undefined
  let native: Candidate | null = null
  if (lastNote) {
    const read = await transport.rpc('clinical_read_note', { p_note_id: lastNote.id }, token)
    const result = read && typeof read === 'object' ? read as Record<string, unknown> : {}
    const content = result.content && typeof result.content === 'object' ? result.content as Record<string, unknown> : {}
    const body = typeof content.document === 'string' ? content.document.trim()
      : Object.values(content).filter((value): value is string => typeof value === 'string').join('\n').trim()
    if (body) native = { date: lastNote.encounterDate!, text: body, source: 'note' }
  }

  const documents = objects(await transport.rpc('clinical_list_legacy_documents', { p_case_id: caseId }, token))
    .filter(item => typeof item.id === 'string' && typeof item.label === 'string'
      && item.label.toLocaleLowerCase('fr-CA').includes('note')) as Archive[]
  const sources: LegacyPdfSource[] = []
  for (const document of documents) {
    const read = await transport.rpc('clinical_read_legacy_document', { p_document_id: document.id }, token)
    const result = read && typeof read === 'object' ? read as Record<string, unknown> : {}
    if (typeof result.base64 !== 'string') throw new Error('LEGACY_PDF_UNAVAILABLE')
    sources.push({ documentId: document.id, pages: await readLegacyArchivePages(result.base64) })
  }
  const archive = recentLegacyEncounters(sources).find(item => item.date < cutoff)
  const archived: Candidate | null = archive
    ? { date: archive.date, text: archive.text, source: 'archive' } : null
  const selected = native && archived ? native.date >= archived.date ? native : archived : native ?? archived
  return selected ? `Dernière note du ${selected.date} (${selected.source === 'archive' ? 'archive PDF' : 'note du dossier'}) :\n${selected.text}` : ''
}
