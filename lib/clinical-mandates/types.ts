import type { ClinicalAccessContext, FixtureActor } from '../clinical-core/types'
export type MandateAudience = 'administrative' | 'clinical'
export type MandateStatus = 'draft' | 'prepared' | 'partially_signed' | 'signed' | 'archived'
export type MandateService = { id:string; code:string; label:string; active:boolean; version:number; kind:'clinical'|'opening'|'travel'; rates?:MandateRate[] }
export type MandateRate = { id:string; serviceId:string; effectiveFrom:string; amountCents:number; currency:'CAD'; unit:'hour'|'session'|'km'; referenceMinutes:number|null; createdAt:string }
export type MandateTemplate = { id:string; serviceId:string|null; version:number; title:string; clinicalText:string; administrativeText?:string; createdAt:string; fictional:boolean }
export type MandatePolicy = { id:string; version:number; label:string; ageOfMajority:number; suggestedMinorRoles:string[]; reviewRequired:true; fictional:boolean; createdAt:string }
export type MandatePerson = { id:string; name:string; email:string; roles:('contact'|'representative'|'payer'|'client')[]; authorityVerified:boolean; authorityBasis:string; canConsent:boolean; canCommunicate:boolean; canReadDocuments:boolean; canRepresent:boolean }
export type MandateSigner = { id:string; personId:string|null; profileId:string|null; name:string; role:'client'|'representative'|'payer'|'professional'|'supervisor'; audience:MandateAudience; required:boolean }
export type MandatePayer = { personId:string; basisPoints:number }
export type MandateDraft = { serviceId:string; rateId:string; serviceDate:string; overrideCents:number|null; overrideReason:string; templateId:string; clinicalText?:string; administrativeText?:string; policyId:string; professionalId:string; supervisorId:string|null; authorizedProfileIds:string[]; people:MandatePerson[]; payers:MandatePayer[]; signers:MandateSigner[]; legalReview:{ confirmed:boolean; context:string; exceptionReason:string }; administrativeInstructions:string }
export type MandateDocument = { id:string; revisionId:string; audience:MandateAudience; kind:'convention'|'proof'; sha256:string; byteLength:number; createdAt:string; signatureCount?:number }
export type MandateSignature = { id:string; signerId:string; documentId:string; documentHash:string; name:string; mode:'local_typed'|'local_drawn'|'remote_demo'; signedAt:string; operatorId:string|null; fictional:boolean; automatic?:boolean }
export type MandateInvitation = { id:string; signerId:string; documentId:string; expiresAt:string; revokedAt:string|null; consumedAt:string|null; version:number; createdAt:string }
export type MandateHistory = { id:string; at:string; actorId:string|null; source:'authenticated'|'external_demo'; action:string; revisionId:string|null; detail:string }
export type MandateRevision = { id:string; mandateId:string; number:number; version:number; status:MandateStatus; draft:MandateDraft; previousRevisionId:string|null; amendmentReason:string; createdAt:string; preparedAt:string|null; archivedAt:string|null; documents:MandateDocument[]; signatures:MandateSignature[]; invitations:MandateInvitation[]; professionalSignatureStatus?:'ready'|'missing'; supervisorSignatureStatus?:'ready'|'missing' }
// Other clinical readers receive a redacted view; the assigned professional may edit the complete draft.
export type ClinicalMandateDraft = Pick<MandateDraft,'serviceId'|'serviceDate'|'templateId'|'clinicalText'|'policyId'|'professionalId'|'supervisorId'|'authorizedProfileIds'|'signers'|'legalReview'>
export type ClinicalMandateRevision = Omit<MandateRevision,'draft'> & { draft:ClinicalMandateDraft }
export type MandateSummary = { id:string; clientId:string; episodeId:string; clientName:string; episodeLabel:string; currentRevisionId:string; revisionNumber:number; version:number; status:MandateStatus; professionalId:string; serviceLabel:string; createdAt:string }
export type MandateEpisode = { id:string; clientId:string; label:string; status:'open'|'closed'; professionalIds:string[] }
export type MandateWorkspace = { mode:'isolated_local'; fictional:boolean; context:ClinicalAccessContext; actor:FixtureActor; clients:{id:string;name:string;birthDate:string|null}[]; episodes:MandateEpisode[]; professionals:{id:string;name:string;canSupervise:boolean}[]; services:MandateService[]; templates:MandateTemplate[]; policies:MandatePolicy[]; mandates:MandateSummary[]; selected:{mandate:MandateSummary;revisions:(MandateRevision|ClinicalMandateRevision)[];history:MandateHistory[]}|null }
export type MandateAck = { ok:true; action:string; id:string; revisionId?:string; version:number; replayed?:boolean }
export type SignatureEvidence = { name:string; attested:true; strokes?:{x:number;y:number}[][]; profileSignatureId?:string }
export type MandateCommand =
 | {action:'mandate.create';data:{clientId:string;episodeId:string;draft:MandateDraft}}
 | {action:'mandate.update';data:{mandateId:string;revisionId:string;expectedVersion:number;draft:MandateDraft}}
 | {action:'mandate.prepare';data:{mandateId:string;revisionId:string;expectedVersion:number}}
 | {action:'mandate.amend';data:{mandateId:string;revisionId:string;expectedVersion:number;reason:string}}
 | {action:'mandate.archive';data:{mandateId:string;revisionId:string;expectedVersion:number}}
 | {action:'signature.local';data:{mandateId:string;revisionId:string;expectedVersion:number;signerId:string;documentId:string;documentHash:string;evidence:SignatureEvidence}}
 | {action:'invitation.create';data:{mandateId:string;revisionId:string;expectedVersion:number;signerId:string;expiresInSeconds:number;token:string}}
 | {action:'invitation.revoke';data:{mandateId:string;revisionId:string;expectedVersion:number;invitationId:string}}
 | {action:'rate.add';data:{serviceId:string;expectedVersion:number;effectiveFrom:string;amountCents:number;unit:'hour'|'session'|'km';referenceMinutes:number|null}}
 | {action:'template.add';data:{serviceId:string|null;title:string;clinicalText:string;administrativeText:string}}
 | {action:'policy.add';data:{label:string;ageOfMajority:number;suggestedMinorRoles:string[]}}
export type MandatePortalView = { ok:true; fictional:boolean; clientName:string; signer:Pick<MandateSigner,'id'|'name'|'role'|'audience'>; document:MandateDocument; revisionNumber:number; expiresAt:string; alreadySigned:boolean }
export type MandatePdf = { id:string;sha256:string;bytesBase64:string;byteLength:number }
