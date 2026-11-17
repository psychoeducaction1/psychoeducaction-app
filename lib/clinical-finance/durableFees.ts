import {calculateProfessionalCompensation} from '@/lib/professionalCompensation'
import type {ProfessionalPayrollInfo} from '@/lib/payrollCalculator'
import type {FixtureActor} from '@/lib/clinical-core/types'
import {canAdmin,resolveActor} from '@/lib/clinical-core/capabilities'
import {ClinicalError} from '@/lib/clinical-core/validation'
import type {DurableClinicalRuntime} from '@/lib/clinical-local/runtime'
import {localRpc} from '@/lib/clinical-local/http'
import type {FeeAck,FeeCalculation,FeeCalculatedLine,FeeCommand,FeeContract,FeeQuote,FeeWarning} from './feeTypes'
import {isFeeCommand,isFeePeriod} from '@/lib/clinical-finance/feeValidation'
import {isFeeAck,isFeeQuote} from '@/lib/clinical-finance/feeTransport'
import {uuid} from '@/lib/clinical-mandates/validation'

export function feeWeekBounds(from:string,to:string):{from:string;to:string}{
 if(!isFeePeriod(from,to))throw new ClinicalError(400,'FEE_INVALID_PERIOD','Choisissez une période valide de un à93jours.')
 const start=new Date(from+'T12:00:00Z'),end=new Date(to+'T12:00:00Z')
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);end.setUTCDate(end.getUTCDate()+6-(end.getUTCDay()+6)%7)
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)}
}
const cents=(value:number)=>Math.round(value*100)
/** Adapter for already-existing legacy branches. These internal compatibility
 * aliases never enter a DTO, statement, PDF, audit or public configuration.
 * The existing calculator remains the only source of rates and ordering.
 */
function calculatorProfile(quote:FeeQuote,contract:FeeContract):ProfessionalPayrollInfo {
 const aliases:Partial<Record<FeeContract['rule'],string>>={legacy_80:'Nancy Al Kayal',legacy_supervised_110_35:'Rim El Bassit',owner_full_clinic:'Hicham Boukili'}
 return {id:quote.professionalId,fullName:aliases[contract.rule]??'Professionnel contractuel fictif',email:null,payrollCategory:contract.category,professionalAddress:null,professionalPhone:null,professionalTitle:null}
}
export function calculateFeeQuote(quote:FeeQuote):FeeCalculation {
 if(!isFeeQuote(quote))throw new ClinicalError(502,'FEE_INVALID_QUOTE','Les données de calcul n’ont pas pu être vérifiées.')
 const bounds=feeWeekBounds(quote.from,quote.to)
 if(bounds.from!==quote.contextFrom||bounds.to!==quote.contextTo)throw new ClinicalError(502,'FEE_INVALID_QUOTE','Le contexte hebdomadaire du calcul est incomplet.')
 const meetings=new Map<string,Map<string,number>>()
 for(const s of quote.inputs.sources)if(s.meetingId&&(s.lineType==='meeting'&&s.status==='completed'||s.lineType==='cancellation'&&s.meetingEquivalentHalfUnits!==undefined)&&s.serviceDate>=bounds.from&&s.serviceDate<=bounds.to){
  const week=feeWeekBounds(s.serviceDate,s.serviceDate).from,group=meetings.get(week)??new Map<string,number>()
  const units=s.meetingEquivalentHalfUnits??2
  // One appointment contributes once, regardless of payer count or travel lines.
  group.set(s.meetingId,Math.max(group.get(s.meetingId)??0,units));meetings.set(week,group)
 }
 const lines:FeeCalculatedLine[]=[],warnings:FeeWarning[]=[]
 let blocked=false
 const warn=(code:FeeWarning['code'],sourceId:string,serviceDate:string,blocking=true)=>{warnings.push({code,sourceId,serviceDate});if(blocking)blocked=true}
 const contracts=[...quote.contracts].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))
 for(const s of quote.inputs.sources){
  if(s.serviceDate<quote.from||s.serviceDate>quote.to||s.lineType==='opening')continue
  if(s.lineType==='cancellation'&&s.meetingEquivalentHalfUnits===0&&s.clientAmountCents===0&&!s.adjustmentBlocked)continue
  if(s.adjustmentBlocked){warn('ADJUSTMENT_REVIEW_REQUIRED',s.id,s.serviceDate);continue}
  if(s.lineType==='cancellation'&&s.clientAmountCents===null){warn('CANCELLATION_AMOUNT_MISSING',s.id,s.serviceDate);continue}
  if(!s.ready||s.clientAmountCents===null){warn('UNISSUED_SOURCE',s.id,s.serviceDate);continue}
  const contract=contracts.filter(c=>c.professionalId===quote.professionalId&&c.effectiveFrom<=s.serviceDate).at(-1)
  if(!contract){warn('MISSING_CONTRACT',s.id,s.serviceDate);continue}
  if(contract.rule==='service_libre'){warn('SERVICE_LIBRE_DISABLED',s.id,s.serviceDate);continue}
  if(contract.rule==='legacy_supervised_110_35'&&!contract.supervisorId){warn('SUPERVISOR_REQUIRED',s.id,s.serviceDate);continue}
  const weeklyMeetingCount=[...(meetings.get(feeWeekBounds(s.serviceDate,s.serviceDate).from)?.values()??[])].reduce((total,units)=>total+units,0)/2
  const lineType=s.lineType==='meeting'?'rencontre':s.lineType==='report'?'rapport_evaluation':s.lineType==='travel'?'deplacement':'annulation'
  const amount=calculateProfessionalCompensation({professional:calculatorProfile(quote,contract),lineType,clientAmount:s.clientAmountCents/100,durationHours:s.durationMinutes/60,weeklyMeetingCount})
  lines.push({sourceId:s.id,sourceVersion:s.version,serviceDate:s.serviceDate,kind:s.lineType,durationMinutes:s.durationMinutes,contractId:contract.id,weeklyMeetingCount,professionalCents:cents(amount.professionalPay),supervisorCents:cents(amount.nancyPay),supervisorId:amount.nancyPay>0?contract.supervisorId:null,clinicCents:cents(amount.clinicRevenue),clientAmountCents:s.clientAmountCents})
 }
 return {lines,warnings,professionalCents:lines.reduce((s,l)=>s+l.professionalCents,0),supervisorCents:lines.reduce((s,l)=>s+l.supervisorCents,0),travelCents:lines.filter(l=>l.kind==='travel').reduce((s,l)=>s+l.professionalCents,0),clinicCents:lines.reduce((s,l)=>s+l.clinicCents,0),blocked}
}
/** Root route must already have verified GoTrue identity. SQL rechecks that actor.
 * Only this server path may submit a calculated amount to the service-role RPC.
 */
