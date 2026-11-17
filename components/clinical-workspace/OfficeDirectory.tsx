'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'

type Office = { id: string; name: string; color: string; active: boolean; officeNumber: string; address: string; city: string; province: string; postalCode: string; version: number }
type OfficeList = { offices: Office[] }

export function OfficeDirectory({ workspace, onNavigate }: { workspace: WorkspaceView; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void> }) {
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const [offices, setOffices] = useState<Office[]>([]), [editing, setEditing] = useState<Office | 'new' | null>(null)
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try { const list = await clinicalRequest<OfficeList>(actor, '/professionals/offices', undefined, 'GET', signal)
      if (!signal?.aborted) { setOffices(list.offices); setError('') }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Bureaux indisponibles.') }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [actor])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !editing) return
    const form = new FormData(event.currentTarget), name = String(form.get('name') ?? ''), color = String(form.get('color') ?? ''), active = form.has('active')
    const details = { officeNumber: String(form.get('officeNumber') ?? ''), address: String(form.get('address') ?? ''), city: String(form.get('city') ?? ''), province: String(form.get('province') ?? ''), postalCode: String(form.get('postalCode') ?? '') }
    setBusy(true); setError(''); setMessage('')
    try {
      await clinicalRequest(actor, '/professionals/offices/commands', { officeId: editing === 'new' ? null : editing.id, data: { ...(editing === 'new' ? {} : { expectedVersion: editing.version }), name, color, active, ...details } }, 'POST')
      setEditing(null); setMessage('Bureau enregistré. Attribuez-le ensuite depuis une fiche professionnelle.'); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement non confirmé.'); await load() }
    finally { setBusy(false) }
  }
  const filtered = offices.filter(office => `${office.name} ${office.officeNumber} ${office.city} ${office.address}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  return <div className="grid gap-4"><section className={clinicalCard}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Bureaux partagés</h2><p className="mt-1 text-sm text-[#7a6859]">Répertoire central · aucune attribution automatique</p></div><div className="flex gap-2"><button className={buttonClass('secondary')} onClick={() => void onNavigate('offices', { tab: 'calendar' })}>Voir le calendrier</button><button className={buttonClass('primary')} onClick={() => setEditing('new')}>Ajouter un bureau</button></div></div><label className={clinicalLabel + ' mt-5'}>Rechercher un bureau<input type="search" value={search} onChange={event => setSearch(event.target.value)} className={clinicalInput} /></label>{loading && <p role="status" className="mt-3 text-sm">Chargement…</p>}{error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">Nom</th><th>Numéro</th><th>Adresse</th><th>Statut</th><th>Action</th></tr></thead><tbody>{filtered.map(office => <tr className="border-b" key={office.id}><td className="p-3"><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: office.color }} />{office.name}</td><td>{office.officeNumber || '—'}</td><td>{[office.address, office.city, office.province, office.postalCode].filter(Boolean).join(', ') || '—'}</td><td>{office.active ? 'Actif' : 'Archivé'}</td><td><button className={buttonClass('ghost')} onClick={() => setEditing(office)}>Modifier</button></td></tr>)}</tbody></table>{!filtered.length && <p className="p-3 text-sm">Aucun bureau.</p>}</div></section>
    {editing && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"><form className="my-6 w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onSubmit={event => void save(event)}><h3 className="text-lg font-semibold">{editing === 'new' ? 'Ajouter un bureau' : 'Modifier le bureau'}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{([['name', 'Nom', 120], ['officeNumber', 'Numéro', 30], ['address', 'Adresse', 300], ['city', 'Ville', 100], ['province', 'Province', 100], ['postalCode', 'Code postal', 20]] as const).map(([name, label, max]) => <label className={clinicalLabel} key={name}>{label}<input name={name} required={name === 'name'} maxLength={max} defaultValue={editing === 'new' ? '' : editing[name]} className={clinicalInput} /></label>)}<label className={clinicalLabel}>Couleur<input name="color" type="color" defaultValue={editing === 'new' ? '#8a5633' : editing.color} className={clinicalInput + ' h-12'} /></label></div><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={editing === 'new' || editing.active} />Actif pour les nouvelles réservations</label><div className="mt-5 flex gap-2"><button className={buttonClass('primary')} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className={buttonClass('secondary')} onClick={() => setEditing(null)}>Annuler</button></div></form></div>}
  </div>
}
