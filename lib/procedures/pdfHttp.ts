import { createHash } from 'node:crypto'
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream, PDFObject } from 'pdf-lib'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { procedureUuid } from './model.ts'
import { procedurePdfMaxBytes, validProcedurePdfName, type ProcedurePdf, type ProcedurePdfBytes, type ProcedurePdfInput } from './pdfModel.ts'

export type ProcedurePdfBackend = {
  canEdit: boolean
  list: (articleId: string) => Promise<ProcedurePdf[]>
  read: (id: string) => Promise<ProcedurePdfBytes>
  save: (input: ProcedurePdfInput) => Promise<{ id: string; version: number }>
}
export type ProcedurePdfAuthorization = { backend: ProcedurePdfBackend; status?: never; error?: never } | { backend?: never; status: number; error: string }
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const invalid = () => { throw new JsonBodyError('Choisissez un PDF valide, non protégé, de 3 Mo maximum, sans contenu actif ni pièce jointe intégrée.', 400) }

export async function checkedProcedurePdf(base64: string): Promise<Buffer> {
  if (!base64.length || base64.length > Math.ceil(procedurePdfMaxBytes / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return invalid()
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length || bytes.length > procedurePdfMaxBytes || bytes.toString('base64') !== base64 || bytes.subarray(0,5).toString('ascii') !== '%PDF-') return invalid()
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
    if (!pdf.getPageCount() || pdf.getPageCount() > 1000) return invalid()
    // Guides are static documents; do not pass embedded actions/files to the browser viewer.
    const visited = new Set<PDFObject>()
    const inspect = (object: PDFObject): void => {
      const value = pdf.context.lookup(object)
      if (!value || visited.has(value)) return
      visited.add(value)
      if (visited.size > 100000) return invalid()
      if (value instanceof PDFArray) { value.asArray().forEach(inspect); return }
      if (value instanceof PDFRawStream) { inspect(value.dict); return }
      if (!(value instanceof PDFDict)) return
      if (['JS','JavaScript','AA','EmbeddedFiles','EF','RichMediaContent','XFA'].some(key => value.has(PDFName.of(key)))) return invalid()
      const action = value.get(PDFName.of('S'))?.toString()
      if (['/JavaScript','/Launch','/SubmitForm','/ImportData','/Rendition'].includes(action ?? '')) return invalid()
      if (value.lookup(PDFName.of('OpenAction')) instanceof PDFDict) return invalid()
      value.entries().forEach(([, child]) => inspect(child))
    }
    pdf.context.enumerateIndirectObjects().forEach(([, value]) => inspect(value))
  } catch { return invalid() }
  return bytes
}

export async function handleProcedurePdfRequest(request: Request, id: string | undefined, authorize: () => Promise<ProcedurePdfAuthorization>): Promise<Response> {
  try {
    const url = new URL(request.url), origin = request.headers.get('origin')
    if (origin && origin !== url.origin) return json({ error: 'Origine refusée.' }, 403)
    const auth = await authorize()
    if (!auth.backend) return json({ error: auth.error }, auth.status)
    const backend = auth.backend
    if (request.method === 'GET' && id) {
      if (!procedureUuid.test(id)) return json({ error: 'Document invalide.' }, 400)
      const file = await backend.read(id.toLowerCase())
      if (file.id !== id.toLowerCase() || file.mediaType !== 'application/pdf' || !validProcedurePdfName(file.fileName) || !/^[0-9a-f]{64}$/.test(file.sha256)) return json({ error: 'Document non vérifiable.' }, 502)
      const bytes = await checkedProcedurePdf(file.bytesBase64).catch(() => null)
      if (!bytes) return json({ error: 'Document non vérifiable.' }, 502)
      if (file.byteLength !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== file.sha256) return json({ error: 'Document non vérifiable.' }, 502)
      return new Response(Uint8Array.from(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="procedure-${file.id}.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g,'%27')}`, 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Document-SHA256': file.sha256 } })
    }
    if (request.method === 'GET' && !id) {
      const articleId = url.searchParams.get('article')
      if (!articleId || !procedureUuid.test(articleId)) return json({ error: 'Procédure invalide.' }, 400)
      return json({ canEdit: backend.canEdit, files: await backend.list(articleId) })
    }
    if (request.method !== 'POST' || id) return json({ error: 'Méthode non permise.' }, 405)
    if (!backend.canEdit) return json({ error: 'Ajout de PDF non autorisé.' }, 403)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Format JSON requis.' }, 415)
    const input = await readBoundedJsonObject(request, 4210000)
    if (!Object.keys(input).every(key => ['id','articleId','documentId','expectedVersion','label','fileName','mediaType','bytesBase64'].includes(key))
      || !['id','articleId','documentId'].every(key => typeof input[key] === 'string' && procedureUuid.test(input[key] as string))
      || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0
      || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 160
      || typeof input.fileName !== 'string' || !validProcedurePdfName(input.fileName)
      || input.mediaType !== 'application/pdf' || typeof input.bytesBase64 !== 'string') return invalid()
    await checkedProcedurePdf(input.bytesBase64)
    return json(await backend.save(input as ProcedurePdfInput))
  } catch (cause) {
    if (cause instanceof JsonBodyError) return json({ error: cause.status === 413 ? 'Le PDF dépasse la taille autorisée de 3 Mo.' : cause.message }, cause.status)
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
    if (code === '42501') return json({ error: 'Accès aux documents refusé ou retiré.' }, 403)
    if (code === 'P0002' || code === '23503') return json({ error: 'Procédure ou document introuvable.' }, 404)
    if (code === '40001' || code === '23505') return json({ error: 'Ce document a changé. Actualisez la liste avant de réessayer ; aucun fichier existant n’a été remplacé.' }, 409)
    if (code === '22023') return json({ error: 'Le PDF ou ses renseignements sont invalides.' }, 400)
    return json({ error: 'Opération non confirmée. Actualisez les documents avant de recommencer.' }, 503)
  }
}
