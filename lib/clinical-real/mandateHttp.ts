import { createHash, randomBytes } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { placedSignaturePdf, signatureSlotPlacement, validPlacedSignature } from './placedSignaturePdf.ts'

type Name = 'clinical_mandate_summary' | 'clinical_mandate_versions' | 'clinical_new_mandate_revision' | 'clinical_save_mandate_draft' | 'clinical_prepare_mandate' | 'clinical_mandate_pdf' | 'clinical_sign_mandate' | 'clinical_create_mandate_invitation' | 'clinical_revoke_mandate_invitation'
type PublicName = 'clinical_mandate_portal' | 'clinical_mandate_portal_sign' | 'clinical_mandate_portal_signed_result'
export type MandateHttpDependencies = {
  authenticate(request: Request): Promise<string | null>
  rpc(name: Name, args: Record<string, unknown>, token: string): Promise<unknown>
  rpcPublic(name: PublicName, args: Record<string, unknown>): Promise<unknown>
  sendInvitation(to: string, link: string): Promise<void>
  signatureBaseUrl: string
  archiveSignedPdf?(source: unknown): Promise<{ bytesBase64: string; sha256: string }>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Authorization, Cookie' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const idOk = (value: unknown) => typeof value === 'string' && uuid.test(value)
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return null
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 96 * 1024)) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 96 * 1024) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null } finally { reader.releaseLock() }
}
function failure(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === '42501') return json({ code: 'FORBIDDEN', error: 'Accès refusé à ce mandat.' }, 403)
  if (code === 'P0002') return json({ code: 'NOT_FOUND', error: 'Document introuvable.' }, 404)
  if (code === '40001') return json({ code: 'VERSION_CONFLICT', error: 'Le mandat a changé. Actualisez la page.' }, 409)
  if (code === '22023') return json({ code: 'INVALID_MANDATE', error: 'Les renseignements du mandat sont incomplets ou invalides.' }, 400)
  return json({ code: 'MANDATE_UNAVAILABLE', error: 'Le mandat est momentanément indisponible.' }, 503)
}
/** Contrat HTTP du schéma réel. Le RPC utilise le JWT utilisateur, jamais la clé service. */
export async function handleRealMandateHttp(request: Request, segments: string[], deps: MandateHttpDependencies): Promise<Response> {
  const [area, id, action] = segments
  const portal = area === 'portal' && segments.length === 2 && request.method === 'POST'
    && (id === 'open' || id === 'sign')
  if (!portal && (!idOk(id) || !((area === 'cases' && request.method === 'GET'
      && (segments.length === 2 || (segments.length === 3 && action === 'versions')))
    || (area === 'revisions' && segments.length === 3 && ['PATCH', 'POST'].includes(request.method))
    || (area === 'documents' && segments.length === 2 && request.method === 'GET'))))
    return json({ code: 'NOT_FOUND', error: 'Ressource introuvable.' }, 404)
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return json({ code: 'ORIGIN_REFUSED', error: 'Origine refusée.' }, 403)
  }
  try {
    if (portal) {
      const data = await body(request)
      if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token))
        return json({ code: 'INVITATION_UNAVAILABLE', error: 'Invitation indisponible.' }, 404)
      const tokenHash = createHash('sha256').update(data.token).digest('hex')
      if (id === 'open') {
        const result = await deps.rpcPublic('clinical_mandate_portal', { p_token_hash: tokenHash })
        if (!result || typeof result !== 'object') throw new Error('INVALID_PORTAL')
        const document = result as Record<string, unknown>
        if (typeof document.documentBase64 !== 'string' || typeof document.documentHash !== 'string'
          || !/^[a-f0-9]{64}$/.test(document.documentHash)
          || createHash('sha256').update(Buffer.from(document.documentBase64, 'base64')).digest('hex') !== document.documentHash)
          throw new Error('INVALID_PORTAL')
        const slot = document.signatureSlot as Record<string, unknown> | undefined
        const signatureSlots = slot?.signatureSlots
        const slotIndex = slot?.slotIndex
        if (!Number.isInteger(signatureSlots) || !Number.isInteger(slotIndex)
          || Number(signatureSlots) < 1 || Number(signatureSlots) > 30
          || Number(slotIndex) < 0 || Number(slotIndex) >= Number(signatureSlots))
          throw new Error('INVALID_SIGNATURE_SLOT')
        const source = await PDFDocument.load(Buffer.from(document.documentBase64, 'base64'))
        const placement = signatureSlotPlacement(source.getPageCount(), Number(slotIndex))
        const serverPlacement = slot?.placement as Record<string, unknown> | undefined
        if (serverPlacement?.page !== placement.page || serverPlacement.x !== placement.x
          || serverPlacement.y !== placement.y)
          throw new Error('INVALID_SIGNATURE_SLOT')
        const preview = await placedSignaturePdf(document.documentBase64, document.documentHash,
          document.placedSignatures ?? [], Number(signatureSlots))
        return json({ document: { ...document,
          previewBase64: Buffer.from(preview.bytes).toString('base64'),
          signaturePlacement: placement } })
      }
      if (typeof data.documentHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.documentHash)
        || data.mode !== 'remote_typed'
        || !data.evidence || typeof data.evidence !== 'object' || Array.isArray(data.evidence))
        return json({ code: 'INVALID_INPUT', error: 'Signature invalide.' }, 400)
      if (deps.archiveSignedPdf) {
        const previous = await deps.rpcPublic('clinical_mandate_portal_signed_result', {
          p_token_hash: tokenHash, p_document_hash: data.documentHash, p_mode: data.mode, p_evidence: data.evidence,
        }) as Record<string, unknown> | null
        if (previous) {
          const archived = await deps.archiveSignedPdf(previous.archiveSource)
          return json({ signed: true, signedPdfBase64: archived.bytesBase64, signedPdfHash: archived.sha256 })
        }
      }
      const preview = await deps.rpcPublic('clinical_mandate_portal', { p_token_hash: tokenHash }) as Record<string, unknown>
      if (preview.documentHash !== data.documentHash) return json({ code: 'INVALID_INPUT', error: 'Document modifié.' }, 400)
      const evidence = data.evidence as Record<string, unknown>
      const proposedSignature = { ...evidence, signedAt: new Date().toISOString() }
      const sourcePdf = await PDFDocument.load(Buffer.from(String(preview.documentBase64), 'base64'))
      const place = evidence.placement as Record<string, unknown> | undefined
      const slot = preview.signatureSlot as Record<string, unknown> | undefined
      const count = slot?.signatureSlots
      const index = slot?.slotIndex
      if (!Number.isInteger(count) || !Number.isInteger(index)
        || Number(count) < 1 || Number(count) > 30
        || Number(index) < 0 || Number(index) >= Number(count))
        throw new Error('INVALID_SIGNATURE_SLOT')
      const expectedPlace = signatureSlotPlacement(sourcePdf.getPageCount(), Number(index))
      const serverPlacement = slot?.placement as Record<string, unknown> | undefined
      if (evidence.name !== preview.signerName || evidence.attested !== true
        || !validPlacedSignature(proposedSignature) || evidence.style !== 'caveat'
        || evidence.renderVersion !== 3
        || serverPlacement?.page !== expectedPlace.page || serverPlacement.x !== expectedPlace.x
        || serverPlacement.y !== expectedPlace.y
        || place?.page !== expectedPlace.page || place.x !== expectedPlace.x
        || place.y !== expectedPlace.y)
        return json({ code: 'INVALID_INPUT', error: 'Emplacement ou signature invalide.' }, 400)
      await placedSignaturePdf(String(preview.documentBase64), data.documentHash, [{
        ...proposedSignature,
      }], Number(count))
      const signed = await deps.rpcPublic('clinical_mandate_portal_sign', { p_token_hash: tokenHash,
        p_document_hash: data.documentHash, p_mode: data.mode, p_evidence: data.evidence })
      if (!signed || typeof signed !== 'object') throw new Error('INVALID_SIGNATURE_RESULT')
      const result = signed as Record<string, unknown>
      if (deps.archiveSignedPdf) {
        const archived = await deps.archiveSignedPdf(result.archiveSource)
        return json({ signed: true, signedPdfBase64: archived.bytesBase64, signedPdfHash: archived.sha256 })
      }
      const pdf = await placedSignaturePdf(String(result.documentBase64), String(result.documentHash),
        result.placedSignatures, Number(result.signatureSlots))
      return json({ signed: true, signedPdfBase64: Buffer.from(pdf.bytes).toString('base64'),
        signedPdfHash: pdf.sha256 })
    }
    const token = await deps.authenticate(request)
    if (!token) return json({ code: 'UNAUTHENTICATED', error: 'Connectez-vous pour accéder au mandat.' }, 401)
    if (area === 'cases' && action === 'versions')
      return json({ versions: await deps.rpc('clinical_mandate_versions', { p_case_id: id }, token) })
    if (area === 'cases') return json({ mandate: await deps.rpc('clinical_mandate_summary', { p_case_id: id }, token) })
    if (area === 'documents') {
      const result = await deps.rpc('clinical_mandate_pdf', { p_document_id: id }, token)
      if (!result || typeof result !== 'object') throw new Error('INVALID_DOCUMENT')
      const document = result as Record<string, unknown>
      if (typeof document.bytesBase64 !== 'string' || typeof document.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/i.test(document.sha256)) throw new Error('INVALID_DOCUMENT')
      const pdf = await placedSignaturePdf(document.bytesBase64, document.sha256,
        document.placedSignatures ?? [], Number(document.signatureSlots ?? 0))
      return new Response(new Uint8Array(pdf.bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="convention-${id}.pdf"`, 'X-Document-SHA256': pdf.sha256 } })
    }
    const data = await body(request)
    if (!data || !Number.isSafeInteger(data.expectedVersion) || (data.expectedVersion as number) < 0)
      return json({ code: 'INVALID_INPUT', error: 'Version et contenu JSON requis.' }, 400)
    const args = { p_revision_id: id, p_expected_version: data.expectedVersion }
    if (request.method === 'PATCH' && action === 'draft' && data.data && typeof data.data === 'object' && !Array.isArray(data.data))
      return json({ result: await deps.rpc('clinical_save_mandate_draft', { ...args, p_data: data.data }, token) })
    if (request.method === 'POST' && action === 'prepare')
      return json({ result: await deps.rpc('clinical_prepare_mandate', args, token) })
    if (request.method === 'POST' && action === 'new-version')
      return json({ result: await deps.rpc('clinical_new_mandate_revision', args, token) })
    if (request.method === 'POST' && action === 'invite'
      && idOk(data.personId) && (data.audience === 'clinical' || data.audience === 'administrative')
      && typeof data.recipientEmail === 'string'
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.recipientEmail)
      && data.recipientEmail.length <= 254) {
      if (!/^https:\/\/[^/?#]+$/.test(deps.signatureBaseUrl))
        return json({ code: 'DELIVERY_UNAVAILABLE', error: 'Invitation indisponible.' }, 503)
      const recipientEmail = data.recipientEmail.trim().toLowerCase()
      const invitationToken = randomBytes(32).toString('base64url')
      const result = await deps.rpc('clinical_create_mandate_invitation', {
        p_revision_id: id, p_expected_version: data.expectedVersion,
        p_person_id: data.personId, p_audience: data.audience,
        p_recipient_email: recipientEmail,
        p_token_hash: createHash('sha256').update(invitationToken).digest('hex'), p_minutes: 1440,
      }, token) as Record<string, unknown>
      if (!idOk(result?.invitationId)) throw new Error('INVALID_INVITATION')
      const link = `${deps.signatureBaseUrl}/signature-convention#jeton=${invitationToken}`
      try { await deps.sendInvitation(recipientEmail, link) }
      catch {
        await deps.rpc('clinical_revoke_mandate_invitation', { p_invitation_id: result.invitationId }, token)
        return json({ code: 'DELIVERY_FAILED', error: 'Invitation non envoyée.' }, 503)
      }
      return json({ sent: true, expiresAt: result.expiresAt })
    }
    if (request.method === 'POST' && action === 'sign' && idOk(data.personId) && idOk(data.documentId)
      && (data.audience === 'clinical' || data.audience === 'administrative')
      && typeof data.documentHash === 'string' && /^[a-f0-9]{64}$/i.test(data.documentHash)
      && (data.mode === 'in_person_typed' || data.mode === 'in_person_drawn')
      && data.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence))
      return json({ result: await deps.rpc('clinical_sign_mandate', { ...args, p_person_id: data.personId,
        p_audience: data.audience, p_document_id: data.documentId, p_document_hash: data.documentHash,
        p_mode: data.mode, p_evidence: data.evidence }, token) })
    return json({ code: 'NOT_FOUND', error: 'Action introuvable ou invalide.' }, 404)
  } catch (error) { return failure(error) }
}
