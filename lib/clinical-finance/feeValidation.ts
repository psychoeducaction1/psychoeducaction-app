import type { FeeCommand } from './feeTypes'
import {object,shape,uuid,text,date,one,int,nullable} from '@/lib/clinical-mandates/validation'
export const FEE_RULES=['standard','legacy_80','legacy_supervised_110_35','owner_full_clinic','service_libre'] as const
export const FEE_CATEGORIES=['intervenant_psychoeducation','psychoeducateur_membre_ordre','psychotherapeute'] as const
export function isFeePeriod(from:unknown,to:unknown):from is string{return date(from)&&date(to)&&String(from)<=String(to)&&(Date.parse(String(to))-Date.parse(String(from)))/86400000<=92}
export function isFeeCommand(value:unknown):value is FeeCommand {
 if(!shape(value,['action','data'])||!object(value)||!object(value.data))return false
 const d=value.data
 if(value.action==='fee.contract.add')return shape(d,['professionalId','effectiveFrom','rule','category','supervisorId','reason'])&&uuid(d.professionalId)&&date(d.effectiveFrom)&&one(d.rule,FEE_RULES)&&nullable(d.category,c=>one(c,FEE_CATEGORIES))&&nullable(d.supervisorId,uuid)&&text(d.reason,2000)&&Boolean(d.reason.trim())&&(d.rule==='standard'?one(d.category,FEE_CATEGORIES):d.category===null)&&(d.rule==='legacy_supervised_110_35'?uuid(d.supervisorId)&&d.supervisorId!==d.professionalId:d.supervisorId===null)
 if(value.action==='fee.prepare')return shape(d,['professionalId','from','to'])&&uuid(d.professionalId)&&isFeePeriod(d.from,d.to)
 if(value.action==='fee.validate'||value.action==='fee.close')return shape(d,['statementId','expectedVersion'])&&uuid(d.statementId)&&int(d.expectedVersion,1)
 if(value.action==='fee.correct')return shape(d,['statementId','expectedVersion','reason'])&&uuid(d.statementId)&&int(d.expectedVersion,1)&&text(d.reason,2000)&&Boolean(d.reason.trim())
 return false
}
