'use client'

import {useEffect} from 'react'
import {useRouter} from 'next/navigation'
import {supabase} from '@/lib/supabaseClient'
import OperationalProfessionalPage from '@/components/OperationalProfessionalPage'

/** Keep the operational profile available to the team during gradual rollout.
 * The SQL summary uses the current authenticated viewer, not the profile ID. */
export function ProfessionalProfileEntry({professionalId}: {professionalId: string}) {
  const router = useRouter()
  const enabled = process.env.NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION === 'true'
  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      try {
        const {data, error} = await supabase.rpc('clinical_my_access_summary')
        if (!active) return
        if (!error && data?.enabled === true) {
          router.replace('/administration/professionnels/' + encodeURIComponent(professionalId))
          return
        }
      } catch { /* An unavailable clinical module must not hide the operational profile. */ }
    })()
    return () => { active = false }
  }, [enabled, professionalId, router])
  return <OperationalProfessionalPage />
}
