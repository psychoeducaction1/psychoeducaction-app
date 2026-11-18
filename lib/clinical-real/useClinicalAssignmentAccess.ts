'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/** Presentation only; every server operation retains its own authorization. */
export function useClinicalAssignmentAccess(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PEA_CLINICAL_ASSIGNMENT_NAV !== 'true') return
    let cancelled = false
    let generation = 0
    const refresh = async () => {
      const current = ++generation
      setEnabled(false)
      try {
        const { data, error } = await supabase.rpc('clinical_my_access_summary')
        if (!cancelled && current === generation) setEnabled(!error && data?.enabled === true)
      } catch { /* Preserve the original flow if the access check is unavailable. */ }
    }
    void refresh()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      generation++
      setEnabled(false)
      setTimeout(() => { if (!cancelled) void refresh() }, 0)
    })
    return () => { cancelled = true; generation++; subscription.unsubscribe() }
  }, [])
  return enabled
}
