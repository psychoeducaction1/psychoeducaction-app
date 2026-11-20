'use client'

import { useEffect, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalNotePdf } from '@/lib/clinical-workspace/api'

export function ClinicalNotePdf({ noteId, title, workspace }: { noteId: string; title: string; workspace: WorkspaceView }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  async function open() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const pdf = await clinicalNotePdf(workspace.actor.id, workspace.context, noteId)
      setUrl(URL.createObjectURL(pdf))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Le PDF de la note est indisponible.') }
    finally { setBusy(false) }
  }
  return <>
    <button type="button" className={`${buttonClass('ghost')} !px-2 !py-1 text-sm`} disabled={busy} onClick={() => void open()}>{busy ? 'Ouverture…' : 'PDF'}</button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    {url && <div role="dialog" aria-modal="true" aria-label={`PDF de ${title}`} className="fixed inset-0 z-50 flex flex-col bg-black/70 p-2 sm:p-5">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-t-xl bg-white px-4 py-3"><strong className="truncate text-sm">{title}</strong><div className="flex flex-wrap items-center gap-2">
        <a className={buttonClass('ghost')} href={url} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>
        <a className={buttonClass('ghost')} href={url} download={`note-${noteId}.pdf`}>Télécharger</a>
        <button type="button" className={buttonClass('ghost')} onClick={() => setUrl('')}>Fermer</button>
      </div></div>
      <iframe className="mx-auto h-full w-full max-w-5xl rounded-b-xl bg-white" title={`Aperçu PDF de ${title}`} src={url} />
    </div>}
  </>
}
