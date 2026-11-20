'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { useClinicalFormGuard, useClinicalNavigation } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { listProcedurePdfs, readProcedurePdf, saveProcedurePdf, ProcedureError } from '@/lib/procedures/client'
import { procedurePdfMaxBytes, validProcedurePdfName, type ProcedurePdf, type ProcedurePdfInput } from '@/lib/procedures/pdfModel'

export function ProcedurePdfs({ articleId, canEdit, onEditorChange }: { articleId: string; canEdit: boolean; onEditorChange: (open: boolean) => void }) {
  const [files, setFiles] = useState<ProcedurePdf[]>([]), [editable, setEditable] = useState(false)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [editing, setEditing] = useState<{ documentId: string; expectedVersion: number; label: string } | null>(null)
  const [viewer, setViewer] = useState<{ url: string; file: ProcedurePdf } | null>(null)
  const navigation = useClinicalNavigation(), active = useRef(true), sequence = useRef(0), objectUrl = useRef<string | null>(null), request = useRef<AbortController | null>(null)
  const cleanup = useCallback(() => { active.current = false; ++sequence.current; request.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])
  const closeViewer = useCallback(() => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; setViewer(null) }, [])
  const denied = useCallback((cause: unknown) => {
    if (cause instanceof ProcedureError && [401, 403].includes(cause.status)) { setFiles([]); setEditable(false); setEditing(null); closeViewer() }
    setError(cause instanceof Error ? cause.message : 'Documents indisponibles.')
  }, [closeViewer])
  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true); setError('')
    try { const next = await listProcedurePdfs(articleId); if (active.current && current === sequence.current) { setFiles(next.files); setEditable(next.canEdit); return true } }
    catch (cause) { if (active.current && current === sequence.current) denied(cause) }
    finally { if (active.current && current === sequence.current) setLoading(false) }
    return false
  }, [articleId, denied])
  useEffect(() => {
    active.current = true; void load()
    return cleanup
  }, [load, cleanup])
  useEffect(() => { onEditorChange(Boolean(editing)); return () => onEditorChange(false) }, [editing, onEditorChange])
  const open = async (file: ProcedurePdf, download: boolean) => {
    if (busy) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const blob = await readProcedurePdf(file.id, controller.signal)
      if (!active.current || controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      if (download) {
        const link = document.createElement('a'); link.href = url; link.download = file.fileName; document.body.appendChild(link); link.click(); link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else { closeViewer(); objectUrl.current = url; setViewer({ url, file }) }
    } catch (cause) { if (active.current && !controller.signal.aborted) denied(cause) }
    finally { if (active.current) setBusy(false) }
  }
  const closeEditor = async () => { if (await navigation.canLeave()) setEditing(null) }
  const latest = files.filter(file => !files.some(other => other.documentId === file.documentId && other.version > file.version))
  const fileRow = (file: ProcedurePdf, replacement = false) => <div key={file.id} className="rounded-xl border border-[#eadfd2] p-3"><p className="font-medium">{file.label}</p><p className="mt-1 break-words text-xs text-[#8a6f5d]">{file.fileName} · version {file.version} · {Math.ceil(file.byteLength / 1024)} Ko · {new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' }).format(new Date(file.createdAt))}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={() => void open(file, false)}>Consulter</button><button type="button" className={buttonClass('ghost')} disabled={busy} onClick={() => void open(file, true)}>Télécharger</button>{replacement && canEdit && editable && <button type="button" className={buttonClass('ghost')} onClick={() => setEditing({ documentId: file.documentId, expectedVersion: file.version, label: file.label })}>Remplacer le PDF</button>}</div></div>
  return <section className="mt-6 border-t border-[#eadfd2] pt-5" aria-label="Documents PDF"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Documents PDF</h3>{canEdit && editable && <button type="button" className={buttonClass('secondary')} onClick={() => setEditing({ documentId: crypto.randomUUID(), expectedVersion: 0, label: '' })}>Joindre un PDF</button>}</div>
    {loading && <p role="status" className="mt-3 text-sm">Chargement des documents…</p>}{busy && <p role="status" className="mt-3 text-sm">Ouverture du document…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}<button type="button" className={buttonClass('ghost')} onClick={() => void load()}>Actualiser</button></p>}{message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!loading && !files.length && !error && <p className="mt-3 text-sm text-[#8a6f5d]">Aucun PDF joint à cette procédure.</p>}
    <div className="mt-3 grid gap-3">{latest.map(file => <div key={file.id}>{fileRow(file, true)}{files.some(old => old.documentId === file.documentId && old.version < file.version) && <details className="mt-2 text-sm"><summary className="cursor-pointer">Versions précédentes</summary><div className="mt-2 grid gap-2">{files.filter(old => old.documentId === file.documentId && old.version < file.version).sort((a,b) => b.version-a.version).map(old => fileRow(old))}</div></details>}</div>)}</div>
    {viewer && <ProspectDialog title={viewer.file.label} onClose={closeViewer}><p className="mb-3 text-sm">Version {viewer.file.version} · {viewer.file.fileName}</p><iframe title={viewer.file.label} src={viewer.url} className="h-[65vh] w-full rounded-lg border" /><p className="mt-3 text-sm">Si l’aperçu n’est pas pris en charge par votre navigateur, téléchargez le PDF.</p><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={() => void open(viewer.file, true)}>Télécharger le PDF</button></ProspectDialog>}
    {editing && canEdit && editable && <ProspectDialog title={editing.expectedVersion ? 'Remplacer le PDF' : 'Joindre un PDF'} onClose={() => void closeEditor()}><PdfEditor key={editing.documentId} articleId={articleId} value={editing} onCancel={() => void closeEditor()} onDenied={denied} onSaved={async () => { setEditing(null); const refreshed = await load(); if (active.current) setMessage(refreshed ? 'PDF enregistré.' : 'PDF enregistré. Actualisez la liste sans renvoyer le fichier.') }} /></ProspectDialog>}
  </section>
}

