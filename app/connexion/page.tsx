import { ClinicalLogin } from '@/components/clinical-workspace/ClinicalLogin'
import { isStagingClinicalRuntime } from '@/lib/clinical-local/runtime'
import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
export default function ClinicalLoginPage() {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') redirect('/login')
  return <ClinicalLogin staging={isStagingClinicalRuntime()} />
}
