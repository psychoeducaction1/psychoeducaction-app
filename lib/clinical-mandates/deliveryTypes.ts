import type {ClinicalAccessContext} from '@/lib/clinical-core/types'
export const CONSENT_DEFAULT_SECONDS=864000
export const CONSENT_MAX_SECONDS=2592000
export const CONSENT_DELIVERY_ACTIONS=['invitation.prepare_demo','invitation.renew_demo','invitation.remind_demo','invitation.revoke_demo','invitation.settings'] as const
export type ConsentCommunication={id:string;kind:'consent_invitation'|'consent_reminder';label:string;at:string;status:'prepared'|'simulated'|'expired'|'revoked'|'sent'|'delivered'|'failed';simulation:true;recipientLabel?:string;expiresAt?:string}
export type ConsentDeliveryTarget={mandateId:string;revisionId:string;expectedVersion:number;clientId:string;clientName:string;serviceLabel:string;professionalName:string;signerId:string;signerName:string;audience:'administrative'|'clinical';invitationId:string|null;expiresAt:string|null;revokedAt:string|null;consumedAt:string|null;expired:boolean}
export type ConsentClientDocument=import('./types').MandateDocument&{mandateId:string;serviceLabel:string;revisionNumber:number}
export type ConsentDeliveryWorkspace={mode:'isolated_local'|'isolated_unified';fictional:boolean;actorId:string;context:ClinicalAccessContext;preferences:{version:number;expiresInSeconds:number};targets:ConsentDeliveryTarget[];reminders:ConsentDeliveryTarget[];communications:ConsentCommunication[];documents:ConsentClientDocument[]}
type Target={mandateId:string;revisionId:string;expectedVersion:number}
export type ConsentDeliveryCommand=
 |{action:'invitation.prepare_demo';data:Target&{signerId:string;expiresInSeconds:number}}
 |{action:'invitation.renew_demo';data:Target&{invitationId:string;expiresInSeconds:number}}
 |{action:'invitation.remind_demo'|'invitation.revoke_demo';data:Target&{invitationId:string}}
 |{action:'invitation.settings';data:{expectedVersion:number;expiresInSeconds:number}}