function PdfEditor({ articleId, value, onCancel, onSaved, onDenied }: { articleId: string; value: { documentId: string; expectedVersion: number; label: string }; onCancel: () => void; onSaved: () => Promise<void>; onDenied: (cause: unknown) => void }) {
  const [label, setLabel] = useState(value.label), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const guard = useClinicalFormGuard(Boolean(file || label !== value.label), busy), pending = useRef(false), intent = useRef<{ signature: string; id: string } | null>(null)
  return <form className="grid gap-4" onSubmit={async event => {
    event.preventDefault(); if (pending.current || !file) return
    pending.current = true; setBusy(true); guard.markPending(); setError('')
    try {
      if (!validProcedurePdfName(file.name) || file.size > procedurePdfMaxBytes || !file.size || file.type && file.type !== 'application/pdf') throw new Error('Choisissez un PDF de 3 Mo maximum.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''; for (let offset=0; offset<bytes.length; offset+=8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192))
      const bytesBase64 = btoa(binary), signature = JSON.stringify([label, file.name, bytesBase64])
      if (intent.current?.signature !== signature) intent.current = { signature, id: crypto.randomUUID() }
      const input: ProcedurePdfInput = { id: intent.current.id, articleId, documentId: value.documentId, expectedVersion: value.expectedVersion, label, fileName: file.name, mediaType: 'application/pdf', bytesBase64 }
      await saveProcedurePdf(input); guard.markSaved(); await onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement non confirmé.'); if (cause instanceof ProcedureError && [401,403].includes(cause.status)) onDenied(cause) }
    finally { pending.current = false; guard.markSettled(); setBusy(false) }
  }}><p className="text-sm text-[#8a6f5d]">PDF de 3 Mo maximum : guides et modèles vierges. Le remplacement conserve les versions précédentes.</p><label className={clinicalLabel}>Titre du document<input required maxLength={160} className={clinicalInput} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} /></label><label className={clinicalLabel}>Fichier PDF<input required type="file" accept="application/pdf,.pdf" className={clinicalInput} disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); intent.current = null }} /></label>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex gap-2"><button className={buttonClass('primary')} disabled={busy || !file}>{busy ? 'Enregistrement…' : 'Enregistrer le PDF'}</button><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onCancel}>Annuler</button></div></form>
}
