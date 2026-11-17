import { notFound } from 'next/navigation'
import { StandaloneNotePage } from '@/components/clinical-workspace/StandaloneNotePage'
import { isLoopbackUrl } from '@/lib/developmentIsolation'
import { isStagingClinicalRuntime } from '@/lib/clinical-local/runtime'

export const dynamic = 'force-dynamic'

export default function NotePage() {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') return <StandaloneNotePage />
  if (!isStagingClinicalRuntime() && (process.env.PEA_CLINICAL_FIXTURES !== 'true' || process.env.PEA_ISOLATED_DEVELOPMENT !== 'true'
    || !isLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL))) notFound()
  return <StandaloneNotePage />
}
