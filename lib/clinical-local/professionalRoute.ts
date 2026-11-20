import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { canAdmin, resolveActor } from '@/lib/clinical-core/capabilities'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { clientDocumentResponse } from '@/lib/clinical-local/clientDetailsRoute'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { isDurableClinicalRuntime, stagingAllowedEmails } from '@/lib/clinical-local/runtime'
import { signatureImageStrokes } from '@/lib/clinical-local/signatureImage'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fictionalEmail = /^[^\s@]+@[^\s@]+\.invalid$/i
const actions = new Set(['profile.update','preferences.update','signature.add','signature.upload','document.add','agreement.create','agreement.sign','office.details'])
const plain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

export async function handleLocalProfessionals(request: Request, segments: string[]): Promise<Response> {
  if (!isDurableClinicalRuntime()) return localJson({ error: 'Ressource introuvable.' }, 404)
  try {
    const { runtime, token, actor } = await localIdentity(request)
    const signedDownload = request.method === 'GET' && segments.length === 6 && segments[1] === 'documents' && segments[4] === 'signed' && segments[5] === 'download'
    const native = request.method === 'GET' && segments[1] === 'documents' && (segments.length === 5 && segments[4] === 'download' || signedDownload)
    const context = native && (segments[3] === 'administration' || segments[3] === 'clinical') ? segments[3] : contextOf(request)
    const caller = resolveActor(actor, { actorId: actor.id, context })
    if (native && request.headers.has('X-Clinical-Context') && request.headers.get('X-Clinical-Context') !== context) throw new ClinicalError(403,'FORBIDDEN','Document hors de cet espace.')
    if (new URL(request.url).search) throw new ClinicalError(400,'INVALID_INPUT','Paramètres inattendus.')
    if (context === 'administration' && !canAdmin(caller)) throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
    if (segments.length === 1 && segments[0] === 'offices' && request.method === 'GET') {
      if (context !== 'administration') throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      return localJson(await localRpc<unknown>(runtime,token,'lab_office_directory_query',{p_context:context}))
    }
    if (segments.length === 2 && segments[0] === 'offices' && segments[1] === 'commands' && request.method === 'POST') {
      if (context !== 'administration' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      const body = await readBoundedJsonObject(request,8192)
      if (!plain(body) || Object.keys(body).some(key => !['officeId','data'].includes(key)) || !plain(body.data) || (body.officeId !== null && (typeof body.officeId !== 'string' || !idPattern.test(body.officeId)))) throw new ClinicalError(400,'INVALID_INPUT','Bureau invalide.')
      const key = request.headers.get('Idempotency-Key')
      if (!key || !idPattern.test(key)) throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
      const payload = await localRpc<unknown>(runtime,token,'lab_office_directory_command',{p_context:context,p_office_id:body.officeId,p_data:body.data,p_key:key})
      return localJson(payload,201)
    }
    if (segments.length === 2 && segments[1] === 'services' && request.method === 'GET') {
      if (context !== 'administration' || !idPattern.test(segments[0])) throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      return localJson(await localRpc<unknown>(runtime,token,'lab_professional_services_query',{p_context:context,p_professional_id:segments[0]}))
    }
    if (segments.length === 3 && segments[1] === 'services' && segments[2] === 'commands' && request.method === 'POST') {
      if (context !== 'administration' || !idPattern.test(segments[0]) || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      const body = await readBoundedJsonObject(request,8192)
      if (!plain(body) || Object.keys(body).some(key => key !== 'data') || !plain(body.data)) throw new ClinicalError(400,'INVALID_INPUT','Service invalide.')
      const key = request.headers.get('Idempotency-Key')
      if (!key || !idPattern.test(key)) throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
      return localJson(await localRpc<unknown>(runtime,token,'lab_professional_services_command',{p_context:context,p_professional_id:segments[0],p_data:body.data,p_key:key}),201)
    }
    const target = segments[0] === 'self' ? actor.id : segments[0]
    if (target && target !== 'create' && !idPattern.test(target)) throw new ClinicalError(400,'INVALID_INPUT','Professionnel invalide.')
    if (segments.length === 2 && segments[1] === 'invitation' && request.method === 'POST') {
      if (context !== 'administration' || !canAdmin(caller) || !target || target === 'self' || !idPattern.test(target)) throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      // Generate a local test link without invoking Supabase's email sender.
      const details = await localRpc<{ professional?: { id: string; fullName: string; email: string; active: boolean; platformAccess: boolean } }>(runtime,token,'lab_professional_query',{p_context:'administration',p_professional_id:target})
      const professional = details.professional
      const allowedEmail = professional && (runtime.projectId === 'pea-clinical-lab'
        ? fictionalEmail.test(professional.email)
        : stagingAllowedEmails().includes(professional.email.toLowerCase()))
      if (!professional || professional.id !== target || !professional.active || !professional.platformAccess || !allowedEmail) throw new ClinicalError(400,'INVALID_INPUT','Un compte autorisé et actif avec accès plateforme est requis.')
      const admin = createClient(runtime.supabaseUrl,runtime.serviceRoleKey,{auth:{autoRefreshToken:false,persistSession:false}})
      const origin = new URL(request.url).origin
      const { data: link, error } = await admin.auth.admin.generateLink({ type:'recovery', email:professional.email, options:{redirectTo:`${origin}/auth/invitation`} })
      if (error || !link?.properties?.action_link || link.user.id !== target) throw new ClinicalError(503,'LOCAL_AUTH_FAILED','Le lien d’accès fictif n’a pas pu être préparé.')
      const actionLink = new URL(link.properties.action_link)
      if (actionLink.origin !== runtime.supabaseUrl) throw new ClinicalError(503,'LOCAL_AUTH_FAILED','Le lien d’accès fictif est invalide.')
      return localJson({ simulated:true, from:'contact@psychoeducaction.com', to:professional.email,
        subject:'Accès à la plateforme Clinique PsychoÉducAction',
        body:`Bonjour ${professional.fullName},\n\nVotre accès à la plateforme Clinique PsychoÉducAction est prêt. Ouvrez le lien ci-dessous pour choisir ou modifier votre mot de passe, puis connectez-vous avec votre adresse courriel professionnelle.\n\n${actionLink.href}\n\nSi vous n’avez pas demandé cet accès, communiquez avec la clinique à contact@psychoeducaction.com.`,
        actionLink:actionLink.href })
    }
    if (request.method === 'GET') {
      if (segments.length === 0 || segments.length === 1) {
        const payload = await localRpc<unknown>(runtime,token,'lab_professional_query',{p_context:context,p_professional_id:target && target !== 'create' ? target : null})
        return localJson(payload)
      }
      if (native && target && idPattern.test(segments[2]) && (context === 'administration' || target === actor.id)) {
        const payload = signedDownload
          ? await localRpc<unknown>(runtime,token,'lab_professional_signed_pdf_query',{p_context:context,p_professional_id:target,p_agreement_id:segments[2]})
          : await localRpc<unknown>(runtime,token,'lab_professional_query',{p_context:context,p_professional_id:target,p_document_id:segments[2]})
        const response = clientDocumentResponse(payload,segments[2])
        response.headers.set('Content-Disposition','inline')
        return response
      }
      return localJson({ error: 'Ressource introuvable.' },404)
    }
    if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(400,'INVALID_INPUT','Formulaire JSON requis.')
    if (segments.length === 1 && segments[0] === 'create') {
      if (context !== 'administration') throw new ClinicalError(403,'FORBIDDEN','Accès administratif refusé.')
      const body = await readBoundedJsonObject(request,8192)
      if (!plain(body) || Object.keys(body).some(key => !['fullName','email','title'].includes(key)) || typeof body.fullName !== 'string' || !body.fullName.trim() || body.fullName.length > 200 || typeof body.email !== 'string' || !fictionalEmail.test(body.email) || typeof body.title !== 'string' || body.title.length > 160) throw new ClinicalError(400,'INVALID_INPUT','Nom, titre et courriel fictif sont requis.')
      // The caller and SQL wrapper both check administrative authority before privileged Auth work.
      await localRpc(runtime,token,'lab_professional_query',{p_context:'administration'})
      const password = randomBytes(24).toString('base64url')
      const admin = createClient(runtime.supabaseUrl,runtime.serviceRoleKey,{auth:{autoRefreshToken:false,persistSession:false}})
      const created = await admin.auth.admin.createUser({email:body.email.trim(),password,email_confirm:true,user_metadata:{fictional:true}})
      if (created.error || !created.data.user) throw new ClinicalError(503,'LOCAL_AUTH_FAILED','Le compte fictif n’a pas pu être créé.')
      try {
        await localRpc(runtime,token,'lab_professional_create',{p_context:'administration',p_user_id:created.data.user.id,p_name:body.fullName.trim(),p_email:body.email.trim(),p_title:body.title.trim()})
      } catch (cause) {
        await admin.auth.admin.deleteUser(created.data.user.id).catch(() => undefined)
        throw cause
      }
      return localJson({id:created.data.user.id,temporaryPassword:password,fictional:true},201)
    }
    if (segments.length !== 2 || segments[1] !== 'commands' || !target || !idPattern.test(target)) return localJson({error:'Ressource introuvable.'},404)
    const body = await readBoundedJsonObject(request,segments[0] === 'create' ? 8192 : 1450000)
    if (!plain(body) || Object.keys(body).some(key => !['action','data'].includes(key)) || typeof body.action !== 'string' || !actions.has(body.action) || !plain(body.data)) throw new ClinicalError(400,'INVALID_INPUT','Commande professionnelle invalide.')
    const key = request.headers.get('Idempotency-Key')
    if (!key || !idPattern.test(key)) throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
    let data = body.data
    if (body.action === 'signature.upload') {
      if (Object.keys(data).some(field => !['mediaType','bytesBase64'].includes(field)) ||
        !['image/png','image/jpeg'].includes(String(data.mediaType)) || typeof data.bytesBase64 !== 'string' || data.bytesBase64.length > 700000)
        throw new ClinicalError(400,'INVALID_INPUT','Image de signature invalide.')
      try {
        data = { ...data, strokes: await signatureImageStrokes(Buffer.from(data.bytesBase64,'base64')) }
      } catch {
        throw new ClinicalError(400,'INVALID_INPUT','Image de signature illisible ou trop complexe.')
      }
    }
    const payload = await localRpc<unknown>(runtime,token,'lab_professional_command',{p_context:context,p_action:body.action,p_professional_id:target,p_data:data,p_key:key})
    return localJson(payload,201)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return localJson({error:'Formulaire trop volumineux.',code:'INVALID_BODY'},cause.status)
    if (isClinicalError(cause)) return localJson({error:cause.message,code:cause.code},cause.status)
    return localJson({error:'Le profil professionnel local est indisponible.',code:'LOCAL_UNAVAILABLE'},503)
  }
}
