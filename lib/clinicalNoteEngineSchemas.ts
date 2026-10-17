import { CLINICAL_ALERT_CATEGORIES, CLINICAL_FACT_KINDS } from '@/lib/clinicalNoteEngine'

const string = { type: 'string' }
const array = (items: object) => ({ type: 'array', items })
const object = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const factIds = array(string)
const alert = object({ category: { type: 'string', enum: CLINICAL_ALERT_CATEGORIES }, priority: { type: 'string', enum: ['normal', 'prioritaire'] }, text: string, factIds })
export const clinicalAlertsSchema = array(alert)
export const clinicalAnalysisSchema = object({ facts: array(object({
  id: string, kind: { type: 'string', enum: CLINICAL_FACT_KINDS }, speaker: string, text: string,
  source: { type: 'string', enum: ['transcript', 'history', 'metadata'] }, quote: string,
})), alerts: clinicalAlertsSchema })
export const clinicalDraftSchema = object({ sections: array(object({
  id: string, paragraphs: array(object({ text: string, factIds })), rows: array(object({ cells: array(string), factIds })),
})), alerts: clinicalAlertsSchema })
export const clinicalReviewSchema = object({ fidelityPassed: { type: 'boolean' }, alerts: clinicalAlertsSchema })
