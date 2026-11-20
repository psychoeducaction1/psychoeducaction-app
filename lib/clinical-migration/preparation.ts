import { mandateAgeAt, currentMandateBillingDay } from '../clinical-mandates/defaultPayer.ts'
import type { MigrationRow } from './model.ts'

export type MigrationRequester = { key: string; fullName: string; email: string; phone: string; address: string; relationship: string }
export type MigrationPreparation = {
  contactDate: string; startDate: string; outcome: 'active' | 'not_taken' | 'closed'
  additionalEmails: string; additionalPhones: string; consultationReason: string; modalities: string; availability: string; comments: string
  requesters: MigrationRequester[]; payers: { key: string; basisPoints: number }[]
  rateCents: number | null; rateSource: 'file' | 'default' | 'manual'; clinicalText: string; administrativeText: string
  settingsFingerprint: string; validated: boolean
}
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function importedAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw = typeof value === 'number' ? String(value) : String(value).trim().replace(/\s|\$|CAD/gi, '').replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const cents = Math.round(Number(raw) * 100)
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000 ? cents : null
}
export function preparationFromSource(row: MigrationRow, headers: string[] = [], cells: unknown[] = []): MigrationPreparation {
  const value = (...names: string[]) => {
    const indices = headers.flatMap((h,i) => names.some(n => fold(n) === fold(h)) ? [i] : [])
    return indices.length === 1 ? cells[indices[0]] : ''
  }
  const text = (...names: string[]) => String(value(...names) ?? '').trim()
  const date = (v: unknown) => {
    if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0,10)
    const s = String(v ?? '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : ''
  }
  const contactDate = date(value('date de contact', "date d'appel initial")) || date(row.intake?.initialCallDate)
  const dates = [contactDate, date(row.intake?.firstAppointmentDate), ...row.dates].filter(Boolean).sort()
  const requesters = (row.intake?.requesters ?? []).map((p,i) => ({ key: 'requester-' + (i+1), fullName: p.fullName, email: p.email, phone: '', address: [p.city,p.postalCode].filter(Boolean).join(' '), relationship: row.intake?.interlocutor && fold(row.intake.interlocutor) === fold(p.fullName) ? row.intake.relationship : '' }))
  for (const i of [1,2,3]) {
    const name = text('requérant ' + i, 'nom requérant ' + i)
    if (!name) continue
    const matches = requesters.filter(person => fold(person.fullName) === fold(name))
    const email = text('courriel correspondance ' + i, 'courriel requérant ' + i)
    const emailMatches = email ? matches.filter(person => person.email.toLocaleLowerCase() === email.toLocaleLowerCase()) : []
    const existing = emailMatches.length === 1 ? emailMatches[0] : matches.length === 1 ? matches[0] : undefined
    if (matches.length > 1 && !existing) continue
    const phone = text('téléphone requérant ' + i, 'téléphone ' + i)
    const address = text('adresse requérant ' + i, 'adresse ' + i)
    const relationship = text('lien requérant ' + i, 'lien avec le client ' + i)
    if (existing) { existing.email = email || existing.email; existing.phone = phone || existing.phone; existing.address = address || existing.address; existing.relationship = relationship || existing.relationship }
    else {
      let key = 'requester-' + i
      for (let suffix = 1; requesters.some(person => person.key === key); suffix++) key = 'requester-' + i + '-' + suffix
      requesters.push({ key, fullName: name, email, phone, address, relationship })
    }
  }
  const amount=importedAmount(value('tarif','taux horaire','montant','honoraires'))
  return normalizeMigrationRequesters(row, { contactDate, startDate: dates[0] ?? '', outcome: 'active', additionalEmails: row.email.split(/[;,\n]+/).slice(1).map(value=>value.trim()).filter(Boolean).join('; '), additionalPhones: row.phone.split(/[;\n]+/).slice(1).map(value=>value.trim()).filter(Boolean).join('; '), consultationReason: row.intake?.consultationReason??'', modalities: text('modalités de rencontre', 'modalités', 'mode de rencontre', 'modalité de service'), availability: text('préférences horaires', 'disponibilités', 'disponibilités du client'), comments: text('commentaires', 'notes internes', 'commentaire administratif'), requesters, payers: [], rateCents: amount, rateSource: amount===null?'default':'file', clinicalText: '', administrativeText: '', settingsFingerprint: '', validated: false })
}
export function migrationDefaultRate(service: string) { return fold(service) === 'interventionpsychoeducative' ? 10000 : fold(service) === 'psychoeducation' ? 13500 : null }
export function preparationErrors(p: MigrationPreparation): string[] {
  const errors: string[] = []
  if (p.requesters.length > 10) errors.push('Conservez au maximum dix requérants, client compris.')
  if (!['active','not_taken','closed'].includes(p.outcome)) errors.push('Choisissez le résultat du service.')
  if (p.rateCents !== null && (!Number.isSafeInteger(p.rateCents) || p.rateCents <= 0 || p.rateCents > 10000000)) errors.push('Tarif invalide.')
  if (p.payers.length && (p.payers.some(x => !Number.isInteger(x.basisPoints) || x.basisPoints <= 0 || x.basisPoints > 10000) || p.payers.reduce((s,x) => s+x.basisPoints,0) !== 10000)) errors.push('Les parts des responsables des honoraires doivent totaliser 100 %.')
  if (new Set(p.payers.map(x => x.key)).size !== p.payers.length) errors.push('Un responsable est sélectionné plusieurs fois.')
  if ([...p.additionalEmails.split(/[;,\n]+/),...p.requesters.map(person=>person.email)].some(email=>email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) errors.push('Vérifiez les courriels renseignés.')
  return errors
}

/** Only a server-confirmed import leaves the preparation list; original indices stay stable. */
export function pendingMigrationEntries(rows: MigrationRow[], items: { source_key: string; status: string }[] = []): { row: MigrationRow; index: number }[] {
  const imported = new Set(items.filter(item => item.status === 'imported').map(item => item.source_key))
  return rows.flatMap((row, index) => imported.has(row.sourceKey) ? [] : [{ row, index }])
}

/** Administrative requester default only: never consent, representation or a new payer share. */
export function normalizeMigrationRequesters(row: MigrationRow, p: MigrationPreparation, day = currentMandateBillingDay()): MigrationPreparation {
  const name = [row.firstName, row.lastName].map(value => value.trim()).filter(Boolean).join(' ')
  const age = mandateAgeAt(row.birthDate, day)
  const clientEmail = row.email.split(/[;,\n]+/)[0]?.trim().toLocaleLowerCase() ?? ''
  const isSelf = (person: MigrationRequester) => person.key === 'client' || Boolean(name && fold(person.fullName) === fold(name) && (!clientEmail || !person.email.trim() || person.email.trim().toLocaleLowerCase() === clientEmail))
  const self = p.requesters.filter(isSelf)
  const others = p.requesters.filter(person => !isSelf(person))
  const remapped = new Map<string, number>()
  for (const share of p.payers) {
    const key = self.some(person => person.key === share.key) ? 'client' : share.key
    remapped.set(key, (remapped.get(key) ?? 0) + share.basisPoints)
  }
  const requesters = age !== null && age >= 14 && name ? [{ key: 'client', fullName: name, relationship: 'Lui-même', email: self.find(person => person.email)?.email || row.email.split(/[;,\n]+/)[0]?.trim() || '', phone: self.find(person => person.phone)?.phone || row.phone, address: self.find(person => person.address)?.address || row.address }, ...others] : age !== null && age < 14 ? others : p.requesters.map(person => isSelf(person) ? { ...person, relationship: '' } : person)
  return { ...p, requesters, payers: [...remapped].map(([key, basisPoints]) => ({ key, basisPoints })) }
}
