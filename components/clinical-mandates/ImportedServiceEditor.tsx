'use client'
import { useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import type { ImportedServiceCase } from '@/lib/clinical-mandates/importService'
import { localDateTime } from '@/lib/clinical-calendar/time'
import { orderedClinicalServices } from '@/lib/clinical-mandates/serviceOrder'
import { Field, inputClass } from './primitives'

/** Completes the imported episode through the ordinary mandate engine. */
export function ImportedServiceEditor({ item, clientId, actor, onSaved, onEditProfile, onEditRequesters, onDenied }: {
  item: ImportedServiceCase; clientId: string; actor: ClinicalActorInput; onSaved: () => Promise<void>
  onEditProfile?: () => void; onEditRequesters?: () => void; onDenied: () => void
}) {
  const [initialDay] = useState(() => localDateTime(new Date()).slice(0, 10))
  const [service, setService] = useState(item.serviceId ?? ''), [day, setDay] = useState(initialDay)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), writing = useRef(false)
  const guard = useClinicalFormGuard(service !== (item.serviceId ?? '') || day !== initialDay, busy)
  async function save() {
    if (writing.current || !service || !day) return
    writing.current = true; setBusy(true); setError(''); guard.markPending()
    try {
      await clinicalRequest(actor, `/clients/${clientId}/import-service`, { caseId: item.caseId, revisionId: item.revisionId,
        expectedVersion: item.version, serviceId: service, serviceDate: day }, 'POST')
      guard.markSaved(); guard.markSettled(); await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le service n’a pas pu être enregistré.')
      if (isClinicalAccessDenied(cause)) onDenied()
    } finally { writing.current = false; setBusy(false); guard.markSettled() }
  }
  return <section className="grid gap-3 rounded-xl border border-[#eadfd2] bg-[#fffaf3] p-4">
    <h3 className="font-semibold">Compléter le mandat du dossier importé</h3>
    <p className="text-sm">{item.label} · Choisissez le service. Les tarifs, la convention et les payeurs seront repris des paramètres et de la fiche client.</p>
    <Field label="Service"><select className={inputClass} value={service} disabled={busy} onChange={e => setService(e.target.value)}>
      <option value="">Choisir le service…</option>{orderedClinicalServices(item.services.map(s => ({ ...s, active: true, kind: 'clinical' as const }))).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select></Field>
    {!item.services.length && <p role="status" className="text-sm">Aucun service autorisé pour ce professionnel. La direction peut les configurer dans ses préférences.</p>}
    <Field label="Date de début du mandat"><input type="date" className={inputClass} value={day} disabled={busy} onChange={e => setDay(e.target.value)} /></Field>
    {item.prerequisite === 'identity' && <div className="text-sm"><p>Le service peut être enregistré dès maintenant. Complétez ensuite la date de naissance dans la fiche client pour préparer le mandat et déterminer le payeur.</p>{onEditProfile && <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onEditProfile}>Compléter la fiche client</button>}</div>}
    {item.prerequisite === 'payer' && <div className="text-sm"><p>Le service peut être enregistré dès maintenant. Ajoutez le responsable de facturation et vérifiez que la répartition atteint 100 %.</p>{onEditRequesters && <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onEditRequesters}>Compléter les payeurs</button>}</div>}
    {item.serviceId && <p role="status" className="text-sm text-green-800">Service enregistré. {item.prerequisite ? 'Complétez les renseignements indiqués pour préparer le mandat.' : 'Vous pouvez préparer le mandat.'}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <button type="button" className={buttonClass('primary')+' justify-self-start'} disabled={busy || !service || !day} onClick={() => void save()}>{busy ? 'Enregistrement…' : item.prerequisite ? 'Enregistrer le service' : 'Préparer le mandat'}</button>
  </section>
}
