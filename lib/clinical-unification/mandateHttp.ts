import { createHash } from 'node:crypto'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { isMandateCommand, uuid } from '../clinical-mandates/validation.ts'
import { isMandateAck, isMandatePdf, isMandateWorkspace } from '../clinical-mandates/transport.ts'
import { isConsentDeliveryCommand, isConsentDeliveryWorkspace } from '../clinical-mandates/deliveryTransport.ts'
import { createUnifiedWorkspaceReader } from './workspace.ts'
import { unifiedJson, type UnifiedHttpContext } from './http.ts'
import { archiveUnifiedSignedPdf, archiveAutomaticProfessionalSources, renderAutomaticProfessionalPreview } from './mandateSignedArchive.ts'

type Dependencies = { archiveSignedPdf?: typeof archiveUnifiedSignedPdf }

/** Adapter for the unchanged laboratory mandate components. All operations use
 * the caller's verified session and canonical case grants in PostgreSQL. */
export async function handleUnifiedMandates(request: Request, full: string[], identity: UnifiedHttpContext, dependencies: Dependencies = {}): Promise<Response | null> {
  if (full[0] !== 'mandates') return null
  const path = full.slice(1)
  const { transport, token, context } = identity
  const archiveSignedPdf = dependencies.archiveSignedPdf ?? archiveUnifiedSignedPdf
  const completeAutomaticSignatures = async (mandateId: string) => archiveAutomaticProfessionalSources(
    await transport.rpc('clinical_unified_mandate_auto_signature_sources', { p_context: context, p_mandate_id: mandateId }, token), archiveSignedPdf,
  )
  const invalid = () => unifiedJson({ error: 'Vérifiez les renseignements du mandat.', code: 'INVALID_INPUT' }, 400)
  if (new URL(request.url).search) return invalid()
  try {
    if (request.method === 'GET') {
      if (path[0] === 'documents' || path[0] === 'preview') {
        if (!uuid(path[1]) || path[2] !== context || !(path.length === 3 || path.length === 4 && path[0] === 'documents' && path[3] === 'download')) return invalid()
        let value = await transport.rpc('clinical_unified_mandate_document', { p_context: context, p_id: path[1], p_preview: path[0] === 'preview' }, token)
        if (!isMandatePdf(value) || value.id !== path[1]) throw new Error('UNIFIED_MANDATE_RESPONSE_INVALID')
        if (path[0] === 'preview' && context === 'clinical') {
          value = await renderAutomaticProfessionalPreview(value, await transport.rpc('clinical_unified_mandate_preview_source', {
            p_context: context, p_revision_id: path[1], p_audience: 'clinical',
          }, token))
        }
        if (!isMandatePdf(value)) throw new Error('UNIFIED_MANDATE_RESPONSE_INVALID')
        const bytes = Buffer.from(value.bytesBase64, 'base64')
        if (bytes.length !== value.byteLength || createHash('sha256').update(bytes).digest('hex') !== value.sha256 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('DOCUMENT_INTEGRITY_FAILED')
        return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Document-SHA256': value.sha256, 'Content-Disposition': `${path[3] === 'download' ? 'attachment' : 'inline'}; filename="convention.pdf"` } })
      }
      const caller = await createUnifiedWorkspaceReader(transport).identity(token, context)
      if (path[0] === 'delivery') {
        const clientId = path.length === 3 && path[1] === 'client' && uuid(path[2]) ? path[2] : null
        if (path.length !== 1 && !clientId) return invalid()
        const value = await transport.rpc('clinical_unified_mandate_delivery', { p_context: context, p_client_id: clientId }, token)
        if (!isConsentDeliveryWorkspace(value, context, caller.actor.id, clientId ?? undefined)) throw new Error('UNIFIED_DELIVERY_RESPONSE_INVALID')
        return unifiedJson(value)
      }
      let clientId: string | null = null, mandateId: string | null = null
      if (path.length === 1 && uuid(path[0])) mandateId = path[0]
      else if ((path.length === 2 || path.length === 3) && path[0] === 'client' && uuid(path[1])) {
        clientId = path[1]
        if (path.length === 3) { if (!uuid(path[2])) return invalid(); mandateId = path[2] }
      } else if (path.length) return invalid()
      let value = await transport.rpc('clinical_unified_mandate_query', { p_context: context, p_mandate_id: mandateId, p_client_id: clientId }, token)
      if (!isMandateWorkspace(value, context, caller.actor.id) || clientId && value.mandates.some(m => m.clientId !== clientId) || mandateId && value.selected?.mandate.id !== mandateId) throw new Error('UNIFIED_MANDATE_RESPONSE_INVALID')
      if (value.selected && await completeAutomaticSignatures(value.selected.mandate.id)) {
        value = await transport.rpc('clinical_unified_mandate_query', { p_context: context, p_mandate_id: mandateId, p_client_id: clientId }, token)
        if (!isMandateWorkspace(value, context, caller.actor.id) || clientId && value.mandates.some(m => m.clientId !== clientId) || mandateId && value.selected?.mandate.id !== mandateId) throw new Error('UNIFIED_MANDATE_RESPONSE_INVALID')
      }
      return unifiedJson(value)
    }
    const delivery = path.join('/') === 'delivery/commands'
    if (request.method !== 'POST' || !delivery && (path.length !== 1 || path[0] !== 'commands')) return unifiedJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
    const command = await readBoundedJsonObject(request, 256 * 1024)
    const key = request.headers.get('Idempotency-Key')
    if (delivery) {
      if (!isConsentDeliveryCommand(command) || !uuid(key)) return invalid()
      const value = await transport.rpc('clinical_unified_consent_command', { p_context: context, p_action: command.action, p_data: command.data, p_key: key }, token)
      if (!isMandateAck(value, command.action)) throw new Error('UNIFIED_DELIVERY_RESPONSE_INVALID')
      return unifiedJson(value)
    }
    if (!isMandateCommand(command) || !uuid(key)) return invalid()
    const data: Record<string, unknown> = { ...command.data }
    if (command.action === 'invitation.create') {
      data.tokenHash = createHash('sha256').update(String(data.token)).digest('hex')
      delete data.token
    }
    const value = await transport.rpc('clinical_unified_mandate_command', { p_context: context, p_action: command.action, p_data: data, p_key: key }, token)
    if (!isMandateAck(value, command.action)) throw new Error('UNIFIED_MANDATE_RESPONSE_INVALID')
    if (command.action === 'signature.local') {
      const source = await transport.rpc('clinical_unified_signed_pdf_source', { p_context: context, p_signature_id: value.id }, token)
      await archiveSignedPdf(source)
    } else if (['mandate.create', 'mandate.update', 'mandate.prepare', 'mandate.amend'].includes(command.action)) {
      await completeAutomaticSignatures(command.action === 'mandate.create' ? value.id : String(data.mandateId))
    }
    return unifiedJson(value, command.action === 'mandate.create' ? 201 : 200)
  } catch (error) {
    if (error instanceof JsonBodyError) return unifiedJson({ error: 'Contenu invalide ou trop volumineux.', code: 'INVALID_BODY' }, error.status)
    throw error
  }
}
