const numberField = '{{numero_facture}}'
const fieldPattern = /\{\{([a-z_]+)\}\}/g
export const invoiceEmailFields = {
  numero_facture: 'Numéro de facture',
  nom_client: 'Nom du client',
  nom_payeur: 'Nom du payeur',
  dates_prestations: 'Dates des prestations',
  montant_total: 'Montant total',
} as const
type InvoiceField = keyof typeof invoiceEmailFields
export type InvoiceEmailValues = Partial<Record<Exclude<InvoiceField, 'numero_facture'>, string>>

export type InvoiceEmailTemplate = { subject: string; text: string }
export type InvoiceEmailTemplateSettings = { template: InvoiceEmailTemplate; version: number; canEdit: boolean }

export const defaultInvoiceEmailTemplate: InvoiceEmailTemplate = {
  subject: 'Facture no {{numero_facture}} — Clinique PsychoÉducAction',
  text: 'Bonjour,\n\nVeuillez trouver votre facture no {{numero_facture}} en pièce jointe. Pour toute question, répondez au courriel de la clinique.\n\nClinique PsychoÉducAction',
}

export function validInvoiceEmailTemplate(value: unknown): value is InvoiceEmailTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { subject, text } = value as Partial<InvoiceEmailTemplate>
  if (typeof subject !== 'string' || typeof text !== 'string' || subject.length > 200 || text.length > 4000 || /[\r\n\0]/.test(subject) || /\0/.test(text)) return false
  return [subject, text].every(field => field.includes(numberField) &&
    !/[{}]/.test(field.replace(fieldPattern, (token, key: string) => Object.hasOwn(invoiceEmailFields, key) ? '' : token)))
}

export function renderInvoiceEmail(template: InvoiceEmailTemplate, number: number, data: InvoiceEmailValues = {}): InvoiceEmailTemplate {
  if (!validInvoiceEmailTemplate(template) || !Number.isSafeInteger(number) || number < 1) throw new Error('INVOICE_TEMPLATE_INVALID')
  const values = { ...data, numero_facture: String(number) }
  const render = (value: string) => value.replace(fieldPattern, (_token, key: InvoiceField) => {
    const replacement = values[key]
    if (!replacement) throw new Error('INVOICE_TEMPLATE_FIELD_UNAVAILABLE')
    return replacement.replace(/[\r\n\0]/g, ' ')
  })
  return { subject: render(template.subject), text: render(template.text) }
}

export function invoiceEmailSettings(value: unknown): InvoiceEmailTemplateSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE')
  const { template, version, canEdit } = value as Record<string, unknown>
  if (typeof canEdit !== 'boolean' || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 ||
    (version === 0 ? template !== null : !validInvoiceEmailTemplate(template))) throw new Error('INVALID_RESPONSE')
  return { template: version === 0 ? defaultInvoiceEmailTemplate : template as InvoiceEmailTemplate, version, canEdit }
}
