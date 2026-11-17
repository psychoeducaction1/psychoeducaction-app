'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { ClinicalNoteView, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { ProfessionalSignaturePreview } from './ProfessionalSignaturePad'

type Signature = {
  actorId: string; kind: 'author' | 'supervisor'; signedAt: string
  name: string; title: string; licenseNumber: string
  captured: boolean; strokes: { x: number; y: number }[][]
  imageMediaType: 'image/png' | 'image/jpeg' | null; imageBase64: string | null
}

export function ClinicalNoteSignatures({ note, workspace }: { note: ClinicalNoteView; workspace: WorkspaceView }) {
  const [signatures, setSignatures] = useState<Signature[] | null>(null)
  useEffect(() => {
    if (!workspace.durable || note.signatures.length === 0) return
    let active = true
    void clinicalRequest<{ signatures: Signature[] }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${note.note.id}/signatures`)
      .then(result => { if (active) setSignatures(result.signatures) })
      .catch(() => { if (active) setSignatures(null) })
    return () => { active = false }
  }, [note.note.id, note.signatures.length, workspace.actor.id, workspace.context, workspace.durable])

  if (note.signatures.length === 0) return null
  return <div className="mt-6 border-t border-[#eadfd2] pt-5" aria-label="Signatures de la note">
    <h4 className="text-sm font-semibold text-[#49372b]">Signatures</h4>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">{note.signatures.map(proof => {
      const saved = signatures?.find(item => item.actorId === proof.actorId && item.kind === proof.kind)
      const name = saved?.name || workspace.actors.find(actor => actor.id === proof.actorId)?.displayName || 'Professionnel'
      return <div key={`${proof.actorId}-${proof.version}`} className="rounded-xl border border-[#eadfd2] bg-white p-4 text-sm text-[#49372b]">
        <p className="font-medium">{proof.kind === 'author' ? 'Professionnel signataire' : 'Superviseur cosignataire'}</p>
        {saved?.imageBase64 && saved.imageMediaType && <Image unoptimized width={320} height={80} className="mt-2 h-20 max-w-xs object-contain" alt={`Signature de ${name}`} src={`data:${saved.imageMediaType};base64,${saved.imageBase64}`} />}
        {saved && !saved.imageBase64 && saved.strokes.length > 0 && <ProfessionalSignaturePreview strokes={saved.strokes} />}
        <p className="mt-2 font-semibold">{name}</p>
        {saved?.title && <p>{saved.title}{saved.licenseNumber ? ` · No d’ordre : ${saved.licenseNumber}` : ''}</p>}
        <p className="mt-1 text-xs text-[#7a6859]">Signée le {new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' }).format(new Date(proof.signedAt))}</p>
        {saved && !saved.captured && <p className="mt-1 text-xs text-[#7a6859]">{saved.imageBase64 || saved.strokes.length > 0 ? 'Signature non conservée avec cette note.' : 'Signature manquante dans le dossier du professionnel.'}</p>}
      </div>
    })}</div>
  </div>
}
