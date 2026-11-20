'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import type { LegacyLinkSource } from '@/lib/clinical-integration/legacyLinkQuery'

type LinkState = 'idle' | 'loading' | 'case' | 'identity' | 'unlinked' | 'error'

/** Vérification volontaire par UUID, sans ouvrir ni copier de dossier clinique. */
export function ClinicalLegacyLinkStatus({ sourceTable, sourceId }: {
  sourceTable: LegacyLinkSource
  sourceId: string
}) {
  const [state, setState] = useState<LinkState>('idle')
  const [caseId, setCaseId] = useState<string | null>(null)

  if (process.env.NEXT_PUBLIC_PEA_CLINICAL_LINK_STATUS !== 'true') return null

  async function checkLink() {
    setState('loading')
    setCaseId(null)
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error || !session?.access_token) throw new Error('Session indisponible.')
      const url = new URL('/api/direction/clinical-links', window.location.origin)
      url.searchParams.set('sourceTable', sourceTable)
      url.searchParams.set('sourceId', sourceId)
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Vérification indisponible.')
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('linked' in result)
        || typeof result.linked !== 'boolean') throw new Error('Réponse invalide.')
      if (!result.linked) {
        setState('unlinked')
      } else if ('caseId' in result && typeof result.caseId === 'string') {
        setCaseId(result.caseId)
        setState('case')
      } else if ('caseId' in result && result.caseId === null) {
        setState('identity')
      } else {
        throw new Error('Réponse invalide.')
      }
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6c5a4d]">
      <button type="button" onClick={() => void checkLink()} disabled={state === 'loading'}
        className="rounded-lg border border-[#dfd0bf] bg-white px-2 py-1 font-medium hover:bg-[#f7efe7] disabled:opacity-60">
        {state === 'loading' ? 'Vérification…' : 'Vérifier le dossier clinique'}
      </button>
      {state === 'case' && caseId && <Link href={`/administration/clients/${encodeURIComponent(caseId)}`}
        className="rounded-lg border border-[#8a5633] bg-[#f5e9d9] px-2 py-1 font-medium text-[#6d3f1f] hover:bg-[#ead8c4]">
        Ouvrir le dossier clinique
      </Link>}
      {state === 'identity' && <span role="status">Identité clinique reliée; dossier à créer</span>}
      {state === 'unlinked' && <span role="status">Aucun lien clinique pour cette fiche</span>}
      {state === 'error' && <span role="status">Vérification indisponible</span>}
    </div>
  )
}
