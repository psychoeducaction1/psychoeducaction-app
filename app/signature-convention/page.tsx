import { notFound } from 'next/navigation'
import RealMandateSignaturePortal from '@/components/clinical-real/RealMandatePlacedSignaturePortal'
import { ClinicalNavigationGuard } from '@/components/clinical-workspace/NavigationGuard'

export default function SignatureConventionPage() {
  if (process.env.PEA_CLINICAL_RUNTIME !== 'real-db') notFound()
  return <ClinicalNavigationGuard><RealMandateSignaturePortal /></ClinicalNavigationGuard>
}
