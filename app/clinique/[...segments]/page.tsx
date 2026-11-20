import { notFound, redirect } from 'next/navigation'
import { ClinicalWorkspace } from '@/components/clinical-workspace/ClinicalWorkspace'
import { unifiedOperationalDestination, isOriginalClinicalPage } from '@/lib/clinical-unification/routes'

export const dynamic = 'force-dynamic'
export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ segments?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { segments = [] } = await params
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(key, value)
    const destination = unifiedOperationalDestination('clinical', segments, query)
    if (destination) redirect(destination)
    if (segments[0] === 'honoraires' && segments.length === 1) redirect('/clinique/facturation?billingTab=fees')
    if (!isOriginalClinicalPage('clinical', segments)) notFound()
  } else if (segments.length > 2 || (segments[0] && !['clients', 'notes', 'note', 'mandats', 'agenda', 'bureaux', 'mon-profil', 'facturation', 'journal', 'appels', 'attente', 'demarches', 'demandes', 'preferences', 'assignations', 'historique'].includes(segments[0]))
    || (segments[1] && (segments[0] !== 'clients' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segments[1])))) notFound()
  if (segments[0] === 'agenda') {
    const query = new URLSearchParams({ tab: 'activities' })
    for (const [key, value] of Object.entries(await searchParams)) {
      if (['day', 'view', 'appointment', 'professional'].includes(key) && typeof value === 'string') query.set(key, value)
    }
    redirect(`/clinique/mon-profil?${query}`)
  }
  if (segments[0] === 'notes') redirect('/clinique/clients')
  if (segments[0] === 'preferences') redirect('/clinique/mon-profil?tab=preferences')
  if (segments[0] === 'journal') redirect('/clinique/mon-profil')
  return <ClinicalWorkspace realApplication={process.env.PEA_CLINICAL_RUNTIME === 'real-db' && process.env.PEA_UNIFICATION_PILOT !== 'true' && process.env.PEA_REAL_LOCAL_REHEARSAL !== 'true'} />
}
