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
const reasonLabels = ['motif de consultation', 'raison de consultation', 'motif de la demande', 'raison de la demande', "message d’origine", 'message initial']
const distinctText = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]

/** Use explicit labels and a single consistent value. Leave contradictory sources for review. */
export function extractPdfConsultationReason(pages: string[]): string {
  const values = distinctText(pages.flatMap(page => page.split(/\r?\n/).flatMap(line => {
    const separator = line.indexOf(':')
    if (separator <= 0 || !reasonLabels.some(label => fold(label) === fold(line.slice(0, separator)))) return []
    const value = line.slice(separator + 1).trim()
    if (value.length > 1000 || /[a-zÀ-ÿ]{2,}\s*:\s+/.test(value)) return []
    return [value]
  })))
  return values.length === 1 ? values[0] : ''
}

export function extractMigrationIntake(headers: string[], cells: unknown[]): MigrationIntake {
  const labels = headers.map(fold)
  const value = (label: string, limit = 1000) => {
    const indices = labels.flatMap((h, i) => h === fold(label) ? [i] : [])
    if (indices.length !== 1) return ''
    const raw = cells[indices[0]]
    return (raw instanceof Date ? (Number.isFinite(raw.getTime()) ? raw.toISOString().slice(0, 10) : '') : String(raw ?? '').trim()).slice(0, limit)
  }
  const aliases = (...names: string[]) => {
    const values = distinctText(names.map(name => value(name)))
    return values.length === 1 ? values[0] : ''
  }
  return {
    initialCallDate: aliases("DATE D'APPEL INITIAL", 'DATE DU PREMIER APPEL', 'DATE DE CONTACT').slice(0, 100), firstAppointmentDate: aliases('DATE PREMIER RENDEZ-VOUS', 'DATE DU PREMIER RENDEZ-VOUS', 'PREMIER RENDEZ-VOUS').slice(0, 100),
    consultationReason: aliases(...reasonLabels), referredBy: aliases('RÉFÉRÉ PAR', 'SOURCE DE RÉFÉRENCE', 'RÉFÉRENCE').slice(0, 200),
    originalMandates: labels.flatMap((h, i) => h === 'mandat' && cells[i] ? [String(cells[i]).trim().slice(0, 500)] : []),
    clientele: value('CLIENTÈLE', 200), sourceActive: value('ACTIF', 100),
    billingResponsible: value('RESPONSABLE DES HONORAIRES', 200), interlocutor: value("NOM DE L'INTERLOCUTEUR", 200),
    relationship: value('LIEN AVEC LE CLIENT', 100),
    requesters: [1, 2, 3].map(i => ({ fullName: value('NOM REQUÉRANT ' + i, 200),
      email: value('COURRIEL CORRESPONDANCE ' + i, 254), city: value('VILLE ' + i, 200), postalCode: value('CODE POSTAL ' + i, 30) })).filter(p => p.fullName),
  }
}