export async function prepareFeeCommand(runtime:DurableClinicalRuntime,token:string,actor:FixtureActor,command:FeeCommand,key:string):Promise<FeeAck>{
 if(!isFeeCommand(command)||!uuid(key))throw new ClinicalError(400,'FEE_INVALID_INPUT','La commande d’honoraires est invalide.')
 if(!actor.capabilities?.includes('administration'))throw new ClinicalError(403,'FEE_FORBIDDEN','Cette action exige les droits administratifs.')
 const caller=resolveActor(actor,{actorId:actor.id,context:'administration'})
 if(!canAdmin(caller))throw new ClinicalError(403,'FEE_FORBIDDEN','Cette action exige les droits administratifs.')
 let data:Record<string,unknown>={...command.data}
 if(command.action==='fee.prepare'||command.action==='fee.correct'){
  const quote=await localRpc<unknown>(runtime,token,'lab_fee_quote',{p_context:'administration',p_professional_id:command.action==='fee.prepare'?command.data.professionalId:null,p_from:command.action==='fee.prepare'?command.data.from:null,p_to:command.action==='fee.prepare'?command.data.to:null,p_statement_id:command.action==='fee.correct'?command.data.statementId:null})
  if(!isFeeQuote(quote))throw new ClinicalError(502,'FEE_INVALID_QUOTE','La préparation des honoraires n’a pas pu être vérifiée.')
  if(command.action==='fee.prepare'&&(quote.professionalId!==command.data.professionalId||quote.from!==command.data.from||quote.to!==command.data.to)||command.action==='fee.correct'&&quote.statementId!==command.data.statementId)throw new ClinicalError(502,'FEE_INVALID_QUOTE','La période du calcul ne correspond pas à la demande.')
  data={...data,quoteHash:quote.inputHash,calculation:calculateFeeQuote(quote)}
 }
 const ack=await localRpc<unknown>(runtime,runtime.serviceRoleKey,'lab_fee_server_command',{p_actor_id:actor.id,p_action:command.action,p_data:data,p_key:key})
 if(!isFeeAck(ack,command.action))throw new ClinicalError(502,'FEE_INVALID_ACK','La commande n’a pas pu être confirmée. Conservez votre saisie.')
 return ack
}
