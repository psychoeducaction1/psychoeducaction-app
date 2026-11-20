import { CalendarServiceError } from './types.ts'

const MAX_BYTES = 24 * 1024
export async function readCalendarJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new CalendarServiceError('INVALID_INPUT', 'Un contenu JSON est requis.')
  const claimed = request.headers.get('Content-Length')
  if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > MAX_BYTES)) throw new CalendarServiceError('INVALID_INPUT', 'La requête est trop volumineuse.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new CalendarServiceError('INVALID_INPUT', 'Un contenu JSON est requis.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new CalendarServiceError('INVALID_INPUT', 'La requête est trop volumineuse.', 413) }
      chunks.push(result.value)
    }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
    catch { throw new CalendarServiceError('INVALID_INPUT', 'Le JSON fourni est invalide.') }
  } finally { reader.releaseLock() }
}
