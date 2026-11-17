'use client'

import type { MandateDraft, MandatePerson, MandateSigner } from '@/lib/clinical-mandates/types'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { Field, inputClass } from './primitives'
import { ageAt, requiredMinorConsentIds } from './model'

type Role = MandatePerson['roles'][number]

function splitPayers(ids: string[]) {
  const base = Math.floor(10000 / ids.length)
  return ids.map((personId, index) => ({ personId, basisPoints: base + (index === 0 ? 10000 - base * ids.length : 0) }))
}

function signerFor(person: MandatePerson, audience: MandateSigner['audience']): MandateSigner {
  return { id: crypto.randomUUID(), personId: person.id, profileId: null, name: person.name,
    role: audience === 'administrative' ? 'payer' : person.roles.includes('client') ? 'client' : 'representative', audience, required: audience === 'clinical' }
}

export function PeopleEditor({ draft, requesterFile, onChange, onEditRequesters }: { draft: MandateDraft; requesterFile?: ClientOverview; onChange: (draft: MandateDraft) => void; onEditRequesters?: () => void }) {
  const minor = requesterFile && ageAt(requesterFile.profile.birthDate, draft.serviceDate) !== null && ageAt(requesterFile.profile.birthDate, draft.serviceDate)! < 14
  const requiredParentIds = requiredMinorConsentIds(requesterFile, draft.serviceDate).filter(id => draft.people.some(person => person.id === id && person.authorityVerified))
  const totalPayerPoints = draft.payers.reduce((total, payer) => total + payer.basisPoints, 0)
  const changeMandateIdentity = (person: MandatePerson, field: 'name' | 'email', value: string) => onChange({
    ...draft,
    people: draft.people.map(item => item.id === person.id ? { ...item, [field]: value } : item),
    signers: field === 'name' ? draft.signers.map(signer => signer.personId === person.id ? { ...signer, name: value } : signer) : draft.signers,
  })
  const setRole = (person: MandatePerson, role: Role, checked: boolean) => {
    const roles = checked ? [...new Set([...person.roles, role])] : person.roles.filter(item => item !== role)
    if (!roles.length) return
    const updated = { ...person, roles: checked && role === 'contact' ? [...new Set([...roles, 'representative' as const])] : roles }
    const people = draft.people.map(item => item.id === person.id ? updated : item)
    const payerIds = people.filter(item => item.roles.includes('payer')).map(item => item.id)
    const payers = role === 'payer' ? payerIds.length ? splitPayers(payerIds) : [] : draft.payers
    let signers = draft.signers.filter(signer => signer.personId !== person.id || signer.audience !== (role === 'payer' ? 'administrative' : 'clinical'))
    if (checked && (role === 'payer' || role === 'representative' || role === 'contact')) signers = [...signers, signerFor(updated, role === 'payer' ? 'administrative' : 'clinical')]
    onChange({ ...draft, people, payers, signers })
  }
  const toggleClinicalSigner = (person: MandatePerson, checked: boolean) => {
    if (minor && (person.id === requesterFile?.clientId || requiredParentIds.includes(person.id))) return
    const signers = draft.signers.filter(signer => signer.personId !== person.id || signer.audience !== 'clinical')
    const updated = checked && !person.roles.includes('client') && !person.roles.includes('representative') ? { ...person, roles: [...person.roles, 'representative' as const] } : person
    onChange({ ...draft, people: draft.people.map(item => item.id === person.id ? updated : item), signers: checked ? [...signers, signerFor(updated, 'clinical')] : signers })
  }
  return <section className="grid gap-4 rounded-xl border border-[#eadfd2] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Requérants et signatures</h4>{onEditRequesters && <button type="button" className="text-sm font-semibold text-[#795b80] underline underline-offset-2" onClick={onEditRequesters}>Modifier les requérants</button>}</div>
    <p role="status" className={'text-sm ' + (totalPayerPoints > 10000 ? 'font-semibold text-red-700' : 'text-[#7a6859]')}>Répartition des honoraires : {(totalPayerPoints / 100).toLocaleString('fr-CA')} % sur 100 %.</p>
    {draft.people.map(person => {
      const share = draft.payers.find(payer => payer.personId === person.id)
      const clinicalSigner = draft.signers.some(signer => signer.personId === person.id && signer.audience === 'clinical')
      const mandateOnly = Boolean(requesterFile) && person.id !== requesterFile?.clientId && !requesterFile?.contacts.some(source => source.source !== 'mandate' && source.id === person.id)
      return <div key={person.id} className="rounded-xl border border-[#eadfd2] p-3">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Nom"><input className={inputClass} value={person.name} readOnly={!mandateOnly} required={mandateOnly} maxLength={200} onChange={event => changeMandateIdentity(person, 'name', event.target.value)} /></Field><Field label="Courriel"><input className={inputClass} type="email" value={person.email} readOnly={!mandateOnly} maxLength={254} onChange={event => changeMandateIdentity(person, 'email', event.target.value)} /></Field></div>
        <fieldset className="mt-3"><legend className="text-sm font-semibold">Rôle dans le mandat</legend><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">{([
          ['client', 'Client'], ['contact', 'Parent / tuteur légal'], ['representative', 'Représentant'], ['payer', 'Responsable des honoraires'],
        ] as const).map(([role, label]) => <label key={role} className="flex items-center gap-2"><input type="checkbox" checked={person.roles.includes(role)} disabled={role === 'client'} onChange={event => setRole(person, role, event.target.checked)} />{label}</label>)}</div></fieldset>
        {share && <Field label="Part des honoraires (%)"><input className={inputClass + ' mt-2 max-w-40'} type="number" min="0.01" max="100" step="0.01" required value={share.basisPoints / 100} onChange={event => onChange({ ...draft, payers: draft.payers.map(item => item.personId === person.id ? { ...item, basisPoints: Math.round(Number(event.target.value) * 100) } : item) })} /></Field>}
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={minor && person.id === requesterFile?.clientId ? false : minor && requiredParentIds.includes(person.id) ? true : clinicalSigner} disabled={Boolean(minor && (person.id === requesterFile?.clientId || requiredParentIds.includes(person.id)))} onChange={event => toggleClinicalSigner(person, event.target.checked)} />Signer le consentement clinique{minor && requiredParentIds.includes(person.id) ? ' · requis pour le parent ou représentant' : ''}</label>
        {share && <p className="mt-2 text-xs text-[#7a6859]">Responsable des honoraires · signature administrative facultative.</p>}
      </div>
    })}
  </section>
}
