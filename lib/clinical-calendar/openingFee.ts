export type OpeningFeeActivity = {
  id: string; totalCents: number; createdAt: string
  invoices: { id: string; number: string; amountCents: number; voided: boolean }[]
}

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
export function isOpeningFeeActivity(value: unknown): value is OpeningFeeActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const activity = value as Partial<OpeningFeeActivity>
  return uuid.test(activity.id ?? '') && positive(activity.totalCents) &&
    typeof activity.createdAt === 'string' && Number.isFinite(Date.parse(activity.createdAt)) &&
    Array.isArray(activity.invoices) && activity.invoices.length > 0 && activity.invoices.length <= 20 &&
    activity.invoices.every(invoice => invoice && uuid.test(invoice.id) && /^\d{1,20}$/.test(invoice.number) &&
      positive(invoice.amountCents) && typeof invoice.voided === 'boolean') &&
    activity.invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0) === activity.totalCents
}
