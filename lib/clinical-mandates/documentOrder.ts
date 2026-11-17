import type { MandateDocument } from './types'

/** Signature order is authoritative; rendering can finish out of order. */
export function newestMandateDocument(a: MandateDocument, b: MandateDocument): number {
  return (b.signatureCount ?? 0) - (a.signatureCount ?? 0)
    || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}
