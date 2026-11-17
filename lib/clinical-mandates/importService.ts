export type ImportedServiceCase = {
  caseId: string; label: string; revisionId: string; version: number; serviceId: string | null
  prerequisite: 'identity' | 'payer' | null
  services: { id: string; label: string; code: string }[]
}
export type ImportedServices = { clientId: string; cases: ImportedServiceCase[] }
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function isImportedServices(v: unknown, clientId: string): v is ImportedServices {
  return plain(v) && v.clientId === clientId && Array.isArray(v.cases) && v.cases.length <= 100 && v.cases.every(c =>
    plain(c) && id(c.caseId) && id(c.revisionId) && typeof c.label === 'string' && c.label.length <= 200
    && Number.isSafeInteger(c.version) && Number(c.version) > 0 && (c.serviceId === null || id(c.serviceId))
    && [null, 'identity', 'payer'].includes(c.prerequisite as string | null)
    && Array.isArray(c.services) && c.services.length <= 100 && c.services.every(s => plain(s) && id(s.id)
      && typeof s.label === 'string' && s.label.length <= 200 && typeof s.code === 'string' && s.code.length <= 100))
}
