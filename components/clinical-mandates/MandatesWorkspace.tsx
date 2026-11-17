'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { loadMandates } from '@/lib/clinical-mandates/client'
import { ClientMandatesPanel } from './ClientMandatesPanel'

type WorkspaceProps = {
  workspace: WorkspaceView
  onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>
  onUpdated: () => Promise<void>
  embeddedClientId?: string
}

export function MandatesWorkspace(props: WorkspaceProps) {
  return props.embeddedClientId
    ? <ClientMandatesPanel {...props} clientId={props.embeddedClientId} />
    : <LegacyMandateRedirect {...props} />
}

/** Old bookmarks resolve to the client file without rendering a second mandate workspace. */
function LegacyMandateRedirect({ workspace, onNavigate }: WorkspaceProps) {
  const params = useSearchParams()
  const clientId = params.get('client')
  const mandateId = params.get('mandate')
  const recordId = params.get('record')
  const [message, setMessage] = useState('Ouverture du dossier client…')

  useEffect(() => {
    let cancelled = false
    const go = async () => {
      // The legacy case URL resolves only among records already authorized by the server.
      let target = clientId ?? workspace.records.find(record => record.id === recordId)?.clientId ?? null
      if (!target && mandateId && workspace.durable) {
        try {
          const data = await loadMandates(
            { actorId: workspace.actor.id, context: workspace.context },
            { mandateId },
          )
          target = data.selected?.mandate.clientId ?? null
        } catch {
          // The client directory performs its own authorization checks.
        }
      }
      if (cancelled) return
      try {
        await onNavigate('clients', target
          ? { client: target, record: recordId, mandate: mandateId, clientTab: 'activities' }
          : {})
      } catch {
        if (!cancelled) setMessage('Le dossier ne peut pas être ouvert. Revenez aux dossiers clients.')
      }
    }
    void go()
    return () => { cancelled = true }
  }, [clientId, mandateId, recordId, onNavigate, workspace.actor.id, workspace.context, workspace.durable, workspace.records])

  return <p role="status" className="rounded-xl border border-[#eadfd2] bg-white p-4 text-sm">{message}</p>
}
