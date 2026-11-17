'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { procedureRequest } from '@/lib/procedures/client'
import { supabase } from '@/lib/supabaseClient'

export function ProcedureLibraryLink({ onNavigate, identityKey }: { onNavigate?: () => Promise<void>; identityKey?: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let current = true, generation = 0
    const load = async () => {
      const request = ++generation
      setVisible(false)
      try { const access = await procedureRequest<{ canRead: boolean }>(undefined, undefined, true); if (current && request === generation) setVisible(access.canRead === true) }
      catch { if (current && request === generation) setVisible(false) }
    }
    void load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { if (current) { setVisible(false); queueMicrotask(() => { if (current) void load() }) } })
    window.addEventListener('focus', load)
    return () => { current = false; ++generation; subscription.unsubscribe(); window.removeEventListener('focus', load) }
  }, [identityKey])
  if (!visible) return null
  const content = <><BookOpen size={18} className="shrink-0" /><span>Procédures</span></>
  const className = 'flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold text-[#6c5a4d] hover:bg-[#f5ebe0]'
  return onNavigate ? <button type="button" className={className} onClick={() => void onNavigate()}>{content}</button> : <Link href="/procedures" className={className}>{content}</Link>
}
