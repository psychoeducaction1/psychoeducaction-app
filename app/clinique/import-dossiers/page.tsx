import { notFound } from 'next/navigation'
import RealClinicalImport from '@/components/clinical-real/RealClinicalImport'

export const dynamic = 'force-dynamic'

export default function ImportDossiersPage() {
  if (process.env.PEA_CLINICAL_RUNTIME !== 'real-db' || process.env.PEA_CLINICAL_IMPORT_ENABLED === 'false') notFound()
  return <RealClinicalImport />
}
