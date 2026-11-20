'use client'

import { useEffect, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { ProfessionalClientRow } from '@/lib/clinical-admission/professionalClients'
import type { WorkspaceView } from '@/lib/clinical-core/types'

const migrationKeepProfessional = '3c514611-b530-4f48-84e4-32871b32f320'

export function ProfessionalImportReview({ actorId, professionalId, rows }: {
  actorId: WorkspaceView['actor']['id']; professionalId: string; rows: ProfessionalClientRow[]
}) {
  const [opened, setOpened] = useState(false)
  const [receipts, setReceipts] = useState<Set<string> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    void clinicalRequest<{patientIds: string[]}>({ actorId, context: 'administration' }, '/admission/import-receipts/' + professionalId,
      undefined, 'GET', controller.signal).then(value => {
      if (!controller.signal.aborted) { setReceipts(new Set(value.patientIds)); setError('') }
    }).catch(cause => {
      if (!controller.signal.aborted) { setReceipts(null); setError(cause instanceof Error ? cause.message : 'La provenance est indisponible.') }
    })
    return () => controller.abort()
  }, [opened, actorId, professionalId])

  return <details className="mt-4 rounded-lg border p-3" onToggle={event => {
    if (!event.currentTarget.open) { setReceipts(null); setError('') }
    setOpened(event.currentTarget.open)
  }}>
    <summary className="cursor-pointer font-semibold">Aperçu des entrées à conserver ou à retirer de la liste</summary>
    {opened && <div className="mt-3 text-sm">
      {error ? <p role="alert">{error}</p> : !receipts ? <p role="status">Vérification des reçus de migration…</p> :
        <ul className="grid gap-1">{rows.map(row => {
          const imported = row.clientId !== null && receipts.has(row.clientId)
          const keep = professionalId === migrationKeepProfessional && imported
          return <li key={row.key} className="flex flex-wrap justify-between gap-2 border-b py-2"><span>{row.firstName} {row.lastName}</span>
            <span>{keep ? 'À conserver' : 'À retirer de l’affichage'} · {imported ? 'Import confirmé' : 'Sans reçu de migration correspondant'}</span></li>
        })}</ul>}
    </div>}
  </details>
}
