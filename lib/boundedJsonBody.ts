export class JsonBodyError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

// La limite porte sur le flux réel, même sans Content-Length ou avec un en-tête trompeur.
export async function readBoundedJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const oversized = () => new JsonBodyError('La requête dépasse la taille autorisée. Réduisez le nombre de lignes importées.', 413)
  if (Number(request.headers.get('content-length')) > maxBytes) throw oversized()
  const reader = request.body?.getReader()
  if (!reader) throw new JsonBodyError('Body JSON invalide.', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw oversized() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid object')
    return parsed as Record<string, unknown>
  } catch { throw new JsonBodyError('Body JSON invalide.', 400) }
}
