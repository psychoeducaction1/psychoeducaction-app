'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { runMandateCommand } from '@/lib/clinical-mandates/client'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'

type Rate = { id: string; effectiveFrom: string; amountCents: number; unit: 'hour' | 'session' | 'km'; referenceMinutes: number | null }
type Setting = { version: number; enabled: boolean; supervisorId: string | null; overrideCents: number | null; overrideReason: string; templateId: string | null; policyId: string | null; createdAt: string }
type Service = { id: string; label: string; active: boolean; version: number; rates: Rate[]; setting: Setting | null }
type Data = { services: Service[]; templates: { id: string; serviceId: string | null; title: string; version: number }[]; policies: { id: string; label: string; version: number }[]; supervisors: { id: string; name: string }[]; mandates: { id: string; serviceId: string; overrideCents: number | null; overrideReason: string; serviceDate: string; status: string }[] }
const money = (cents: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

export function ProfessionalServicesPanel({ professionalId, actorId, onOpenMandates }: { professionalId: string; actorId: string; onOpenMandates: () => void }) {
  const actor = useMemo(() => ({ actorId, context: 'administration' as const }), [actorId])
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    const result = await clinicalRequest<Data>(actor, `/professionals/${professionalId}/services`)
    setData(result)
  }, [actor, professionalId])
  useEffect(() => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : 'Services indisponibles.')) }, [reload])
  return <section className={clinicalCard}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Services individuels</h3><button className={buttonClass('secondary')} onClick={onOpenMandates}>Ouvrir les mandats</button></div>
    <p className="mt-2 text-sm">Services et tarifs issus du catalogue central. Une exception est copiée dans chaque nouveau mandat et les conventions déjà signées restent inchangées.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {!data && !error && <p className="mt-3 text-sm">Chargement…</p>}
    <div className="mt-4 grid gap-4">{data?.services.filter(service => service.active).map(service => <details key={service.id} className="rounded-xl border p-3">
      <summary className="cursor-pointer font-semibold">{service.label} · {service.setting?.enabled ? 'Autorisé' : 'Non autorisé'}</summary>
      <form key={`${service.id}:${service.setting?.version ?? 0}`} className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget)
        setBusy(true); setError('')
        try { await clinicalRequest(actor, `/professionals/${professionalId}/services/commands`, { data: {
          serviceId: service.id, expectedVersion: service.setting?.version ?? 0, enabled: form.get('enabled') === 'on',
          supervisorId: form.get('supervisorId') || null, overrideCents: form.get('override') ? Math.round(Number(form.get('override')) * 100) : null,
          overrideReason: String(form.get('overrideReason') ?? ''), templateId: form.get('templateId') || null, policyId: form.get('policyId') || null,
        } }, 'POST'); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.') } finally { setBusy(false) }
      }}>
        <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={service.setting?.enabled ?? false} />Autoriser ce service pour les nouveaux mandats</label>
        <label className={clinicalLabel}>Superviseur par défaut<select name="supervisorId" className={clinicalInput} defaultValue={service.setting?.supervisorId ?? ''}><option value="">Aucun</option>{data.supervisors.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className={clinicalLabel}>Gabarit de mandat<select name="templateId" className={clinicalInput} defaultValue={service.setting?.templateId ?? ''}><option value="">Gabarit du catalogue</option>{data.templates.filter(item => !item.serviceId || item.serviceId === service.id).map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label>
        <label className={clinicalLabel}>Politique<select name="policyId" className={clinicalInput} defaultValue={service.setting?.policyId ?? ''}><option value="">Politique courante</option>{data.policies.map(item => <option key={item.id} value={item.id}>{item.label} · v{item.version}</option>)}</select></label>
        <label className={clinicalLabel}>Exception de tarif (CAD)<input name="override" type="number" min="0.01" max="100000" step="0.01" className={clinicalInput} defaultValue={service.setting?.overrideCents != null ? (service.setting.overrideCents / 100).toFixed(2) : ''} /></label>
        <label className={clinicalLabel}>Motif de l’exception<textarea name="overrideReason" maxLength={1000} className={clinicalInput} defaultValue={service.setting?.overrideReason ?? ''} /></label>
        <button className={buttonClass('primary') + ' justify-self-start'} disabled={busy}>Enregistrer les paramètres</button>
      </form>
      <div className="mt-4 text-sm"><h4 className="font-semibold">Tarifs de référence datés</h4><ul>{service.rates.map(rate => <li key={rate.id}>{rate.effectiveFrom} · {money(rate.amountCents)} / {rate.unit === 'hour' ? 'heure' : rate.unit === 'km' ? 'km' : 'séance'}</li>)}</ul></div>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget)
        setBusy(true); setError('')
        try { await runMandateCommand(actor, { action: 'rate.add', data: { serviceId: service.id, expectedVersion: service.version, effectiveFrom: String(form.get('effectiveFrom')), amountCents: Math.round(Number(form.get('amount')) * 100), unit: 'hour', referenceMinutes: 60 } }); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tarif non enregistré.') } finally { setBusy(false) }
      }}><label className={clinicalLabel}>Date d’effet<input name="effectiveFrom" type="date" required className={clinicalInput} /></label><label className={clinicalLabel}>Nouveau tarif horaire (CAD)<input name="amount" type="number" min="0.01" max="100000" step="0.01" required className={clinicalInput} /></label><button className={buttonClass('secondary')} disabled={busy}>Ajouter au catalogue</button></form>
      <p className="mt-4 text-sm">Mandats existants : {data.mandates.filter(item => item.serviceId === service.id).length}</p>
    </details>)}</div>
  </section>
}
