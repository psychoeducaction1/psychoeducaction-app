import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { CalendarCommand, CalendarCommandAck, DurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTypes'
import { validCalendarDate } from '@/lib/clinical-calendar/time'

export const CALENDAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const CALENDAR_ACTIONS = ['appointments.correct','appointments.remove','appointments.create','appointments.reschedule','appointments.cancel','appointments.outcome','availability.set','offices.create','offices.update','office-grants.set','activities.correct'] as const
const collections = ['professionals','clients','offices','officeGrants','availability','appointments','busy','history'] as const
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const shape = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = (value: unknown, max = 300) => typeof value === 'string' && value.length <= max
const uuid = (value: unknown): value is string => typeof value === 'string' && CALENDAR_UUID.test(value)
const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min
const instant = (value: unknown) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const nullable = (value: unknown, check: (input: unknown) => boolean) => value === null || check(value)
const ids = (value: unknown) => Array.isArray(value) && value.length <= 1000 && value.every(uuid) && new Set(value).size === value.length
const kilometers = (value: unknown) => typeof value === 'string' && /^\d{1,8}(?:\.\d{1,4})?$/.test(value)
const revisions = (value: unknown) => object(value) && Object.entries(value).every(([key, item]) => uuid(key) && integer(item))
const feePercent = (value: unknown) => value === 0 || value === 50 || value === 100
const feePercents = (value: unknown) => Array.isArray(value) && value.length >= 1 && value.length <= 3 && value[0] === 0 && value.every(feePercent) && new Set(value).size === value.length
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const payerShares = (value: unknown) => Array.isArray(value) && value.length <= 20 && value.every(item => shape(item,['personId','basisPoints']) && uuid(item.personId) && integer(item.basisPoints,1) && Number(item.basisPoints) <= 10000) && new Set(value.map(item=>item.personId)).size === value.length && (value.length === 0 || value.reduce((sum,item)=>sum+Number(item.basisPoints),0) === 10000)
function financialOverride(value: unknown): boolean {
  return shape(value,['hourlyRateCents','reason','payers']) && nullable(value.hourlyRateCents,item=>integer(item,1)&&Number(item)<=10000000) && text(value.reason,1000) && nullable(value.payers,payerShares) && (value.hourlyRateCents === null && value.payers === null || String(value.reason).trim().length > 0)
}
function acceptedConditions(value: unknown): boolean {
  return shape(value,['reviewed','mandateRevisionId','documentId','documentHash','signatureId','allowedFeePercents','homeTravelPerformedAllowed','reason']) && value.reviewed === true && uuid(value.mandateRevisionId) && uuid(value.documentId) && hash(value.documentHash) && uuid(value.signatureId) && feePercents(value.allowedFeePercents) && typeof value.homeTravelPerformedAllowed === 'boolean' && text(value.reason,1000) && String(value.reason).trim().length > 0
}
export function isCalendarFinancialOptions(value: unknown): boolean {
  return shape(value,['mandateRevisionId','hourlyRateCents','hourlyOverrideCents','reason','payers','conditionsId','acceptanceEvidence']) && nullable(value.mandateRevisionId,uuid) && nullable(value.hourlyRateCents,item=>integer(item,1)&&Number(item)<=10000000) && nullable(value.hourlyOverrideCents,item=>integer(item,1)&&Number(item)<=10000000) && text(value.reason,1000) && nullable(value.conditionsId,uuid)
    && Array.isArray(value.payers) && value.payers.length <= 20 && value.payers.every(item=>shape(item,['personId','name','basisPoints'])&&uuid(item.personId)&&text(item.name,200)&&integer(item.basisPoints,1)&&Number(item.basisPoints)<=10000) && new Set(value.payers.map(item=>item.personId)).size === value.payers.length && (value.payers.length === 0 || value.payers.reduce((sum,item)=>sum+Number(item.basisPoints),0)===10000)
    && Array.isArray(value.acceptanceEvidence) && value.acceptanceEvidence.length <= 1000 && value.acceptanceEvidence.every(item=>shape(item,['mandateRevisionId','documentId','documentHash','signatureId','signerName','signedAt'])&&uuid(item.mandateRevisionId)&&uuid(item.documentId)&&hash(item.documentHash)&&uuid(item.signatureId)&&text(item.signerName,200)&&instant(item.signedAt))
}
export function isCalendarAbsenceDecision(value: unknown): boolean {
  return shape(value,['kind','feePercent','noticeAt','recordedAt','travelPerformed','allowedFeePercents','homeTravelPerformedAllowed','nonzeroBlockedReason']) && ['none','no_show','late_cancellation','timely_cancellation'].includes(String(value.kind)) && (value.kind === 'none' ? value.feePercent === null && value.recordedAt === null : feePercent(value.feePercent) && instant(value.recordedAt)) && nullable(value.noticeAt,instant) && typeof value.travelPerformed === 'boolean' && feePercents(value.allowedFeePercents) && typeof value.homeTravelPerformedAllowed === 'boolean' && nullable(value.nonzeroBlockedReason,item=>['ACCEPTED_CONDITIONS_REQUIRED','HOME_TRAVEL_CONDITIONS_REQUIRED'].includes(String(item))) && (value.kind !== 'timely_cancellation' || value.feePercent === 0)
}
export function isCalendarFinancialContext(value: unknown, context: ClinicalAccessContext, expected: {episodeId:string;professionalId:string;serviceDate:string}): value is import('./durableTypes').CalendarFinancialContext {
  return shape(value,['episodeId','professionalId','serviceDate','billable','financialOptions','absenceDecision']) && uuid(value.episodeId) && uuid(value.professionalId) && value.episodeId === expected.episodeId && value.professionalId === expected.professionalId && value.serviceDate === expected.serviceDate && typeof value.serviceDate === 'string' && validCalendarDate(value.serviceDate) && typeof value.billable === 'boolean' && nullable(value.financialOptions,isCalendarFinancialOptions) && (context !== 'clinical' || value.financialOptions === null) && isCalendarAbsenceDecision(value.absenceDecision)
}
export function isCalendarPeriod(from: unknown, to: unknown): from is string {
  return typeof from === 'string' && typeof to === 'string' && validCalendarDate(from) && validCalendarDate(to) && from <= to && (Date.parse(to)-Date.parse(from))/86400000 <= 92
}
export function isCalendarCommand(value: unknown): value is CalendarCommand {
  if (!shape(value,['action','id','data']) || typeof value.action !== 'string' || !(CALENDAR_ACTIONS as readonly string[]).includes(value.action) || !object(value.data)) return false
  if (value.action === 'appointments.correct') return uuid(value.id) && shape(value.data, ['expectedVersion','previewHash','confirmed','reason','title','startLocal','durationMinutes','modality','officeId','location','travelBeforeMinutes','travelAfterMinutes','travelKilometers', ...(value.data.disambiguation === undefined ? [] : ['disambiguation'])]) && integer(value.data.expectedVersion,1) && hash(value.data.previewHash) && value.data.confirmed === true && text(value.data.reason,1000) && String(value.data.reason).trim().length > 0 && text(value.data.title,200) && typeof value.data.startLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.data.startLocal) && integer(value.data.durationMinutes,1) && Number(value.data.durationMinutes) <= 720 && nullable(value.data.modality,x=>['office','home','phone','video'].includes(String(x))) && nullable(value.data.officeId,uuid) && text(value.data.location,500) && integer(value.data.travelBeforeMinutes) && Number(value.data.travelBeforeMinutes)<=180 && integer(value.data.travelAfterMinutes) && Number(value.data.travelAfterMinutes)<=180 && kilometers(value.data.travelKilometers) && (value.data.disambiguation === undefined || ['earlier','later'].includes(String(value.data.disambiguation)))
  if (value.action === 'appointments.remove') return uuid(value.id) && shape(value.data,['expectedVersion','previewHash','confirmed']) && integer(value.data.expectedVersion,1) && hash(value.data.previewHash) && value.data.confirmed === true
  const data = value.data, configurable = ['appointments.create','appointments.reschedule'].includes(value.action)
  if (value.action === 'appointments.reschedule' && Object.hasOwn(data,'professionalId') && !uuid(data.professionalId)) return false
  if (Object.hasOwn(data,'billable') && (!configurable || typeof data.billable !== 'boolean') || Object.hasOwn(data,'financialOverride') && (!configurable || !financialOverride(data.financialOverride)) || Object.hasOwn(data,'acceptedConditions') && (!configurable || !acceptedConditions(data.acceptedConditions))) return false
  if (Object.hasOwn(data,'feePercent') && (!['appointments.cancel','appointments.outcome'].includes(value.action) || !feePercent(data.feePercent)) || Object.hasOwn(data,'travelPerformed') && (!['appointments.cancel','appointments.outcome'].includes(value.action) || typeof data.travelPerformed !== 'boolean')) return false
  if (Object.hasOwn(data,'absenceDecision') && (!configurable || !shape(data.absenceDecision,['status','feePercent','travelPerformed']) || !['no_show','cancelled'].includes(String(data.absenceDecision.status)) || !feePercent(data.absenceDecision.feePercent) || typeof data.absenceDecision.travelPerformed !== 'boolean')) return false
  return value.action === 'appointments.create' || value.action === 'offices.create' ? value.id === null : uuid(value.id)
}
function activity(value: unknown): boolean {
  return shape(value,['id','appointmentId','episodeId','professionalId','serviceDate','actualMinutes','travelKilometers','version','billingState','billingNotBeforeDate'])
    && uuid(value.id) && uuid(value.appointmentId) && nullable(value.episodeId,uuid) && uuid(value.professionalId)
    && typeof value.serviceDate === 'string' && validCalendarDate(value.serviceDate) && integer(value.actualMinutes)
    && kilometers(value.travelKilometers) && integer(value.version,1) && value.billingState === 'pending_future_rules'
    && typeof value.billingNotBeforeDate === 'string' && validCalendarDate(value.billingNotBeforeDate)
}
function clinicalLink(value: unknown): boolean {
  return shape(value,['recordId','canCreate','notes']) && uuid(value.recordId) && typeof value.canCreate === 'boolean' && Array.isArray(value.notes) && value.notes.every(note =>
    shape(note,['id','status','noteType','version']) && uuid(note.id) && ['draft','awaiting_cosignature','signed'].includes(String(note.status))
    && ['evaluation_1','evaluation_2','evaluation_3','plan_intervention','evolution','observation','fermeture'].includes(String(note.noteType)) && integer(note.version,1))
}
const eventKeys = ['id','kind','title','hiddenFromDirection','episodeId','caseId','clientId','clientName','professionalId','startAt','endAt','modality','officeId','location','travelBeforeMinutes','travelAfterMinutes','travelKilometers','status','seriesId','seriesRevision','occurrenceIndex','isException','version','createdAt','updatedAt','cancelledAt','cancellationReason','canReschedule','canCancel','canRecordOutcome','canCorrectActivity','activity','clinicalLink','billable','financialOptions','absenceDecision','canChangeProfessional']
function event(value: unknown, actorId: string | undefined, context: ClinicalAccessContext): boolean {
  if (!object(value) || !shape(value,[...eventKeys,...['canRemove','canCorrectEncounter'].filter(key=>value[key] !== undefined)]) || ['canRemove','canCorrectEncounter'].some(key=>value[key] !== undefined && typeof value[key] !== 'boolean')) return false
  return uuid(value.id) && ['meeting','documentation','absence','other'].includes(String(value.kind)) && text(value.title) && typeof value.hiddenFromDirection === 'boolean'
    && nullable(value.episodeId,uuid) && nullable(value.caseId,uuid) && nullable(value.clientId,uuid) && nullable(value.clientName,item=>text(item))
    && uuid(value.professionalId) && (context !== 'clinical' || !actorId || value.professionalId === actorId) && instant(value.startAt) && instant(value.endAt)
    && Date.parse(String(value.endAt)) > Date.parse(String(value.startAt)) && nullable(value.modality,item=>['office','home','phone','video'].includes(String(item)))
    && nullable(value.officeId,uuid) && text(value.location,1000) && integer(value.travelBeforeMinutes) && integer(value.travelAfterMinutes) && kilometers(value.travelKilometers)
    && ['planned','completed','cancelled','no_show'].includes(String(value.status)) && nullable(value.seriesId,uuid) && nullable(value.seriesRevision,item=>integer(item))
    && nullable(value.occurrenceIndex,item=>integer(item)) && typeof value.isException === 'boolean' && integer(value.version,1) && instant(value.createdAt) && instant(value.updatedAt)
    && nullable(value.cancelledAt,instant) && nullable(value.cancellationReason,item=>['client','professional','clinic'].includes(String(item)))
    && ['canReschedule','canCancel','canRecordOutcome','canCorrectActivity'].every(key=>typeof value[key] === 'boolean')
    && typeof value.billable === 'boolean' && nullable(value.financialOptions,isCalendarFinancialOptions) && isCalendarAbsenceDecision(value.absenceDecision) && typeof value.canChangeProfessional === 'boolean' && (context !== 'clinical' || value.financialOptions === null && value.canChangeProfessional === false)
    && nullable(value.activity,activity) && nullable(value.clinicalLink,clinicalLink) && (context !== 'administration' || value.clinicalLink === null)
}
export function isDurableCalendarWorkspace(value: unknown, context: ClinicalAccessContext, actorId?: string, period?: {from:string;to:string}): value is DurableCalendarWorkspace {
  if (!shape(value,['mode','durable','actorId','context','currentTime','from','to',...collections,'officeGrantRevisions','availabilityRevisions'])
    || !['isolated_local', 'isolated_unified'].includes(String(value.mode)) || value.durable !== true || !uuid(value.actorId) || (actorId && value.actorId !== actorId) || value.context !== context
    || !instant(value.currentTime) || !isCalendarPeriod(value.from,value.to) || (period && (value.from !== period.from || value.to !== period.to))
    || !collections.every(key=>Array.isArray(value[key])) || !revisions(value.officeGrantRevisions) || !revisions(value.availabilityRevisions)) return false
  const all = (key: typeof collections[number], check: (item: unknown)=>boolean) => (value[key] as unknown[]).every(check)
  return all('professionals',item=>shape(item,['id','name']) && uuid(item.id) && text(item.name))
    && all('clients',item=>shape(item,['clientId','episodeId','caseId','name','episodeLabel','serviceAddress','professionalIds']) && uuid(item.clientId) && uuid(item.episodeId) && nullable(item.caseId,uuid) && text(item.name) && text(item.episodeLabel) && text(item.serviceAddress,500) && ids(item.professionalIds) && (context !== 'clinical' || !actorId || (item.professionalIds as string[]).includes(actorId)))
    && all('offices',item=>shape(item,['id','name','color','active','version']) && uuid(item.id) && text(item.name,120) && typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) && typeof item.active === 'boolean' && integer(item.version,1))
    && all('officeGrants',item=>shape(item,['officeId','professionalId','validFrom','validTo']) && uuid(item.officeId) && uuid(item.professionalId) && typeof item.validFrom === 'string' && validCalendarDate(item.validFrom) && nullable(item.validTo,x=>typeof x === 'string' && validCalendarDate(x)) && (context !== 'clinical' || !actorId || item.professionalId === actorId))
    && all('availability',item=>shape(item,['id','professionalId','weekday','startMinute','endMinute','validFrom','validTo']) && uuid(item.id) && uuid(item.professionalId) && integer(item.weekday,1) && Number(item.weekday)<=7 && integer(item.startMinute) && integer(item.endMinute,1) && Number(item.startMinute)<Number(item.endMinute) && Number(item.endMinute)<=1440 && typeof item.validFrom === 'string' && validCalendarDate(item.validFrom) && nullable(item.validTo,x=>typeof x === 'string' && validCalendarDate(x)) && (context !== 'clinical' || !actorId || item.professionalId === actorId))
    && all('appointments',item=>event(item,actorId,context))
    && all('busy',item=>shape(item,['officeId','startAt','endAt','kind']) && uuid(item.officeId) && instant(item.startAt) && instant(item.endAt) && item.kind === 'busy')
    && all('history',item=>shape(item,['id','appointmentId','professionalId','action','actorId','at','version']) && uuid(item.id) && nullable(item.appointmentId,uuid) && nullable(item.professionalId,uuid) && text(item.action,80) && (uuid(item.actorId) || value.mode==='isolated_unified' && item.actorId===null && item.action==='appointment_completed_automatic') && instant(item.at) && nullable(item.version,x=>integer(x)))
}
export function isCalendarAck(value: unknown, context: ClinicalAccessContext, actorId?: string): value is CalendarCommandAck {
  return shape(value,['mode','durable','actorId','context','result']) && ['isolated_local', 'isolated_unified'].includes(String(value.mode)) && value.durable === true && uuid(value.actorId)
    && (!actorId || value.actorId === actorId) && value.context === context && shape(value.result,['kind','id','affectedIds','version'])
    && typeof value.result.kind === 'string' && /^[a-z][a-z_-]{0,39}$/.test(value.result.kind) && uuid(value.result.id) && ids(value.result.affectedIds) && nullable(value.result.version,x=>integer(x))
}
