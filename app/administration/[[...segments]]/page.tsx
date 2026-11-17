import { isProfessionalSlug } from '@/lib/clinical-workspace/professionalLinks'
import { notFound, redirect } from 'next/navigation'
import { ClinicalWorkspace } from '@/components/clinical-workspace/ClinicalWorkspace'
import { unifiedOperationalDestination, isOriginalClinicalPage } from '@/lib/clinical-unification/routes'

export const dynamic = 'force-dynamic'
export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ segments?: string[] }>; searchParams: Promise<{ pro?: string | string[] }> }) {
  const { segments = [] } = await params
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const destination = unifiedOperationalDestination('administration', segments)
    if (destination) redirect(destination)
    if (segments[0] === 'honoraires' && segments.length === 1) redirect('/administration/facturation?billingTab=fees')
    if (!isOriginalClinicalPage('administration', segments)) notFound()
  }
  if (segments.length === 1 && segments[0] === 'preferences') {
    const { pro } = await searchParams
    const professional = typeof pro === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pro) ? `/${pro}` : ''
    redirect(`/administration/professionnels${professional}?tab=preferences`)
  }
  if (segments.length > 2 || (segments[0] && !['clients', 'mandats', 'agenda', 'bureaux', 'professionnels', 'migration-donnees', 'parametres-clinique', 'facturation', 'journal', 'appels', 'attente', 'demarches', 'taches', 'demandes', 'preferences', 'assignations', 'historique'].includes(segments[0]))
    || (segments[1] && (!['clients', 'professionnels'].includes(segments[0]) || !(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segments[1]) || segments[0]==='professionnels' && isProfessionalSlug(segments[1]))))) notFound()
  return <ClinicalWorkspace realApplication={process.env.PEA_CLINICAL_RUNTIME === 'real-db' && process.env.PEA_UNIFICATION_PILOT !== 'true' && process.env.PEA_REAL_LOCAL_REHEARSAL !== 'true'} />
}
