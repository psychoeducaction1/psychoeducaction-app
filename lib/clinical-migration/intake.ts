/** Source facts only: requester/payer names never establish clinical authority. */
export type MigrationIntake = {
  initialCallDate: string; firstAppointmentDate: string; consultationReason: string;
  referredBy: string; originalMandates: string[]; clientele: string; sourceActive: string;
  billingResponsible: string; interlocutor: string; relationship: string;
  requesters: { fullName: string; email: string; city: string; postalCode: string }[];
}
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function validImportedIntake(value: unknown): boolean {
  const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const text = (v: unknown, limit: number) => typeof v === 'string' && v.length <= limit
  return Array.isArray(value) && value.length <= 500 && value.every(item => {
    if (!object(item) || !/^[a-f0-9-]{36}$/i.test(String(item.caseId)) || typeof item.reviewRequired !== 'boolean'
      || !(item.financiallyActive === null || typeof item.financiallyActive === 'boolean') || !object(item.facts)) return false
    const f = item.facts
    return ['initialCallDate','firstAppointmentDate','consultationReason','referredBy','clientele','sourceActive','billingResponsible','interlocutor','relationship'].every(k => text(f[k],1000))
      && Array.isArray(f.originalMandates) && f.originalMandates.length <= 20 && f.originalMandates.every(v => text(v,500))
      && Array.isArray(f.requesters) && f.requesters.length <= 10 && f.requesters.every(p => object(p)
        && text(p.fullName,200) && text(p.email,254) && text(p.city,200) && text(p.postalCode,30))
  })
}
export function extractMigrationIntake(headers: string[], cells: unknown[]): MigrationIntake {
  const labels = headers.map(fold)
  const value = (label: string, limit = 1000) => {
    const indices = labels.flatMap((h, i) => h === fold(label) ? [i] : [])
    if (indices.length !== 1) return ''
    const raw = cells[indices[0]]
    return (raw instanceof Date ? (Number.isFinite(raw.getTime()) ? raw.toISOString().slice(0, 10) : '') : String(raw ?? '').trim()).slice(0, limit)
  }
  return {
    initialCallDate: value("DATE D'APPEL INITIAL", 100), firstAppointmentDate: value('DATE PREMIER RENDEZ-VOUS', 100),
    consultationReason: value("MESSAGE D'ORIGINE"), referredBy: value('RÉFÉRÉ PAR', 200),
    originalMandates: labels.flatMap((h, i) => h === 'mandat' && cells[i] ? [String(cells[i]).trim().slice(0, 500)] : []),
    clientele: value('CLIENTÈLE', 200), sourceActive: value('ACTIF', 100),
    billingResponsible: value('RESPONSABLE DES HONORAIRES', 200), interlocutor: value("NOM DE L'INTERLOCUTEUR", 200),
    relationship: value('LIEN AVEC LE CLIENT', 100),
    requesters: [1, 2, 3].map(i => ({ fullName: value('NOM REQUÉRANT ' + i, 200),
      email: value('COURRIEL CORRESPONDANCE ' + i, 254), city: value('VILLE ' + i, 200), postalCode: value('CODE POSTAL ' + i, 30) })).filter(p => p.fullName),
  }
}
