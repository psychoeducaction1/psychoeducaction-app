'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { buttonClass } from '@/components/Ui'
import { getAssignedClientStatus, getAssignedClientStatusMeta, getAssignmentRequestMetrics, getServiceTakenCount, getUsedAssignmentCount, type AssignedClient } from '@/app/professionnel/shared'
import { professionalPreviewSections, type ProfessionalPreview, type ProfessionalPreviewSection } from '@/lib/professionalPreview'
import { normalizeStructuredPreferences, getOptionLabels, formatAgeRanges, motifOptions, clientGroupOptions, serviceTypeOptions, officeLocationOptions, meetingModeOptions } from '@/lib/professionalPreferences'

const panel = 'rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5'
const date = (value: string | null) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—'
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto' }).format(new Date(value))
}
function Clients({ clients }: { clients: AssignedClient[] }) {
  return clients.length ? <div className="space-y-3">{clients.map(client => <article className={panel} key={client.id}>
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{client.first_name} {client.last_name}</h3><span className={getAssignedClientStatusMeta(getAssignedClientStatus(client)).className + ' rounded-full border px-3 py-1 text-sm'}>{getAssignedClientStatusMeta(getAssignedClientStatus(client)).label}</span></div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">{[['Courriel',client.email],['Téléphone',client.phone],['Requérant',client.requester_name],['Assigné le',date(client.assigned_date)],['Modalité',client.meeting_modality],['Adresse du service',client.service_address]].map(([label,value])=><div key={label}><dt className="text-[#7a6859]">{label}</dt><dd className="break-words">{value || '—'}</dd></div>)}</dl>
    {client.short_comment && <p className="mt-3 whitespace-pre-wrap">{client.short_comment}</p>}
    {client.closure_reason && <p className="mt-2">Motif : {client.closure_reason}</p>}
  </article>)}</div> : <p className={panel}>Aucun client dans cette section.</p>
}

export function ProfessionalPreviewWorkspace({ professionalId }: { professionalId: string }) {
  const [data, setData] = useState<ProfessionalPreview | null>(null)
  const [error, setError] = useState('')
  const [section, setSection] = useState<ProfessionalPreviewSection>('dashboard')
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    void (async () => {
      try {
        const { data: session, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session.session) throw new Error('Reconnectez-vous à votre compte Direction.')
        const response = await fetch('/api/direction/professionals/' + encodeURIComponent(professionalId) + '/preview', { headers: { Authorization: 'Bearer ' + session.session.access_token }, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 403 ? 'Accès réservé à la Direction.' : 'Impossible de charger cet aperçu.')
        const snapshot = await response.json() as ProfessionalPreview
        if (!controller.signal.aborted) setData(snapshot)
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Aperçu indisponible.') }
    })()
    return () => controller.abort()
  }, [professionalId])
  const requests = [...(data?.requests ?? [])].sort((a,b)=>(b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const clientsFor = (id: string) => data?.assignments.filter(c=>c.assignment_request_id===id) ?? []
  const metrics = (request: ProfessionalPreview['requests'][number]) => {
    const clients = clientsFor(request.id)
    return getAssignmentRequestMetrics({isActive:request.is_active,requestedCount:request.requested_count,acceptedCount:getServiceTakenCount(clients),occupiedCount:getUsedAssignmentCount(clients),remainingCount:Math.max((request.requested_count ?? 0)-getUsedAssignmentCount(clients),0)})
  }
  const activeRequest = requests.find(r=>metrics(r).isActive)
  const assigned = [...(data?.assignments ?? [])].sort((a,b)=>(b.assigned_date ?? '').localeCompare(a.assigned_date ?? ''))
  const preferences = normalizeStructuredPreferences(data?.professional)
  return <div className="min-h-screen bg-[#f8f4ed] text-[#332820]">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[#eadfd2] bg-white p-4">
      <div><strong>Aperçu professionnel — lecture seule</strong><p className="text-sm">Vous restez connecté à la Direction. Aucun changement ni envoi n’est possible ici.</p></div>
      <Link href="/direction/professionnels" className={buttonClass('secondary')}>Retour à la Direction</Link>
    </header>
    {error ? <p role="alert" className="m-6 rounded-xl border border-red-300 p-5">{error}</p> : !data ? <p role="status" className="p-8">Chargement de l’aperçu…</p> : <div className="flex flex-col md:flex-row">
      <aside className="border-r border-[#eadfd2] bg-white p-5 md:min-h-screen md:w-64 md:shrink-0">
        <p className="text-sm text-[#7a6859]">Espace d’assignation</p><h1 className="mb-5 font-semibold">{data.professional.full_name || data.professional.email}</h1>
        <nav aria-label="Consultation de l’espace professionnel" className="flex flex-col gap-2">{professionalPreviewSections.map(([key,label])=><button type="button" key={key} aria-current={section===key?'page':undefined} onClick={()=>setSection(key)} className={'rounded-xl p-3 text-left '+(section===key?'bg-[#8a5633] text-white':'hover:bg-[#f5ebe0]')}>{label}</button>)}</nav>
      </aside>
      <main className="min-w-0 flex-1 space-y-5 p-5 md:p-8">
        <h2 className="text-2xl font-semibold">{professionalPreviewSections.find(([key])=>key===section)?.[1]}</h2>
        <p className="text-sm text-[#7a6859]">Consultation des données de l’application d’assignation. Les formulaires et actions du professionnel sont remplacés par leur lecture seule. Cet aperçu ne simule pas sa connexion ni ses permissions.</p>
        {data.professional.platform_access_enabled===false && <p className={panel}>L’accès à la plateforme de ce professionnel est désactivé.</p>}
        {(section==='dashboard' || section==='request') && <section className={panel}>{activeRequest ? <>
          <h3 className="font-semibold">Demande active</h3><dl className="mt-4 grid grid-cols-3 gap-3">{[['Demandés',activeRequest.requested_count ?? 0],['Services pris',getServiceTakenCount(clientsFor(activeRequest.id))],['Restants',Math.max((activeRequest.requested_count ?? 0)-getUsedAssignmentCount(clientsFor(activeRequest.id)),0)]].map(([key,value])=><div key={key}><dt>{key}</dt><dd className="text-2xl font-semibold">{value}</dd></div>)}</dl>
          <p className="mt-4 whitespace-pre-wrap">{activeRequest.request_comment || 'Aucun commentaire.'}</p>
        </> : <p>Aucune demande active actuellement.</p>}</section>}
        {section==='dashboard' && <Clients clients={activeRequest ? clientsFor(activeRequest.id) : []} />}
        {section==='assignments' && <>{(['not_contacted','pending','taken'] as const).map(status=><section key={status} className="space-y-3"><h3 className="text-lg font-semibold">{status==='not_contacted'?'Clients pas encore contactés':status==='pending'?"En attente d’une réponse":'Clients ayant pris le service'}</h3><Clients clients={assigned.filter(c=>getAssignedClientStatus(c)===status)} /></section>)}</>}
        {section==='history' && <>{requests.length ? requests.map(request=><details key={request.id} className={panel}><summary className="cursor-pointer font-semibold">Demande du {date(request.created_at)} — {metrics(request).isActive ? 'Active' : 'Terminée / inactive'}</summary><p className="my-3 whitespace-pre-wrap">{request.request_comment || 'Aucun commentaire.'}</p><p className="mb-3">Demandés : {request.requested_count ?? 0} · Services pris : {getServiceTakenCount(clientsFor(request.id))} · Services non pris : {clientsFor(request.id).filter(c=>getAssignedClientStatus(c)==='not_taken').length}</p><Clients clients={clientsFor(request.id)} /></details>) : <p className={panel}>Aucune demande à afficher.</p>}<section className="space-y-3"><h3 className="font-semibold">Clients sans demande liée</h3><Clients clients={assigned.filter(c=>!c.assignment_request_id)} /></section></>}
        {section==='preferences' && <dl className={panel+' grid gap-4 sm:grid-cols-2'}>{[
          ['Langues',preferences.pref_languages.join(', ')],['Âges',formatAgeRanges(preferences.pref_age_ranges)],
          ['Clientèles',getOptionLabels(preferences.pref_client_groups,clientGroupOptions).join(', ')],['Services',getOptionLabels(preferences.pref_service_types,serviceTypeOptions).join(', ')],
          ['Bureaux',getOptionLabels(preferences.pref_office_locations,officeLocationOptions).join(', ')],['Modalités',getOptionLabels(preferences.pref_meeting_modes,meetingModeOptions).join(', ')],
          ['Motifs acceptés',getOptionLabels(preferences.pref_motifs,motifOptions).join(', ')],['Exclusions',preferences.pref_exclusions],['Notes et précisions',preferences.pref_matching_notes],
        ].map(([label,value])=><div key={label}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap">{value || '—'}</dd></div>)}</dl>}
      </main>
    </div>}
  </div>
}
