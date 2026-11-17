'use client'

import { useEffect, useRef, useState } from 'react'
import type { ClientAdminProjection } from '@/lib/clinical-core/types'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import type { MandateDraft, MandateRevision } from '@/lib/clinical-mandates/types'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { Field, MandateForm, inputClass, type MandateUi } from './primitives'
import { PeopleEditor } from './PeopleEditor'
import { centsFromInput, createDraft, draftFromRequesterFile, moneyInput, moneyLabel, validateDraft, withAutomaticSigners, withServiceDefaults, withMandateSupervisor } from './model'
import { localDateTime } from '@/lib/clinical-calendar/time'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { orderedClinicalServices } from '@/lib/clinical-mandates/serviceOrder'

export function MandateEditor({ ui, coreClients, requesterFile, clientId: initialClientId, episodeId: initialEpisodeId, revision, mandateId, embedded = false, onSaved, onEditRequesters }: { ui: MandateUi; coreClients: ClientAdminProjection[]; requesterFile?: ClientOverview; clientId?: string; episodeId?: string; revision?: MandateRevision; mandateId?: string; embedded?: boolean; onSaved?: () => void; onEditRequesters?: () => void }) {
  const day = requesterFile?.profile.assignedAt?.slice(0, 10) ?? localDateTime(new Date()).slice(0, 10)
  const [clientId, setClientId] = useState(initialClientId ?? ui.data.clients[0]?.id ?? '')
  const episodes = ui.data.episodes.filter(episode => episode.clientId === clientId && episode.status === 'open')
  const [episodeId, setEpisodeId] = useState(initialEpisodeId ?? episodes[0]?.id ?? '')
  const [draft, setDraft] = useState<MandateDraft>(() => {
    if (revision) {
      const previous = structuredClone(revision.draft)
      const template = ui.data.templates.find(item => item.id === previous.templateId)
      return withAutomaticSigners({ ...previous, clinicalText: previous.clinicalText ?? template?.clinicalText ?? '', administrativeText: previous.administrativeText ?? template?.administrativeText ?? '' }, requesterFile, ui.data.professionals.find(item => item.id === previous.professionalId)?.name)
    }
    const initial = createDraft(ui.data, day, coreClients.find(client => client.id === clientId), ui.data.episodes.find(episode => episode.id === episodeId)?.professionalIds[0])
    const withRequesters = requesterFile?.clientId === clientId ? draftFromRequesterFile(initial, requesterFile, ui.data.professionals.find(item => item.id === initial.professionalId)?.name) : initial
    return { ...withRequesters, authorizedProfileIds: withRequesters.professionalId ? [withRequesters.professionalId] : [] }
  })
  const [page, setPage] = useState<1 | 2>(1), pageRef = useRef<HTMLElement>(null)
  const [supervised, setSupervised] = useState(Boolean(draft.supervisorId))
  useEffect(() => { if (draft.supervisorId) setSupervised(true) }, [draft.supervisorId])
  const appliedServiceDefaults = useRef('')
  const serviceSettingsFor = useRef('')
  const [serviceSettings, setServiceSettings] = useState<{ id: string; setting: { enabled: boolean; overrideCents: number | null; overrideReason: string; supervisorId: string | null; templateId: string | null; policyId: string | null } | null }[] | null>(null)
  useEffect(() => {
    if (revision || !draft.professionalId) return
    const controller = new AbortController()
    appliedServiceDefaults.current = ''
    serviceSettingsFor.current = ''
    setServiceSettings(null)
    void clinicalRequest<{ services: typeof serviceSettings }>({ actorId: ui.data.actor.id, context: 'administration' }, `/professionals/${draft.professionalId}/services`, undefined, 'GET', controller.signal)
      .then(value => { if (!controller.signal.aborted) { serviceSettingsFor.current = draft.professionalId; setServiceSettings(value.services) } })
      .catch(() => { if (!controller.signal.aborted) { serviceSettingsFor.current = draft.professionalId; setServiceSettings([]) } })
    return () => controller.abort()
  }, [draft.professionalId, revision, ui.data.actor.id])
  useEffect(() => {
    if (revision || !serviceSettings || serviceSettingsFor.current !== draft.professionalId) return
    const allowed = serviceSettings.filter(item => item.setting?.enabled)
    const defaultsKey = `${draft.professionalId}/${clientId}/${episodeId}`
    if (appliedServiceDefaults.current === defaultsKey) return
    appliedServiceDefaults.current = defaultsKey
    const selected = allowed.find(item => item.id === draft.serviceId) ?? allowed[0]
    setDraft(previous => withServiceDefaults(previous, ui.data, selected?.id ?? '', selected?.setting))
  }, [serviceSettings, revision, draft.serviceId, draft.professionalId, clientId, episodeId, ui.data])
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ draft, clientId, episodeId }))
  const dirty = JSON.stringify({ draft, clientId, episodeId }) !== savedSnapshot
  const guard = useClinicalFormGuard(dirty, ui.busy)
  const update = <K extends keyof MandateDraft>(key: K, value: MandateDraft[K]) => setDraft(previous => key === 'supervisorId' ? withMandateSupervisor(previous, value as string | null) : ({ ...previous, [key]: value }))
  const service = ui.data.services.find(item => item.id === draft.serviceId), rates = service?.rates?.filter(rate => rate.effectiveFrom <= draft.serviceDate) ?? []
  const referenceRate = rates.find(rate => rate.id === draft.rateId) ?? [...rates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  const template = ui.data.templates.find(item => item.id === draft.templateId)
  return <section ref={pageRef} className="rounded-2xl border border-[#d8b992] bg-[#fffaf3] p-4 sm:p-5"><h3 className="mb-3 text-lg font-semibold">{revision ? 'Modifier le mandat' : 'Créer un mandat'}</h3>
    <MandateForm trackChanges={false} disabled={ui.busy} submitLabel={revision ? 'Enregistrer' : 'Créer le mandat'} onSave={async () => {
      if (!clientId || !episodeId) throw new Error('Choisissez le client permanent et son épisode ouvert.')
      if (supervised && !draft.supervisorId) throw new Error('Choisissez un superviseur habilité.')
      validateDraft(draft, requesterFile, false)
      const ack = revision && mandateId ? await ui.command({ action: 'mandate.update', data: { mandateId, revisionId: revision.id, expectedVersion: revision.version, draft } }) : await ui.command({ action: 'mandate.create', data: { clientId, episodeId, draft } })
      // Keep an unsigned mandate editable. The signing action freezes its PDF.
      guard.markSaved(); setSavedSnapshot(JSON.stringify({ draft, clientId, episodeId }))
      return () => { onSaved?.(); return ui.select({ mandate: ack.id, client: clientId, episode: episodeId, new: null }) }
    }}>
      {page === 1 ? <>
      <div className="grid gap-3 sm:grid-cols-2">
        {!embedded&&<Field label="Client"><select className={inputClass} required disabled={Boolean(revision)} value={clientId} onChange={event => {
          const id = event.target.value
          if (dirty && !window.confirm('Changer de client réinitialise ce brouillon non enregistré. Continuer ?')) return
          const episode = ui.data.episodes.find(item => item.clientId === id && item.status === 'open')
          setClientId(id); setEpisodeId(episode?.id ?? ''); setDraft(createDraft(ui.data, day, coreClients.find(client => client.id === id), episode?.professionalIds[0]))
        }}>{ui.data.clients.map(client => <option key={client.id} value={client.id}>{client.name} · {client.id.slice(-6)}</option>)}</select></Field>}
        {!embedded&&<Field label="Dossier de service"><select className={inputClass} required disabled={Boolean(revision)} value={episodeId} onChange={event => { setEpisodeId(event.target.value); const episode = episodes.find(item => item.id === event.target.value); if (episode?.professionalIds[0]) update('professionalId', episode.professionalIds[0]) }}><option value="">Choisir…</option>{episodes.map(episode => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></Field>}
        <Field label="Type de mandat"><select className={inputClass} required disabled={ui.data.context === 'clinical'} value={draft.serviceId} onChange={event => { const item = ui.data.services.find(service => service.id === event.target.value), setting = serviceSettings?.find(row => row.id === item?.id)?.setting; setDraft(previous => withServiceDefaults(previous, ui.data, item?.id ?? '', setting)) }}>{[...orderedClinicalServices(ui.data.services).filter(item => revision || serviceSettings?.some(row => row.id === item.id && row.setting?.enabled)), ...(revision ? ui.data.services.filter(item => item.id === draft.serviceId && !item.active) : [])].map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{!revision && serviceSettings?.length === 0 && <span className="text-sm text-red-800">Aucun service autorisé pour ce professionnel.</span>}</Field>
        <Field label="Date de début"><input className={inputClass} type="date" required value={draft.serviceDate} readOnly={Boolean(!revision && requesterFile?.profile.assignedAt)} onChange={event => { const serviceDate = event.target.value; setDraft(previous => ({ ...previous, serviceDate, rateId: [...(service?.rates ?? [])].filter(rate => rate.effectiveFrom <= serviceDate).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.id ?? '' })) }} /></Field>
        <Field label="Tarif applicable"><select className={inputClass} value={draft.overrideCents === null ? 'reference' : 'custom'} disabled={!referenceRate} onChange={event => setDraft(previous => ({ ...previous, rateId: referenceRate?.id ?? previous.rateId, overrideCents: event.target.value === 'custom' ? (previous.overrideCents ?? referenceRate?.amountCents ?? null) : null, overrideReason: event.target.value === 'custom' ? 'Tarif particulier convenu pour ce mandat' : '' }))}><option value="reference">{referenceRate ? `${moneyLabel(referenceRate.amountCents)} / ${referenceRate.unit === 'hour' ? 'heure' : 'séance'}` : 'Aucun tarif disponible'}</option><option value="custom">Autre tarif</option></select></Field>
        {draft.overrideCents !== null && <Field label="Autre tarif (montant)"><input className={inputClass} type="number" min="0.01" max="100000" step="0.01" required value={moneyInput(draft.overrideCents)} onChange={event => update('overrideCents', event.target.value ? centsFromInput(event.target.value) : null)} /></Field>}
        {ui.data.context === 'administration' ? <Field label="Professionnel prestataire"><select className={inputClass} required value={draft.professionalId} onChange={event => setDraft(previous => ({ ...previous, professionalId: event.target.value, ...(!revision ? { authorizedProfileIds: [event.target.value] } : {}) }))}>{ui.data.professionals.map(pro => <option key={pro.id} value={pro.id}>{pro.name}</option>)}</select></Field> : <p className="text-sm"><strong>Professionnel prestataire :</strong> {ui.data.professionals.find(pro => pro.id === draft.professionalId)?.name ?? 'À préciser'}</p>}
        <fieldset><legend className="mb-1 text-sm font-medium">Supervisé</legend><div className="flex gap-2"><button type="button" aria-pressed={supervised} className={supervised ? 'rounded-lg bg-[#8a5633] px-3 py-2 text-sm text-white' : 'rounded-lg border px-3 py-2 text-sm'} onClick={() => setSupervised(true)}>Oui</button><button type="button" aria-pressed={!supervised} className={!supervised ? 'rounded-lg bg-[#8a5633] px-3 py-2 text-sm text-white' : 'rounded-lg border px-3 py-2 text-sm'} onClick={() => { setSupervised(false); update('supervisorId', null) }}>Non</button></div></fieldset>
        {supervised && <Field label="Superviseur"><select className={inputClass} required value={draft.supervisorId ?? ''} onChange={event => update('supervisorId', event.target.value || null)}><option value="">Choisir…</option>{ui.data.professionals.filter(pro => pro.canSupervise && pro.id !== draft.professionalId).map(pro => <option key={pro.id} value={pro.id}>{pro.name}</option>)}</select></Field>}
      </div>
      <PeopleEditor draft={draft} requesterFile={requesterFile} onChange={setDraft} onEditRequesters={onEditRequesters} />
      <div className="mt-4"><Field label="Conditions et modalités de la convention"><textarea className={inputClass + ' min-h-40'} required maxLength={20000} rows={7} value={draft.administrativeText ?? ''} onChange={event => update('administrativeText', event.target.value)} /></Field></div>
      </> : <div className="grid gap-4"><h4 className="font-semibold">Consentement clinique</h4><p className="text-sm">Texte propre à ce mandat. Le modèle « {template?.title ?? 'À préciser'} » sert de point de départ; toute modification reste dans cette version et son PDF.</p><Field label="Texte du consentement"><textarea className={inputClass + ' min-h-80'} required maxLength={20000} rows={18} value={draft.clinicalText ?? ''} onChange={event => update('clinicalText', event.target.value)} /></Field></div>}
      <div className="mt-4 flex justify-end"><button type="button" className="text-sm font-semibold text-[#8a5633] underline underline-offset-2" onClick={() => { setPage(previous => previous === 1 ? 2 : 1); requestAnimationFrame(() => pageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }}>{page === 1 ? '2ème page : consentement' : '1ère page : données du mandat'}</button></div>
    </MandateForm>
  </section>
}
