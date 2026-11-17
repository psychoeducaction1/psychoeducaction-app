import { notFound, redirect } from 'next/navigation'
import { isLoopbackUrl } from '@/lib/developmentIsolation'
import { isStagingClinicalRuntime } from '@/lib/clinical-local/runtime'

export const dynamic = 'force-dynamic'

export default function ClinicalLaboratoryPage() {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') redirect('/clinique/mon-profil')
  if (!isStagingClinicalRuntime() && (process.env.PEA_CLINICAL_FIXTURES !== 'true' || process.env.PEA_ISOLATED_DEVELOPMENT !== 'true'
    || !isLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL))) notFound()
  redirect('/clinique/mon-profil')
}
