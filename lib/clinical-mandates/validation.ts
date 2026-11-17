import type { MandateCommand, SignatureEvidence } from './types'
export const MANDATE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MANDATE_HASH=/^[a-f0-9]{64}$/
export const MANDATE_ACTIONS=['mandate.create','mandate.update','mandate.prepare','mandate.amend','mandate.archive','signature.local','invitation.create','invitation.revoke','rate.add','template.add','policy.add'] as const
export const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v))
export const shape=(v:unknown,required:readonly string[],optional:readonly string[]=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k))
export const text=(v:unknown,max=300):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
export const uuid=(v:unknown):v is string=>typeof v==='string'&&MANDATE_UUID.test(v)
export const hash=(v:unknown):v is string=>typeof v==='string'&&MANDATE_HASH.test(v)
export const int=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max
export const list=(v:unknown,check:(v:unknown)=>boolean,max=1000):v is unknown[]=>Array.isArray(v)&&v.length<=max&&v.every(check)
export const nullable=(v:unknown,check:(v:unknown)=>boolean)=>v===null||check(v)
export const ids=(v:unknown)=>list(v,uuid,100)&&new Set(v).size===v.length
export const bool=(v:unknown)=>typeof v==='boolean'
export const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v
export const instant=(v:unknown)=>typeof v==='string'&&v.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
export const one=(v:unknown,values:readonly string[])=>typeof v==='string'&&values.includes(v)
export function isSignatureEvidence(v:unknown):v is SignatureEvidence {
 if(!shape(v,['name','attested'],['strokes','profileSignatureId'])||!object(v)||!text(v.name,200)||!v.name.trim()||v.attested!==true||Object.hasOwn(v,'profileSignatureId')&&(!uuid(v.profileSignatureId)||!Object.hasOwn(v,'strokes')))return false
 const stored = Object.hasOwn(v,'profileSignatureId'), maxPoints = stored ? 10000 : 2000
 return !Object.hasOwn(v,'strokes')||(Array.isArray(v.strokes)&&v.strokes.length>=1&&v.strokes.reduce((n,s)=>n+(Array.isArray(s)?s.length:maxPoints+1),0)<=maxPoints&&list(v.strokes,s=>Array.isArray(s)&&s.length>=2&&list(s,p=>shape(p,['x','y'])&&object(p)&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1,maxPoints),stored?500:50))
}
export function isInvitationToken(v:unknown):v is string {return typeof v==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(v)}
export const signer=(v:unknown)=>shape(v,['id','personId','profileId','name','role','audience','required'])&&object(v)&&uuid(v.id)&&nullable(v.personId,uuid)&&nullable(v.profileId,uuid)&&text(v.name,200)&&one(v.role,['client','representative','payer','professional','supervisor'])&&one(v.audience,['administrative','clinical'])&&bool(v.required)
export const legal=(v:unknown)=>shape(v,['confirmed','context','exceptionReason'])&&object(v)&&bool(v.confirmed)&&text(v.context,2000)&&text(v.exceptionReason,2000)
export function draft(v:unknown,clinical=false):boolean {
 const common=['serviceId','serviceDate','templateId','policyId','professionalId','supervisorId','authorizedProfileIds','signers','legalReview']
 if(!shape(v,clinical?common:[...common,'rateId','overrideCents','overrideReason','people','payers','administrativeInstructions'],clinical?['clinicalText']:['clinicalText','administrativeText'])||!object(v))return false
 if(!uuid(v.serviceId)||!date(v.serviceDate)||!uuid(v.templateId)||!uuid(v.policyId)||!uuid(v.professionalId)||!nullable(v.supervisorId,uuid)||!ids(v.authorizedProfileIds)||!Array.isArray(v.authorizedProfileIds)||v.authorizedProfileIds.length>30||!list(v.signers,signer,30)||!legal(v.legalReview))return false
 if(v.clinicalText!==undefined&&(!text(v.clinicalText,20000)||!v.clinicalText.trim()))return false
 if(clinical)return Array.isArray(v.signers)&&v.signers.every(s=>object(s)&&s.audience==='clinical')
 if(v.administrativeText!==undefined&&(!text(v.administrativeText,20000)||!v.administrativeText.trim()))return false
 return uuid(v.rateId)&&nullable(v.overrideCents,x=>int(x,1,10000000))&&text(v.overrideReason,1000)&&text(v.administrativeInstructions,4000)
 &&list(v.people,p=>shape(p,['id','name','email','roles','authorityVerified','authorityBasis','canConsent','canCommunicate','canReadDocuments','canRepresent'])&&object(p)&&uuid(p.id)&&text(p.name,200)&&text(p.email,254)&&(p.email===''||/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(p.email))&&list(p.roles,x=>one(x,['contact','representative','payer','client']),4)&&bool(p.authorityVerified)&&text(p.authorityBasis,2000)&&['canConsent','canCommunicate','canReadDocuments','canRepresent'].every(k=>bool(p[k])),30)
 &&list(v.payers,p=>shape(p,['personId','basisPoints'])&&object(p)&&uuid(p.personId)&&int(p.basisPoints,0,10000),30)
}
export function isMandateCommand(v:unknown):v is MandateCommand {
 if(!shape(v,['action','data'])||!object(v)||!one(v.action,MANDATE_ACTIONS)||!object(v.data))return false
 const d=v.data,version=()=>uuid(d.mandateId)&&uuid(d.revisionId)&&int(d.expectedVersion,1)
 switch(v.action){
 case 'mandate.create':return shape(d,['clientId','episodeId','draft'])&&uuid(d.clientId)&&uuid(d.episodeId)&&draft(d.draft)
 case 'mandate.update':return shape(d,['mandateId','revisionId','expectedVersion','draft'])&&version()&&draft(d.draft)
 case 'mandate.prepare':case 'mandate.archive':return shape(d,['mandateId','revisionId','expectedVersion'])&&version()
 case 'mandate.amend':return shape(d,['mandateId','revisionId','expectedVersion','reason'])&&version()&&text(d.reason,1000)&&Boolean(d.reason.trim())
 case 'signature.local':return shape(d,['mandateId','revisionId','expectedVersion','signerId','documentId','documentHash','evidence'])&&version()&&uuid(d.signerId)&&uuid(d.documentId)&&hash(d.documentHash)&&isSignatureEvidence(d.evidence)
 case 'invitation.create':return shape(d,['mandateId','revisionId','expectedVersion','signerId','expiresInSeconds','token'])&&version()&&uuid(d.signerId)&&int(d.expiresInSeconds,1,2592000)&&isInvitationToken(d.token)
 case 'invitation.revoke':return shape(d,['mandateId','revisionId','expectedVersion','invitationId'])&&version()&&uuid(d.invitationId)
 case 'rate.add':return shape(d,['serviceId','expectedVersion','effectiveFrom','amountCents','unit','referenceMinutes'])&&uuid(d.serviceId)&&int(d.expectedVersion,1)&&date(d.effectiveFrom)&&int(d.amountCents,1,10000000)&&one(d.unit,['hour','session','km'])&&nullable(d.referenceMinutes,x=>int(x,1,720))
 case 'template.add':return shape(d,['serviceId','title','clinicalText','administrativeText'])&&nullable(d.serviceId,uuid)&&text(d.title,160)&&text(d.clinicalText,20000)&&text(d.administrativeText,20000)
 case 'policy.add':return shape(d,['label','ageOfMajority','suggestedMinorRoles'])&&text(d.label,160)&&int(d.ageOfMajority,1,120)&&list(d.suggestedMinorRoles,x=>one(x,['contact','representative','payer','client']),10)
 default:return false
 }
}
