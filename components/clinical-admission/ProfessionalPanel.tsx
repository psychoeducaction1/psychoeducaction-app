'use client'

import { assignmentEncounterMessage, isAssignmentEncounterFailure } from '@/lib/clinical-admission/outcomeErrors'
import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { admissionNotificationStatusLabel } from '@/lib/clinical-admission/notificationStatus'
import { Badge, buttonClass } from '@/components/Ui'
import { ProfessionalPreferencesEditor } from '@/components/ProfessionalPreferencesEditor'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { getAssignedClientStatusMeta, getNonServiceReasonError } from '@/app/professionnel/shared'
import { SERVICE_APPOINTMENT_MODALITIES, validateServiceAppointmentInput } from '@/lib/serviceAppointment'
import { dateTimeInputToUtcInToronto } from '@/lib/publicIntakeSchedule'
import type { AdmissionAssignment, AdmissionProfessional, ProfessionalCapacityRequest } from '@/lib/clinical-admission/types'
import type { ProfessionalStructuredPreferences } from '@/lib/professionalPreferences'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { isAdministrativeAssignmentProcessed, isProfessionalAssignmentHistory } from '@/lib/clinical-admission/assignments'
import { capacityRequestProgress, capacityRequestStatus, isCapacityRequestPending, isCapacityRequestToFill } from './presentation'
import { ActionForm, AdmissionHistory, Details, Fold, Pager, Search, dateTime, pageRows, panelClass, text, type AdmissionUi } from './shared'
import { AssignmentEmailFlow } from './AssignmentEmailFlow'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { ProfessionalClientsPanel } from './ProfessionalClientsPanel'
import { RequestHistoryCard } from '@/components/RequestHistoryCard'
import { assignmentRequestComment } from '@/lib/assignmentRequestComment'
import { AssignmentRequestComment } from '@/components/AssignmentRequestComment'
import { AdministrativeCapacityPanel } from './AdministrativeCapacityPanel'

