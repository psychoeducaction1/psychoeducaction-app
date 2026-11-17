import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { PayrollCategory,ProfessionalPayrollInfo } from '@/lib/payrollCalculator'
export type FeeRule='standard'|'legacy_80'|'legacy_supervised_110_35'|'owner_full_clinic'|'service_libre'
export type FeeContract={id:string;professionalId:string;effectiveFrom:string;rule:FeeRule;category:PayrollCategory|null;supervisorId:string|null;reason:string;createdAt:string;createdBy:string}
export type FeeInputSource={id:string;version:number;professionalId:string;serviceDate:string;lineType:'meeting'|'report'|'travel'|'cancellation'|'opening';clientAmountCents:number|null;durationMinutes:number;meetingId:string|null;status:'completed'|'cancelled'|'no_show';ready:boolean;adjustmentBlocked:boolean;meetingEquivalentHalfUnits?:0|1|2}
export type FeeInputQuote={professional:Pick<ProfessionalPayrollInfo,'id'|'fullName'|'email'>;sources:FeeInputSource[];fingerprint:string}
export type FeeQuote={professionalId:string;from:string;to:string;contextFrom:string;contextTo:string;inputHash:string;inputs:FeeInputQuote;contracts:FeeContract[];statementId:string|null}
export type FeeWarning={code:'MISSING_CONTRACT'|'SERVICE_LIBRE_DISABLED'|'UNISSUED_SOURCE'|'ADJUSTMENT_REVIEW_REQUIRED'|'CANCELLATION_AMOUNT_MISSING'|'SUPERVISOR_REQUIRED';sourceId:string|null;serviceDate:string|null}
export type FeeCalculatedLine={sourceId:string;sourceVersion:number;serviceDate:string;kind:FeeInputSource['lineType'];durationMinutes:number;contractId:string;weeklyMeetingCount:number;professionalCents:number;supervisorCents:number;supervisorId:string|null;clinicCents:number;clientAmountCents:number}
export type FeeCalculation={lines:FeeCalculatedLine[];warnings:FeeWarning[];professionalCents:number;supervisorCents:number;travelCents:number;clinicCents:number;blocked:boolean}
export type FeeStatementStatus='prepared'|'validated'|'closed'
export type FeeStatement={id:string;professionalId:string;professionalName:string;from:string;to:string;version:number;revision:number;status:FeeStatementStatus;blocked:boolean;previousStatementId:string|null;correctionReason:string;inputHash:string;professionalCents:number;supervisorCents:number;travelCents:number;clinicCents:number;warnings:FeeWarning[];lines:FeeCalculatedLine[];createdAt:string;validatedAt:string|null;closedAt:string|null;documentId:string|null}
export type PersonalFeeLine={serviceDate:string;kind:FeeInputSource['lineType']|'supervision'|'regularisation';durationMinutes:number|null;amountCents:number}
export type PersonalFeeStatement={id:string;from:string;to:string;revision:number;status:'validated'|'closed';professionalCents:number;travelCents:number;lines:PersonalFeeLine[];createdAt:string;validatedAt:string;closedAt:string|null;documentId:string|null;previousStatementId:string|null;source?:'historical'}
export type HistoricalFeeStatement=PersonalFeeStatement&{source:'historical';professionalId:string;professionalName:string}
type FeeRuntime={mode:'isolated_local';fictional:true}|{mode:'isolated_unified';fictional:false}
export type FeeWorkspace=FeeRuntime&({durable:true;actorId:string;context:ClinicalAccessContext;kind:'administrative';professionals:{id:string;name:string}[];contracts:FeeContract[];statements:(FeeStatement|HistoricalFeeStatement)[]}|{durable:true;actorId:string;context:'clinical';kind:'professional';statements:PersonalFeeStatement[]})
export type FeeCommand=
 |{action:'fee.contract.add';data:{professionalId:string;effectiveFrom:string;rule:FeeRule;category:PayrollCategory|null;supervisorId:string|null;reason:string}}
 |{action:'fee.prepare';data:{professionalId:string;from:string;to:string}}
 |{action:'fee.validate'|'fee.close';data:{statementId:string;expectedVersion:number}}
 |{action:'fee.correct';data:{statementId:string;expectedVersion:number;reason:string}}
export type FeeAck={ok:true;action:FeeCommand['action'];id:string;version:number;replayed?:boolean}
