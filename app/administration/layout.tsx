import type { ReactNode } from 'react'
import { ClinicalWorkspace } from '@/components/clinical-workspace/ClinicalWorkspace'

/** Preserve identity and unsaved-change guards between clinical pages.
 * The child page retains destination validation and operational redirects.
 * Each API request still independently verifies permissions.
 */
export default function AdministrationWorkspaceLayout({ children }: { children: ReactNode }) {
  return <>
    {children}
    <ClinicalWorkspace realApplication={process.env.PEA_CLINICAL_RUNTIME === 'real-db' && process.env.PEA_UNIFICATION_PILOT !== 'true' && process.env.PEA_REAL_LOCAL_REHEARSAL !== 'true'} />
  </>
}
