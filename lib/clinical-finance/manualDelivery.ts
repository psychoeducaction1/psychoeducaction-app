export type InvoiceDeliveryPreview = { id: string; version: number; number: string | null; clientName: string; payerName: string; recipient: string; totalCents: number; serviceDates: string[]; status: string; blockedReason: string | null; digest: string }
export type InvoiceDeliveryList = { enabled: boolean; serviceDate: string; invoices: InvoiceDeliveryPreview[] }
