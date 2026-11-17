import type { MandateDraft, MandatePerson, MandateRevision, MandateSigner, MandateStatus, MandateWorkspace } from '@/lib/clinical-mandates/types'
import type { ClientAdminProjection } from '@/lib/clinical-core/types'
import type { ClientOverview, ClientPerson } from '@/lib/clinical-workspace/clientDetails'
import { withStandardClinicalConsent, withStandardAdministrativeConsent } from '@/lib/clinical-mandates/standardConsent'
import { orderedClinicalServices } from '@/lib/clinical-mandates/serviceOrder'
import { currentMandateBillingDay, defaultMandatePayers, mandateAgeAt } from '@/lib/clinical-mandates/defaultPayer'

export const statusLabels: Record<MandateStatus, string> = { draft: 'Consentement à compléter', prepared: 'Consentement à compléter', partially_signed: 'Consentement à compléter', signed: 'Consentement signé', archived: 'Archivé' }
export const roleLabels = { client: 'Client', representative: 'Représentant', payer: 'Payeur', professional: 'Professionnel', supervisor: 'Superviseur', contact: 'Contact' }
export const audienceLabels = { administrative: 'Convention administrative', clinical: 'Consentement clinique sans tarifs' }
function withProfessionalSigner(signers: MandateSigner[], professionalId: string, professionalName?: string): MandateSigner[] {
  const retained = signers.filter(signer => signer.role !== 'professional' || signer.profileId === professionalId)
  if (!professionalId || !professionalName || retained.some(signer => signer.profileId === professionalId && signer.role === 'professional')) return retained
  return [...retained, { id: crypto.randomUUID(), personId: null, profileId: professionalId, name: professionalName, role: 'professional', audience: 'clinical', required: false }]
}
export function centsFromInput(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Indiquez un montant positif avec au plus deux décimales.')
  const [whole, decimal = ''] = normalized.split('.'), cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 10000000) throw new Error('Montant hors limite du laboratoire.')
  return cents
}
export const moneyInput = (value: number) => (value / 100).toFixed(2)
export const moneyLabel = (value: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(value / 100)
export const timeLabel = (value: string) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export function ageAt(birthDate: string | null | undefined, date: string): number | null {
  return mandateAgeAt(birthDate, date)
}
export function requiredMinorConsentIds(overview: ClientOverview | undefined, date: string): string[] {
  if (!overview || ageAt(overview.profile.birthDate, date) === null || ageAt(overview.profile.birthDate, date)! >= 14) return []
  return overview.contacts.filter(person => person.source !== 'mandate' && (person.source === 'representative' || ['Père', 'Mère'].includes(person.relationship))).map(person => person.id)
}
const personFrom = (id: string, name: string, email: string, roles: MandatePerson['roles']): MandatePerson => ({ id, name, email, roles, authorityVerified: false, authorityBasis: '', canConsent: false, canCommunicate: false, canReadDocuments: false, canRepresent: false })
/** Never merge equal names or infer legal rights from an existing role. */
export function peopleFromClient(client?: ClientAdminProjection): MandatePerson[] {
  if (!client) return []
  return [personFrom(client.id, client.firstName + ' ' + client.lastName, '', ['client']),
    ...client.contacts.filter(person => person.relationship !== 'Lui-même').map(person => personFrom(person.id, person.fullName, person.email, ['contact'])),
    ...client.representatives.filter(person => person.relationship !== 'Lui-même').map(person => personFrom(person.id, person.fullName, '', ['representative'])),
    ...client.payers.filter(person => person.payerType !== 'self').map(person => personFrom(person.id, person.fullName, person.email, ['contact']))]
}
export type MandateServiceSetting = { enabled: boolean; overrideCents: number | null; overrideReason: string; supervisorId: string | null; templateId: string | null; policyId: string | null }
/** Changing supervision only changes this editable draft; canonical access is server-owned. */
export function withMandateSupervisor(draft: MandateDraft, supervisorId: string | null): MandateDraft {
  return { ...draft, supervisorId, signers: draft.signers.filter(signer => signer.role !== 'supervisor') }
}
/** Copy the selected service's dated tariff and compatible template into a new draft. */
export function withServiceDefaults(draft: MandateDraft, data: MandateWorkspace, serviceId: string, setting?: MandateServiceSetting | null): MandateDraft {
  const service = data.services.find(item => item.id === serviceId)
  const rate = [...(service?.rates ?? [])].filter(item => item.effectiveFrom <= draft.serviceDate).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  const compatible = data.templates.filter(item => !item.serviceId || item.serviceId === serviceId)
  const template = compatible.find(item => item.id === setting?.templateId) ?? [...compatible].sort((a, b) => Number(b.serviceId === serviceId) - Number(a.serviceId === serviceId) || b.version - a.version || b.createdAt.localeCompare(a.createdAt))[0]
  return { ...draft, serviceId: service?.id ?? '', rateId: rate?.id ?? '', templateId: template?.id ?? '',
    clinicalText: withStandardClinicalConsent(template?.clinicalText ?? ''), administrativeText: withStandardAdministrativeConsent(template?.administrativeText ?? ''),
    policyId: setting?.policyId ?? [...data.policies].sort((a, b) => b.version - a.version)[0]?.id ?? '', supervisorId: setting?.supervisorId ?? null,
    overrideCents: setting?.overrideCents ?? null, overrideReason: setting?.overrideReason ?? '', signers: draft.signers.filter(signer => signer.role !== 'supervisor') }
}
export function createDraft(data: MandateWorkspace, day: string, client?: ClientAdminProjection, professionalId?: string, financialDay = currentMandateBillingDay()): MandateDraft {
  const service = orderedClinicalServices(data.services)[0] ?? data.services.find(item => item.active)
  const rate = service?.rates?.filter(item => item.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  const clientCanBeProposed = (ageAt(client?.birthDate, day) ?? -1) >= 14
  const clientName = client ? client.firstName+' '+client.lastName : ''
  const people = peopleFromClient(client)
  const payers = client ? defaultMandatePayers(client.id, client.birthDate, day, [...client.contacts, ...client.representatives,
    ...client.payers.map(person => ({ ...person, source: 'payer', relationship: person.payerType === 'self' ? 'Lui-même' : person.payerType === 'parent' ? 'Parent' : 'Organisation' }))], financialDay) : []
  for (const person of people) if (payers.some(payer => payer.personId === person.id)) person.roles = [...new Set([...person.roles, 'payer' as const])]
  if (clientCanBeProposed && people[0]) people[0] = { ...people[0], canConsent: true, canReadDocuments: true }
  const template = data.templates.filter(item => !item.serviceId || item.serviceId === service?.id).sort((a, b) => Number(b.serviceId === service?.id) - Number(a.serviceId === service?.id) || b.version - a.version || b.createdAt.localeCompare(a.createdAt))[0]
  return { serviceId: service?.id ?? '', rateId: rate?.id ?? '', serviceDate: day, overrideCents: null, overrideReason: '', templateId: template?.id ?? '', clinicalText: withStandardClinicalConsent(template?.clinicalText ?? ''), administrativeText: withStandardAdministrativeConsent(template?.administrativeText ?? ''), policyId: [...data.policies].sort((a, b) => b.version - a.version)[0]?.id ?? '',
    professionalId: professionalId ?? data.professionals[0]?.id ?? '', supervisorId: null, authorizedProfileIds: [], people, payers, signers: withProfessionalSigner([...(client&&clientCanBeProposed?[{id:crypto.randomUUID(),personId:client.id,profileId:null,name:clientName,role:'client' as const,audience:'clinical' as const,required:true}]:[]), ...payers.flatMap(payer => { const person = people.find(item => item.id === payer.personId); return person ? [{ id: crypto.randomUUID(), personId: person.id, profileId: null, name: person.name, role: 'payer' as const, audience: 'administrative' as const, required: false }] : [] })], professionalId ?? data.professionals[0]?.id ?? '', data.professionals.find(item => item.id === (professionalId ?? data.professionals[0]?.id))?.name),
    legalReview: { confirmed: false, context: '', exceptionReason: '' }, administrativeInstructions: '' }
}
/** New drafts use the file's financial allocation; saved drafts and signed revisions stay fixed. */
export function draftFromRequesterFile(draft: MandateDraft, overview: ClientOverview, professionalName?: string, financialDay = currentMandateBillingDay()): MandateDraft {
  const requesters = overview.contacts.filter(person => person.source !== 'mandate')
  const self = requesters.find(person => person.relationship === 'Lui-même')
  const fictionalEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) ? email : ''
  const minorConsentIds = requiredMinorConsentIds(overview, draft.serviceDate)
  const payers = defaultMandatePayers(overview.clientId, overview.profile.birthDate, draft.serviceDate, requesters, financialDay)
  const rolesFor = (person: ClientPerson): MandatePerson['roles'] => {
    const roles: MandatePerson['roles'] = ['contact']
    if (person.authorityVerified && (person.source === 'representative' || minorConsentIds.includes(person.id))) roles.push('representative')
    if (payers.some(payer => payer.personId === (person.relationship === 'Lui-même' ? overview.clientId : person.id))) roles.push('payer')
    return roles
  }
  const clientId = overview.clientId
  const clientName = `${overview.profile.firstName} ${overview.profile.lastName}`.trim()
  const map = (person: ClientPerson, id = person.id, roles = rolesFor(person)): MandatePerson => ({
    id, name: person.fullName, email: fictionalEmail(person.email), roles,
    authorityVerified: person.authorityVerified,
    authorityBasis: person.authorityVerified ? 'Qualité vérifiée dans la fiche du client.' : '',
    canConsent: person.consentAllowed || minorConsentIds.includes(person.id) && person.authorityVerified,
    canCommunicate: person.communicationAllowed,
    canReadDocuments: person.documentsAllowed || minorConsentIds.includes(person.id) && person.authorityVerified,
    canRepresent: (person.source === 'representative' || minorConsentIds.includes(person.id)) && person.authorityVerified,
  })
  const clientPerson = self ? map(self, clientId, ['client', ...rolesFor(self)]) : personFrom(clientId, clientName, fictionalEmail(overview.profile.email), ['client'])
  if (payers.some(payer => payer.personId === clientId)) clientPerson.roles = [...new Set([...clientPerson.roles, 'payer' as const])]
  clientPerson.name = clientName
  const people = [clientPerson, ...requesters.filter(person => person.relationship !== 'Lui-même').map(person => map(person))]
  const age = ageAt(overview.profile.birthDate, draft.serviceDate)
  const signers: MandateSigner[] = []
  if (age !== null && age >= 14) {
    clientPerson.canConsent = true
    clientPerson.canReadDocuments = true
    signers.push({ id: crypto.randomUUID(), personId: clientId, profileId: null, name: clientName, role: 'client', audience: 'clinical', required: true })
  }
  if (age !== null && age < 14) for (const person of people) if (minorConsentIds.includes(person.id) && person.authorityVerified && person.roles.includes('representative')) signers.push({ id: crypto.randomUUID(), personId: person.id, profileId: null, name: person.name, role: 'representative', audience: 'clinical', required: true })
  for (const payer of payers) { const person = people.find(item => item.id === payer.personId); if (person) signers.push({ id: crypto.randomUUID(), personId: person.id, profileId: null, name: person.name, role: 'payer', audience: 'administrative', required: false }) }
  return { ...draft, people, payers, signers: withProfessionalSigner([...signers, ...draft.signers.filter(signer => signer.profileId)], draft.professionalId, professionalName) }
}
/** Upgrade an existing editable draft without changing its payer split or historical party snapshot. */
export function withAutomaticSigners(draft: MandateDraft, overview?: ClientOverview, professionalName?: string): MandateDraft {
  if (overview && draft.people.length === 0) return draftFromRequesterFile(draft, overview, professionalName)
  const sourcePeople = overview?.contacts.filter(person => person.source !== 'mandate') ?? []
  const self = sourcePeople.find(person => person.relationship === 'Lui-même')
  const clientName = overview ? `${overview.profile.firstName} ${overview.profile.lastName}`.trim() : ''
  const oldClientId = draft.people.find(person => person.roles.includes('client'))?.id
  const currentId = (id: string | null) => overview && id === oldClientId ? overview.clientId : id
  const people = draft.people.map(person => {
    if (overview && person.roles.includes('client')) return { ...person, id: overview.clientId, name: clientName, email: self?.email || overview.profile.email }
    const source = sourcePeople.find(item => item.id === person.id)
    return source ? { ...person, name: source.fullName, email: source.email } : person
  })
  const payers = draft.payers.map(payer => ({ ...payer, personId: currentId(payer.personId)! }))
  const signers = draft.signers.filter(signer => !signer.profileId).map(signer => ({ ...signer, personId: currentId(signer.personId), name: people.find(person => person.id === currentId(signer.personId))?.name ?? signer.name, required: signer.audience === 'administrative' ? false : signer.required }))
  const age = overview ? ageAt(overview.profile.birthDate, draft.serviceDate) : null
  if (age !== null && age < 14) {
    for (let index = signers.length - 1; index >= 0; index--) if (signers[index].audience === 'clinical' && signers[index].personId === overview?.clientId) signers.splice(index, 1)
    for (const person of people) if (requiredMinorConsentIds(overview, draft.serviceDate).includes(person.id)) {
      if (person.authorityVerified && !person.roles.includes('representative')) person.roles.push('representative')
      if (!person.authorityVerified) {
        person.roles = person.roles.filter(role => role !== 'representative')
        if (!person.roles.length) person.roles = ['contact']
        person.canConsent = false; person.canRepresent = false
        for (let index = signers.length - 1; index >= 0; index--) if (signers[index].audience === 'clinical' && signers[index].personId === person.id) signers.splice(index, 1)
      }
    }
  }
  const add = (person: MandatePerson, audience: MandateSigner['audience']) => {
    if (signers.some(signer => signer.personId === person.id && signer.audience === audience)) return
    signers.push({ id: crypto.randomUUID(), personId: person.id, profileId: null, name: person.name,
      role: audience === 'administrative' ? 'payer' : person.roles.includes('client') ? 'client' : 'representative', audience, required: audience === 'clinical' })
  }
  for (const payer of payers) { const person = people.find(item => item.id === payer.personId); if (person) add(person, 'administrative') }
  if (overview && age !== null) {
    if (age >= 14) { const client = people.find(person => person.id === overview.clientId && person.roles.includes('client')); if (client) add(client, 'clinical') }
    else for (const person of people) if (requiredMinorConsentIds(overview, draft.serviceDate).includes(person.id) && person.authorityVerified && person.roles.includes('representative')) {
      add(person, 'clinical')
      const signer = signers.find(item => item.personId === person.id && item.audience === 'clinical')
      if (signer) { signer.required = true; signer.role = 'representative' }
    }
  }
  return { ...draft, people, payers, signers: withProfessionalSigner([...signers, ...draft.signers.filter(signer => signer.profileId)], draft.professionalId, professionalName) }
}
export function validateDraft(draft: MandateDraft, overview?: ClientOverview, requireClinicalConsent = true, financialDay = currentMandateBillingDay()) {
  if (!draft.payers.length && overview && ageAt(overview.profile.birthDate, draft.serviceDate) === null) throw new Error('Renseignez une date de naissance valide dans la fiche du client pour déterminer le payeur du mandat.')
  if (!draft.serviceId || !draft.rateId || !draft.templateId || !draft.policyId || !draft.professionalId) throw new Error('Choisissez service, tarif daté, gabarit, politique et professionnel.')
  if (draft.overrideCents !== null && !draft.overrideReason.trim()) throw new Error('Une exception de tarif exige un motif.')
  if (!draft.payers.length || draft.payers.reduce((sum, payer) => sum + payer.basisPoints, 0) !== 10000) throw new Error('Les parts des payeurs doivent totaliser exactement 100 %.')
  if (draft.payers.some(payer => !draft.people.some(person => person.id === payer.personId && person.roles.includes('payer')) || !Number.isSafeInteger(payer.basisPoints) || payer.basisPoints <= 0 || payer.basisPoints > 10000)
    || new Set(draft.payers.map(payer => payer.personId)).size !== draft.payers.length) throw new Error('Chaque part doit désigner explicitement une personne ayant le rôle payeur.')
  if (overview && (ageAt(overview.profile.birthDate, financialDay) ?? -1) < 14 && draft.payers.some(payer => payer.personId === overview.clientId)) throw new Error('Le client doit avoir au moins 14 ans pour participer au paiement du mandat.')
  if (!requireClinicalConsent) return
  if (!draft.signers.length) throw new Error('Ajoutez les signataires attendus du scénario fictif.')
  if (!draft.signers.some(signer => signer.audience === 'clinical' && signer.personId)) throw new Error('Choisissez au moins une personne pour signer le consentement clinique.')
  if (overview && ageAt(overview.profile.birthDate, draft.serviceDate) !== null && ageAt(overview.profile.birthDate, draft.serviceDate)! < 14) {
    if (draft.signers.some(signer => signer.audience === 'clinical' && signer.personId === overview.clientId)) throw new Error('Un client de moins de 14 ans ne peut pas signer ce consentement clinique.')
    const required = requiredMinorConsentIds(overview, draft.serviceDate)
    if (!required.length || required.some(id => !draft.signers.some(signer => signer.personId === id && signer.audience === 'clinical' && signer.required))) throw new Error('Les parents ou représentants du client mineur doivent signer le consentement clinique.')
  }
}
export function requiredSignaturesComplete(revision: { draft: { signers: MandateSigner[] }; signatures: MandateRevision['signatures'] }) {
  const required = revision.draft.signers.filter(signer => signer.required)
  return required.length > 0 && required.every(signer => revision.signatures.some(signature => signature.signerId === signer.id))
}
/** A signed clinical consent establishes the person's notes entitlement; a payer signature alone does not. */
export function hasSignedClinicalConsent(revision: Pick<MandateRevision, 'documents' | 'signatures'> & { draft: Pick<MandateDraft, 'signers'> }, personId: string): boolean {
  return revision.draft.signers.some(signer => signer.personId === personId && signer.audience === 'clinical' && revision.signatures.some(signature => signature.signerId === signer.id && revision.documents.some(document => document.id === signature.documentId && document.audience === 'clinical' && document.kind === 'convention' && document.sha256 === signature.documentHash)))
}
export function mayLocallySign(signer: MandateSigner, context: 'administration' | 'clinical', actorId: string) {
  return context === 'administration' ? !signer.profileId : !signer.profileId || signer.profileId === actorId && signer.audience === 'clinical'
}
export function documentForSigner(revision: Pick<MandateRevision, 'documents'>, signer: MandateSigner) { return revision.documents.find(document => document.audience === signer.audience && document.kind === 'convention') }
export async function confirmMandateWrite<T>(write: () => Promise<T>, refresh: () => Promise<boolean>, confirmed: () => void) {
  const ack = await write(); confirmed()
  try { return { ack, refreshed: await refresh() } } catch { return { ack, refreshed: false } }
}

export function signatureStrokes(strokes: {x:number;y:number}[][]) {
  const useful = strokes.filter(stroke => stroke.length >= 2)
  if (useful.length > 50 || useful.reduce((sum, stroke) => sum + stroke.length, 0) > 2000 || useful.some(stroke => stroke.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1))) throw new Error('Dessin hors limites. Effacez ou utilisez la signature au clavier.')
  return useful
}
export function signatureFragment(hostname: string, fragment: string): string | null {
  const values = new URLSearchParams(fragment.replace(/^#/, '')), token = values.get('token')
  return hostname === '127.0.0.1' && values.size === 1 && token && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token) ? token : null
}