export function ProfessionalPanel({ workspace, ui, section, accessibleClientIds, professionalId, embedded = false }: { workspace: WorkspaceView; ui: AdmissionUi; section: WorkspaceSection; accessibleClientIds: string[]; professionalId?: string; embedded?: boolean }) {
  const selectedDetailRef = useRef<HTMLDivElement>(null)
  const scrollToSelectedDetail = useCallback(() => {
    const detail = selectedDetailRef.current
    detail?.focus({ preventScroll: true })
    detail?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }, [])
  const administrative = ui.data.context === 'administration', professionals = ui.data.professionals.filter(item => item.isActive && item.canPractice)
  const targetProfessionalId = administrative ? professionalId ?? ui.query.get('pro') : null
  const chosen = administrative ? ui.data.professionals.find(item => item.id === targetProfessionalId) ?? (professionalId ? undefined : professionals[0]) : professionals.find(item => item.id === ui.data.actorId)
  const requestProfessionalId = administrative ? targetProfessionalId ?? chosen?.id : chosen?.id
  const unifiedClients = (section === 'clients' || section === 'assignments') && (Boolean(professionalId) || !administrative)
  const search = (ui.query.get('recherche') ?? '').toLocaleLowerCase('fr')
  const requests = ui.data.capacityRequests.filter(item => targetProfessionalId ? item.professionalId === targetProfessionalId : !chosen || item.professionalId === chosen.id)
  const history = section === 'admission-history' || ui.query.get(embedded ? 'assignmentView' : 'tab') === 'history'
  const assignments = ui.data.assignments.filter(item => (administrative ? isAdministrativeAssignmentProcessed(item) : isProfessionalAssignmentHistory(item, ui.data.capacityRequests)) === history && (!administrative || !targetProfessionalId || item.professionalId === targetProfessionalId) && (!ui.query.get('admission') || item.admissionId === ui.query.get('admission')) && [item.clientSnapshot.firstName, item.clientSnapshot.lastName, item.clientSnapshot.consultationReason].join(' ').toLocaleLowerCase('fr').includes(search))
  const selected = assignments.find(item => item.id === ui.query.get('assignment'))
  useEffect(() => {
    if (!embedded || !selected?.id) return
    const frame = requestAnimationFrame(scrollToSelectedDetail)
    return () => cancelAnimationFrame(frame)
  }, [embedded, selected?.id, scrollToSelectedDetail])
  const requestNotices = administrative && section === 'requests'
    ? [...new Map(ui.data.notifications.filter(item => item.capacityRequestId && (!targetProfessionalId || ui.data.capacityRequests.some(request => request.id === item.capacityRequestId && request.professionalId === targetProfessionalId))).map(item => [item.id, item])).values()]
    : []
  const historicalRequestNotices = requestNotices.some(item => item.status === 'recorded' || item.status === 'skipped')
  if (unifiedClients && chosen) return <ProfessionalClientsPanel ui={ui} workspace={workspace} professionalId={chosen.id} initialView={section === 'assignments' ? 'assignments' : 'clients'} />
  return <div className="grid gap-5">
    {requestNotices.length > 0 && <Fold title={`Avis administratifs${historicalRequestNotices ? '' : ' simulés'} (${requestNotices.length})`}><p className="mb-3 text-sm">{historicalRequestNotices ? 'Historique des courriels liés aux demandes. Le statut indique ce que le journal a conservé.' : clinicalUiText("Ces avis sont des copies internes des courriels liés aux demandes. Dans le laboratoire, aucun message réel n’est envoyé.","Ces avis sont des copies internes des courriels liés aux demandes. Consultez leur statut pour connaître le résultat des envois.")}</p><div className="grid gap-2">{[...requestNotices].reverse().map(item => <div key={item.id} className="rounded-xl border border-[#eadfd2] p-3 text-sm"><p className="font-semibold">{item.subject} · {dateTime(item.createdAt)}{historicalRequestNotices ? ' · ' + admissionNotificationStatusLabel(item.status) : ''}</p><p className="mt-1 whitespace-pre-wrap">{item.body}</p></div>)}</div></Fold>}
    {administrative && section === 'requests' && !professionalId && <section className={panelClass}><h2 className="mb-3 text-xl font-semibold">Propositions de disponibilités à combler</h2><div className="grid gap-3">{ui.data.capacityRequests.filter(item => item.offerSlots?.length && isCapacityRequestToFill(item)).map(item => <div key={item.id}><p className="mb-1 font-semibold">{ui.data.professionals.find(pro => pro.id === item.professionalId)?.displayName ?? 'Professionnel'}</p><RequestSummary item={item} assignments={ui.data.assignments} /><button type="button" className={buttonClass('secondary') + ' mt-2'} onClick={() => void ui.select({ pro: item.professionalId })}>Voir la demande du professionnel</button></div>)}{!ui.data.capacityRequests.some(item => item.offerSlots?.length && isCapacityRequestToFill(item)) && <p className="text-sm">Aucune proposition de calendrier à combler.</p>}</div></section>}
    {administrative && !professionalId && <label className={clinicalLabel}>Professionnel à administrer<select className={clinicalInput} value={ui.query.get('pro') ?? (['requests', 'preferences'].includes(section) ? chosen?.id ?? '' : '')} onChange={event => void ui.select({ pro: event.target.value || null, page: null })}><option value="">Tous / choisir</option>{professionals.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
    {section === 'requests' ? administrative && ui.data.mode === 'isolated_unified' && requestProfessionalId ? <AdministrativeCapacityPanel key={requestProfessionalId} ui={ui} professionalId={requestProfessionalId} requests={requests} renderSummary={item=><RequestSummary item={item} assignments={ui.data.assignments}/>}/> : chosen ? <CapacityPanel key={chosen.id} ui={ui} professional={chosen} requests={requests} /> : <section className={panelClass}>L’espace professionnel n’est pas activé pour ce compte.</section>
      : section === 'preferences' ? chosen ? <PreferencesPanel key={chosen.id + ':' + chosen.preferencesVersion} ui={ui} professional={chosen} /> : <section className={panelClass}>Aucun profil de pratique accessible.</section>
        : <><div className="flex flex-wrap gap-2"><button className={buttonClass(history ? 'secondary' : 'primary')} onClick={() => void (section === 'admission-history' ? ui.navigate('assignments', { tab: 'active' }) : ui.select({ [embedded ? 'assignmentView' : 'tab']: 'active', assignment: null, page: null }))}>{administrative ? 'En attente de réponse' : 'Clients actifs'}</button><button className={buttonClass(history ? 'primary' : 'secondary')} onClick={() => void (section === 'admission-history' ? ui.navigate('assignments', { tab: 'history' }) : ui.select({ [embedded ? 'assignmentView' : 'tab']: 'history', assignment: null, page: null }))}>{administrative ? 'Assignations traitées' : 'Clients archivés'}</button></div>
          <section className={panelClass}><Search ui={ui} /><p className="mt-3 text-sm">{administrative ? history ? 'Services pris, services non pris et assignations annulées ou clôturées. Le dossier client peut rester actif après un service pris.' : 'Clients à contacter ou contactés dont la réponse reste à obtenir.' : history ? 'Clients dont le suivi est terminé, refusé ou annulé.' : 'Clients dont le suivi est actif, y compris après la prise du service.'}</p></section>
          {!administrative && history && <Fold title="Historique des demandes professionnelles"><div className="grid gap-3">{requests.map(item => <RequestSummary key={item.id} item={item} assignments={ui.data.assignments} />)}{!requests.length && <p>Aucune demande professionnelle.</p>}</div></Fold>}
          <div className="grid items-start gap-5 xl:grid-cols-[330px_minmax(0,1fr)]"><section className={panelClass}><div className="grid gap-2">{pageRows(assignments, ui.query).map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} className={'w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5633] ' + (selected?.id === item.id ? 'border-[#8a5633] bg-[#f3e3cd]' : 'border-[#eadfd2] hover:border-[#8a5633] hover:bg-[#f5ebe0]')} onClick={() => { if (embedded && selected?.id === item.id) scrollToSelectedDetail(); else void ui.select({ assignment: item.id }) }}><p className="font-semibold">{item.clientSnapshot.firstName} {item.clientSnapshot.lastName}</p><p className="mt-1 text-sm">{item.canceledAt ? 'Assignation annulée' : getAssignedClientStatusMeta(item.outcome).label}</p><p className="mt-1 text-xs">{dateTime(item.assignedAt)}{item.admissionId ? '' : ' · Antérieure sans demande d’admission'}</p></button>)}{!assignments.length && <p>{administrative ? history ? 'Aucune assignation traitée pour le moment.' : 'Aucun client à contacter ou en attente de réponse.' : history ? 'Aucun client archivé.' : 'Aucun client actif.'}</p>}</div><Pager total={assignments.length} query={ui.query} select={ui.select} /></section>{selected ? <div ref={selectedDetailRef} className="scroll-mt-24" role="region" aria-label={`Assignation de ${selected.clientSnapshot.firstName} ${selected.clientSnapshot.lastName}`} tabIndex={-1}><AssignmentCase key={selected.id} ui={ui} assignment={selected} clientAccessible={Boolean(selected.clientId && accessibleClientIds.includes(selected.clientId))} /></div> : <section className={panelClass}>Sélectionnez une assignation pour retracer le motif et son résultat.</section>}</div>
        </>}
  </div>
}
function RequestSummary({ item, assignments }: { item: ProfessionalCapacityRequest; assignments: AdmissionAssignment[] }) {
  const progress = capacityRequestProgress(item.id, assignments)
  const hours = item.offerSlots?.reduce((sum, slot) => sum + (slot.endMinute - slot.startMinute) / 60, 0) ?? 0
  const preference = { '': '', grouped: 'Plages collées, mêmes journées si possible', spread: 'Rencontres séparées sur plusieurs jours', flexible: 'Aucune préférence', other: 'Autre préférence' }[item.schedulePreference]
  return <div className="rounded-xl border border-[#eadfd2] p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{item.offerSlots?.length ? 'Disponibilités' : 'Demande'} du {dateTime(item.createdAt)}</p><Badge tone="neutral">{capacityRequestStatus(item)}</Badge></div><p className="mt-2">{item.requestedCount} nouveau{item.requestedCount > 1 ? 'x' : ''} client{item.requestedCount > 1 ? 's' : ''} · {item.acceptedCount} service(s) pris · {progress.notTaken} service(s) non pris · {progress.toContact} client(s) encore à contacter{progress.awaitingResponse ? ` · ${progress.awaitingResponse} réponse(s) attendue(s)` : ''}</p>{Boolean(item.offerSlots?.length) && <><p className="mt-2 font-medium">{item.offerSlots.length} plage(s) · {hours} heure(s) offertes · {preference}</p></>}<AssignmentRequestComment comment={item.offerSlots?.length ? [...assignmentRequestComment(item.comment).notes, "Plages proposées : " + item.offerSlots.map(slot => `${slot.day} ${String(Math.floor(slot.startMinute / 60)).padStart(2, "0")} h ${String(slot.startMinute % 60).padStart(2, "0")}–${String(Math.floor(slot.endMinute / 60)).padStart(2, "0")} h ${String(slot.endMinute % 60).padStart(2, "0")}`).join(", ")].join("\n") : item.comment} /></div>
}
function CapacityPanel({ ui, professional, requests }: { ui: AdmissionUi; professional: AdmissionProfessional; requests: ProfessionalCapacityRequest[] }) {
  const pendingRequests = requests.filter(isCapacityRequestPending).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  const current = pendingRequests[0]
  const previousRequests = requests.filter(item => !isCapacityRequestPending(item))
  // Generated slot descriptions are already stored in offerSlots; edit the human comment only.
  const editableComment = current?.offerSlots?.length ? assignmentRequestComment(current.comment).notes.join('\n') : current?.comment ?? ''
  const editor = <ActionForm key={current?.id + ':' + current?.version} fields={[{ name: 'requestedCount', label: 'Nombre de nouveaux clients souhaités', type: 'number', min: 0, max: 500, required: true, initial: String(current?.requestedCount ?? 1) }, { name: 'comment', label: 'Commentaire pour la direction', type: 'textarea', maxLength: 300, initial: editableComment }]} submitLabel="Sauvegarder la demande" onSubmit={async values => { if (current) await ui.run('capacities.update', current.id, { expectedVersion: current.version, requestedCount: Number(values.requestedCount), comment: text(values.comment), enabled: true }); else await ui.run('capacities.create', null, { professionalId: professional.id, requestedCount: Number(values.requestedCount), comment: text(values.comment) }) }} />
  return <div className="grid gap-4"><section className={panelClass}><h2 className="mb-3 text-xl font-semibold">Demande actuelle</h2>
    {current ? <><RequestSummary item={current} assignments={ui.data.assignments} /><details className="mt-4"><summary className="cursor-pointer font-medium">Modifier la demande</summary><div className="mt-3">{editor}</div></details><button type="button" className={buttonClass('secondary') + ' mt-3'} disabled={ui.busy} onClick={() => { if (window.confirm('Clore cette demande ? Les assignations et leur historique restent conservés.')) void ui.run('capacities.update', current.id, { expectedVersion: current.version, requestedCount: current.requestedCount, comment: editableComment, enabled: false }) }}>Clore la demande</button></> : <><p className="mb-3">Aucune demande en cours.</p>{editor}</>}
    {pendingRequests.length > 1 && <div className="mt-4 grid gap-3"><h3 className="font-semibold">Autres demandes en cours</h3>{pendingRequests.slice(1).map(item => <RequestSummary key={item.id} item={item} assignments={ui.data.assignments} />)}</div>}
    </section><RequestHistory ui={ui} requests={previousRequests} /></div>
}
function PreferencesPanel({ ui, professional }: { ui: AdmissionUi; professional: AdmissionProfessional }) {
  const [value, setValue] = useState<ProfessionalStructuredPreferences>(() => structuredClone(professional.preferences)), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useClinicalFormGuard(dirty, busy)
  return <section className={panelClass}><h2 className="mb-3 text-xl font-semibold">Préférences de {professional.displayName}</h2><p className="mb-5 text-sm">Ces renseignements guident le jumelage. Les notes restent visibles à la direction et ne sont pas interprétées comme des critères automatiques.</p><ProfessionalPreferencesEditor value={value} onChange={next => { setValue(next); setDirty(true) }} />{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button className={buttonClass('secondary') + ' mt-5'} disabled={busy || !dirty} onClick={async () => { setBusy(true); setError(''); try {
    if (value.pref_languages.some(language => language.startsWith('Autre :') && !language.slice(7).trim())) throw new Error('Précisez la langue sélectionnée dans « Autre ».')
    await ui.run('preferences.update', professional.id, { expectedVersion: professional.preferencesVersion, preferences: value }); setDirty(false)
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Préférences non enregistrées.') } finally { setBusy(false) } }}>{busy ? 'Sauvegarde…' : 'Sauvegarder les préférences'}</button></section>
}
export function AssignmentCase({ ui, assignment, clientAccessible }: { ui: AdmissionUi; assignment: AdmissionAssignment; clientAccessible: boolean }) {
  const administrative = ui.data.context === 'administration'
  const notices = administrative ? ui.data.notifications.filter(item => item.assignmentId === assignment.id) : []
  const [editingEmail, setEditingEmail] = useState(false)
  const [closureRequired, setClosureRequired] = useState(false)
  const pendingEmails = notices.filter(item => item.purpose === 'assignment' && item.status === 'prepared' && !notices.some(review => review.supersedesNotificationId === item.id))
  return <div className="grid gap-4"><section className={panelClass}><h2 className="text-xl font-semibold">{assignment.clientSnapshot.firstName} {assignment.clientSnapshot.lastName}</h2><p className="my-3 text-sm">{assignment.canceledAt ? 'Annulée le ' + dateTime(assignment.canceledAt) + ' · ' + assignment.cancellationReason : getAssignedClientStatusMeta(assignment.outcome).label} · Assignée le {dateTime(assignment.assignedAt)}</p><Details value={{ ...assignment.clientSnapshot, internalNotes: '' }} />{clientAccessible && <button className={buttonClass('secondary')} onClick={() => assignment.clientId && void ui.openClient(assignment.clientId)}>Ouvrir le dossier client</button>}{administrative && assignment.admissionId && <button className={buttonClass('ghost')} onClick={() => void ui.navigate('waiting', { admission: assignment.admissionId!, tab: 'history' })}>Ouvrir la demande d’admission</button>}</section>
    {administrative && <Fold title={`Courriels et rappels (${notices.length})`}><p className="mb-3 text-sm">{clinicalUiText("Aucun courriel réel n’est parti du laboratoire.","Historique des courriels et rappels de cette prise en charge.")}</p>{pendingEmails.length > 0 && <button className={buttonClass('secondary') + ' mb-3'} onClick={() => setEditingEmail(true)}>Modifier les courriels d’assignation</button>}<div className="grid gap-2">{notices.map(item => <div key={item.id} className="rounded-xl border border-[#eadfd2] p-3 text-sm"><p className="font-semibold">{item.subject} · {admissionNotificationStatusLabel(item.status)} · {dateTime(item.createdAt)}</p><p>{item.recipientLabel}{item.cc.length ? ' · Cc : ' + item.cc.join(', ') : ''}</p><p className="mt-2 whitespace-pre-wrap">{item.body}</p></div>)}</div></Fold>}
    {editingEmail && <AssignmentEmailFlow ui={ui} assignmentId={assignment.id} notifications={notices} onClose={() => setEditingEmail(false)} />}
    {assignment.canceledAt ? <p className="rounded-xl bg-[#f1ead9] p-4 text-sm">Cette assignation reste historique. Elle ne peut pas être réactivée en changeant son résultat.</p> : !assignment.admissionId ? <p className="rounded-xl bg-[#f1ead9] p-4 text-sm">Assignation antérieure conservée sans admission ou capacité inventée. Cette ligne est consultable ; un nouveau cycle passe par une demande explicite.</p> : <Fold title="Résultat du contact"><ActionForm key={assignment.version} fields={[
      { name: 'outcome', label: 'Statut de prise en charge', type: 'select', required: true, initial: assignment.outcome, options: ['not_contacted', 'pending', 'taken', 'not_taken'].map(value => ({ value, label: getAssignedClientStatusMeta(value as AdmissionAssignment['outcome']).label })) },
      { name: 'reason', label: 'Motif obligatoire si service non pris (Autre : préciser la situation)', type: 'textarea', maxLength: 1000, initial: assignment.refusalReason },
      ...(assignment.outcome !== 'taken' ? [
        { name: 'appointmentDate', label: 'Si service pris : date du premier rendez-vous', type: 'date' as const },
        { name: 'appointmentTime', label: 'Si service pris : heure du Québec', type: 'time' as const },
        { name: 'appointmentModality', label: 'Si service pris : modalité', type: 'select' as const, options: Object.entries(SERVICE_APPOINTMENT_MODALITIES).map(([value, label]) => ({ value, label })) },
      ] : []),
    ]} submitLabel="Enregistrer le résultat" onSubmit={async values => {
      const reason = text(values.reason)
      if (values.outcome === 'not_taken') { const error = getNonServiceReasonError(reason); if (error) throw new Error(error) }
      const appointment = values.outcome === 'taken' && assignment.outcome !== 'taken'
        ? validateServiceAppointmentInput({ date: text(values.appointmentDate), time: text(values.appointmentTime), modality: text(values.appointmentModality) }) : null
      setClosureRequired(false)
      try { await ui.run('assignments.result', assignment.id, { expectedVersion: assignment.version, outcome: values.outcome,
        ...(values.outcome === 'not_taken' ? { reason } : {}),
        ...(appointment ? { appointmentDate: appointment.date, appointmentTime: appointment.time, appointmentModality: appointment.modality, appointmentStartsAt: dateTimeInputToUtcInToronto(`${appointment.date}T${appointment.time}`).toISOString() } : {}),
      }) } catch (cause) { if (isAssignmentEncounterFailure(cause)) setClosureRequired(true); throw cause }
    }} /></Fold>}
    {closureRequired && <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>{assignmentEncounterMessage}</p>{assignment.clientId && <button type="button" className={buttonClass('secondary') + ' mt-3'} onClick={() => void ui.openClient(assignment.clientId!)}>Aller à la fermeture du dossier</button>}</section>}
    {administrative && !assignment.canceledAt && assignment.admissionId && <Fold title="Annuler cette assignation et retourner en attente"><p className="mb-3 text-sm">La place sera libérée. Un futur cycle créera un nouvel épisode ; les anciens épisodes, dossiers, notes et habilitations seront conservés.</p><ActionForm fields={[{ name: 'reason', label: 'Motif d’annulation et de retour', required: true, type: 'textarea', maxLength: 1000 }]} submitLabel="Annuler et remettre en attente" onSubmit={async values => { if (!window.confirm('Annuler cette assignation et remettre sa demande en attente, sans supprimer l’historique ?')) throw new Error('Retour annulé.'); await ui.run('assignments.return', assignment.id, { expectedVersion: assignment.version, ...values }) }} /></Fold>}
    {administrative && <AdmissionHistory ui={ui} assignmentId={assignment.id} />}
  </div>
}

function RequestHistory({ui, requests}: {ui: AdmissionUi; requests: ProfessionalCapacityRequest[]}) {
 const [expanded, setExpanded] = useState<string[]>([])
 return <Fold title="Historique des demandes"><div className="grid gap-4">{[...requests].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(item => {
  const assignments=ui.data.assignments.filter(assignment=>assignment.capacityRequestId===item.id)
  const progress=capacityRequestProgress(item.id,ui.data.assignments)
  const card={request:{id:item.id,requested_count:item.requestedCount,request_comment:item.comment}, status:item.state==='completed'?'Completee':item.enabled?'Active':'Archivée', durationLabel:item.state==='completed'?'Demande complétée':item.enabled?'En cours':'Demande archivée',createdDate:item.createdAt,completionDate:item.completedAt,serviceTakenCount:item.acceptedCount,serviceNotTakenCount:progress.notTaken,remainingCount:item.remainingCount,notContactedCount:progress.toContact,pendingCount:progress.awaitingResponse}
  return <RequestHistoryCard key={item.id} card={card} isExpanded={expanded.includes(item.id)} onToggle={()=>setExpanded(values=>values.includes(item.id)?values.filter(id=>id!==item.id):[...values,item.id])}>{expanded.includes(item.id) && <div className="mt-4 grid gap-3">{assignments.map(assignment=><details key={assignment.id} className="rounded-xl border border-[#eadfd2] p-4"><summary className="cursor-pointer">{assignment.clientSnapshot.firstName} {assignment.clientSnapshot.lastName} · {getAssignedClientStatusMeta(assignment.outcome).label}{assignment.refusalReason ? ' · '+assignment.refusalReason : ''}</summary><div className="mt-3"><AssignmentCase ui={ui} assignment={assignment} clientAccessible={Boolean(assignment.clientId)} /></div></details>)}{!assignments.length && <p>Aucun client assigné à cette demande.</p>}</div>}</RequestHistoryCard>
 })}{!requests.length && <p>Aucune demande antérieure.</p>}</div></Fold>
}
