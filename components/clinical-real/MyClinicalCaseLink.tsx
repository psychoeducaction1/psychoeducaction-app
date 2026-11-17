'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { realWorkspaceRequest } from '@/lib/clinical-real/workspaceClient'
import { clinicalSessionFetch, isUnifiedClinicalClient } from '@/lib/clinical-unification/authClient'
import { isUnifiedAssignmentId, unifiedAssignmentDestination } from '@/lib/clinical-unification/assignmentLink'

/** Ouvre uniquement le dossier que le RPC autorise pour cette assignation. */
export function MyClinicalCaseLink({ assignmentId }: { assignmentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (process.env.NEXT_PUBLIC_PEA_CLINICAL_ASSIGNMENT_NAV !== 'true') return null

  const open = async () => {
    if (busy || !isUnifiedAssignmentId(assignmentId)) return
    setBusy(true)
    setMessage('')
    try {
      type Result = { link: { caseId?: unknown; patientId?: unknown } | null }
      const unified = isUnifiedClinicalClient()
      const request = async (method: 'GET' | 'POST' = 'GET'): Promise<Result> => {
        if (!unified) return realWorkspaceRequest<Result>(`/assignment-link/${assignmentId}`, method)
        const response = await clinicalSessionFetch(`/api/clinical-workspace/assignment-link/${assignmentId}`, { method, headers: { 'X-Clinical-Context': 'clinical' } })
        if (!response.ok) throw new Error('ASSIGNMENT_LINK_UNAVAILABLE')
        return response.json()
      }
      let result = await request()
      if (!result.link) {
        result = await request('POST')
      }
      if (!result.link || !isUnifiedAssignmentId(result.link.caseId)) {
        setMessage('Ce dossier clinique n’est pas accessible. L’assignation reste disponible ici.')
        return
      }
      const destination = unified ? unifiedAssignmentDestination(result.link) : `/clinique/clients/${result.link.caseId}`
      if (!destination) throw new Error('ASSIGNMENT_LINK_INVALID')
      router.push(destination)
    } catch {
      setMessage('Le dossier clinique est momentanément indisponible. Réessayez plus tard.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-3">
    <button type="button" onClick={() => void open()} disabled={busy}
      className="rounded-xl border border-[#8a5633] bg-white px-3 py-2 text-sm font-medium text-[#6d3f1f] hover:bg-[#f5e9d9] disabled:opacity-60">
      {busy ? 'Ouverture…' : 'Ouvrir le dossier clinique'}
    </button>
    {message && <p role="status" className="mt-2 text-sm text-[#6c5a4d]">{message}</p>}
  </div>
}
