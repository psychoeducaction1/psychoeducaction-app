import type {ClinicalAccessContext} from '@/lib/clinical-core/types'
import type {FeeAck,FeeQuote,FeeWorkspace} from './feeTypes'
import {object,shape,uuid,text,int,date,instant,hash,bool,list,nullable,one} from '@/lib/clinical-mandates/validation'
import {isMandatePdf} from '@/lib/clinical-mandates/transport'
import {FEE_RULES,FEE_CATEGORIES,isFeeCommand,isFeePeriod} from '@/lib/clinical-finance/feeValidation'
const kinds=['meeting','report','travel','cancellation','opening'] as const
const amounts=(v:Record<string,unknown>,keys:readonly string[])=>keys.every(k=>int(v[k],0,10000000000))
const contract=(v:unknown)=>shape(v,['id','professionalId','effectiveFrom','rule','category','supervisorId','reason','createdAt','createdBy'])&&object(v)&&uuid(v.id)&&uuid(v.professionalId)&&date(v.effectiveFrom)&&one(v.rule,FEE_RULES)&&nullable(v.category,c=>one(c,FEE_CATEGORIES))&&nullable(v.supervisorId,uuid)&&text(v.reason,2000)&&instant(v.createdAt)&&uuid(v.createdBy)&&isFeeCommand({action:'fee.contract.add',data:{professionalId:v.professionalId,effectiveFrom:v.effectiveFrom,rule:v.rule,category:v.category,supervisorId:v.supervisorId,reason:v.reason}})
const warning=(v:unknown)=>shape(v,['code','sourceId','serviceDate'])&&object(v)&&one(v.code,['MISSING_CONTRACT','SERVICE_LIBRE_DISABLED','UNISSUED_SOURCE','ADJUSTMENT_REVIEW_REQUIRED','CANCELLATION_AMOUNT_MISSING','SUPERVISOR_REQUIRED'])&&nullable(v.sourceId,uuid)&&nullable(v.serviceDate,date)
const line=(v:unknown)=>shape(v,['sourceId','sourceVersion','serviceDate','kind','durationMinutes','contractId','weeklyMeetingCount','professionalCents','supervisorCents','supervisorId','clinicCents','clientAmountCents'])&&object(v)&&uuid(v.sourceId)&&int(v.sourceVersion,1)&&date(v.serviceDate)&&one(v.kind,kinds)&&int(v.durationMinutes,0,720)&&uuid(v.contractId)&&typeof v.weeklyMeetingCount==="number"&&Number.isFinite(v.weeklyMeetingCount)&&v.weeklyMeetingCount>=0&&v.weeklyMeetingCount<=5000&&Number.isInteger(v.weeklyMeetingCount*2)&&nullable(v.supervisorId,uuid)&&amounts(v,['professionalCents','supervisorCents','clinicCents','clientAmountCents'])
function statement(v:unknown):boolean{return shape(v,['id','professionalId','professionalName','from','to','version','revision','status','blocked','previousStatementId','correctionReason','inputHash','professionalCents','supervisorCents','travelCents','clinicCents','warnings','lines','createdAt','validatedAt','closedAt','documentId'])&&object(v)&&uuid(v.id)&&uuid(v.professionalId)&&text(v.professionalName)&&isFeePeriod(v.from,v.to)&&int(v.version,1)&&int(v.revision,1)&&one(v.status,['prepared','validated','closed'])&&bool(v.blocked)&&nullable(v.previousStatementId,uuid)&&text(v.correctionReason,2000)&&hash(v.inputHash)&&amounts(v,['professionalCents','supervisorCents','travelCents','clinicCents'])&&list(v.warnings,warning,10000)&&list(v.lines,line,10000)&&instant(v.createdAt)&&nullable(v.validatedAt,instant)&&nullable(v.closedAt,instant)&&nullable(v.documentId,uuid)}
function personalStatement(v:unknown,administrative=false):boolean {
 if(!object(v))return false
 const historical=v.source==='historical'
 if(administrative&&!historical)return false
 return shape(v,['id','from','to','revision','status','professionalCents','travelCents','lines','createdAt','validatedAt','closedAt','documentId','previousStatementId'],historical?['source',...(administrative?['professionalId','professionalName']:[])]:[])
  &&uuid(v.id)&&(historical?date(v.from)&&date(v.to)&&String(v.from)<=String(v.to):isFeePeriod(v.from,v.to))&&int(v.revision,1)
  &&one(v.status,historical?['validated']:['validated','closed'])&&amounts(v,['professionalCents','travelCents'])
  &&list(v.lines,l=>shape(l,['serviceDate','kind','durationMinutes','amountCents'])&&object(l)&&date(l.serviceDate)
   &&one(l.kind,[...kinds,'supervision',...(historical?['regularisation']:[])])
   &&(historical?nullable(l.durationMinutes,n=>int(n,0,720)):int(l.durationMinutes,0,720))&&int(l.amountCents,0,10000000000),10000)
  &&instant(v.createdAt)&&instant(v.validatedAt)&&nullable(v.closedAt,instant)&&nullable(v.documentId,uuid)&&nullable(v.previousStatementId,uuid)
  &&(!administrative||uuid(v.professionalId)&&text(v.professionalName))
}
export function isFeeWorkspace(v:unknown,context:ClinicalAccessContext,actorId:string):v is FeeWorkspace {
 if(!object(v)||!((v.mode==='isolated_local'&&v.fictional===true)||(v.mode==='isolated_unified'&&v.fictional===false))||v.durable!==true||v.context!==context||v.actorId!==actorId)return false
 return context==='administration'?shape(v,['mode','durable','fictional','actorId','context','kind','professionals','contracts','statements'])&&v.kind==='administrative'&&list(v.professionals,p=>shape(p,['id','name'])&&object(p)&&uuid(p.id)&&text(p.name))&&list(v.contracts,contract,5000)&&list(v.statements,s=>statement(s)||(v.mode==='isolated_unified'&&personalStatement(s,true)),2000):shape(v,['mode','durable','fictional','actorId','context','kind','statements'])&&v.kind==='professional'&&list(v.statements,s=>personalStatement(s)&&(!(object(s)&&s.source==='historical')||v.mode==='isolated_unified'),2000)
}
export function isFeeQuote(v:unknown):v is FeeQuote{
 if(!shape(v,['professionalId','from','to','contextFrom','contextTo','inputHash','inputs','contracts','statementId'])||!object(v)||!uuid(v.professionalId)||!isFeePeriod(v.from,v.to)||!date(v.contextFrom)||!date(v.contextTo)||!hash(v.inputHash)||!nullable(v.statementId,uuid)||!list(v.contracts,contract,5000)||!shape(v.inputs,['professional','sources','fingerprint'])||!object(v.inputs)||!hash(v.inputs.fingerprint))return false
 const p=v.inputs.professional
 return shape(p,['id','fullName','email'])&&object(p)&&p.id===v.professionalId&&text(p.fullName)&&nullable(p.email,e=>text(e,320))&&list(v.inputs.sources,s=>shape(s,['id','version','professionalId','serviceDate','lineType','clientAmountCents','durationMinutes','meetingId','status','ready','adjustmentBlocked'],['meetingEquivalentHalfUnits'])&&object(s)&&uuid(s.id)&&int(s.version,1)&&s.professionalId===v.professionalId&&date(s.serviceDate)&&one(s.lineType,kinds)&&nullable(s.clientAmountCents,a=>int(a,0,100000000))&&int(s.durationMinutes,0,720)&&nullable(s.meetingId,uuid)&&one(s.status,['completed','cancelled','no_show'])&&bool(s.ready)&&bool(s.adjustmentBlocked)&&(s.meetingEquivalentHalfUnits===undefined||int(s.meetingEquivalentHalfUnits,0,2)),10000)
}
export function isFeeAck(v:unknown,action?:string):v is FeeAck{return shape(v,['ok','action','id','version'],['replayed'])&&object(v)&&v.ok===true&&one(v.action,['fee.contract.add','fee.prepare','fee.validate','fee.close','fee.correct'])&&(!action||v.action===action)&&uuid(v.id)&&int(v.version,1)&&(v.replayed===undefined||bool(v.replayed))}
export const isFeePdf=isMandatePdf
