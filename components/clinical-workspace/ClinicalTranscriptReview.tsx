'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { TRANSCRIPT_REVIEW_PAGE_SIZE, TRANSCRIPT_SPEAKERS, transcriptReviewWarnings } from '@/lib/clinical-workspace/transcriptReview'
import type { ReviewedTranscriptSegment, TranscriptSpeaker } from '@/lib/clinical-workspace/transcriptReview'

export function ClinicalTranscriptReview({ segments, durationMs, reviewedPages, onEdit, onPageReview, onSeek, disabled }: {
  segments: ReviewedTranscriptSegment[]
  durationMs?: number
  reviewedPages: ReadonlySet<number>
  onEdit: (index: number, change: Partial<Pick<ReviewedTranscriptSegment, 'text' | 'speaker'>>) => void
  onPageReview: (page: number, checked: boolean) => void
  onSeek?: (startSeconds: number, endSeconds: number) => void
  disabled: boolean
}) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(segments.length / TRANSCRIPT_REVIEW_PAGE_SIZE)
  const current = Math.min(page, Math.max(0, pages - 1))
  const first = current * TRANSCRIPT_REVIEW_PAGE_SIZE
  const warnings = transcriptReviewWarnings(segments, durationMs)
  const flagged = (index: number) => warnings.filter(warning => warning.firstIndex !== null
    && warning.lastIndex !== null && index >= warning.firstIndex && index <= warning.lastIndex).map(warning => warning.reason)
  const timestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  }
  return <section className="space-y-3 rounded-xl border border-[#dfd0bf] bg-white p-4" aria-label="Révision de la transcription horodatée">
    <div><h3 className="font-semibold">Réviser la transcription horodatée</h3>
      <p className="mt-1 text-xs text-[#6c5a4d]">Les locuteurs ne sont jamais attribués automatiquement. Laissez « Non attribué » en cas de doute; vérifiez les négations, les chiffres et les corrections orales.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><span>{segments.length} passages · page {current + 1} sur {pages} · {reviewedPages.size}/{pages} pages relues</span>
      <div className="flex gap-2"><button type="button" className={buttonClass('secondary')} disabled={current === 0} onClick={() => setPage(current - 1)}>Précédente</button><button type="button" className={buttonClass('secondary')} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Suivante</button></div></div>
    {warnings.length > 0 && <details className="rounded-lg border border-amber-300 bg-amber-50 p-3" open>
      <summary className="cursor-pointer font-medium">{warnings.length} passage(s) à vérifier en priorité</summary>
      <p className="mt-2 text-xs">Ces indices ne prouvent pas qu’un propos est faux. Écoutez et corrigez les passages; aucun mot n’est supprimé automatiquement.</p>
      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{warnings.map((warning, index) => <div key={`${warning.startMs}-${warning.endMs}-${index}`} className="flex flex-wrap items-center gap-2 border-t border-amber-200 pt-2 text-xs">
        <span className="font-medium">{timestamp(warning.startMs)}–{timestamp(warning.endMs)}</span><span>{warning.reason}</span>
        {warning.firstIndex !== null && <button type="button" className="underline" onClick={() => setPage(Math.floor(warning.firstIndex! / TRANSCRIPT_REVIEW_PAGE_SIZE))}>Voir le texte</button>}
        {onSeek && <button type="button" className="underline" disabled={disabled} onClick={() => onSeek(warning.startMs / 1000, warning.endMs / 1000)}>Écouter</button>}
      </div>)}</div>
    </details>}
    <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">{segments.slice(first, first + TRANSCRIPT_REVIEW_PAGE_SIZE).map((segment, offset) => {
      const index = first + offset
      const reasons = flagged(index)
      const minute = Math.floor(segment.startMs / 60_000)
      const second = String(Math.floor(segment.startMs / 1000) % 60).padStart(2, '0')
      return <div key={index} className={`rounded-lg border p-3 ${reasons.length ? 'border-amber-400 bg-amber-50' : 'border-[#e8dbca]'}`}><div className="mb-2 flex flex-wrap items-center gap-3">
        {onSeek ? <button type="button" className={buttonClass('secondary')} disabled={disabled} onClick={() => onSeek(segment.startMs / 1000, segment.endMs / 1000)}>Écouter {minute}:{second}</button> : <span className="text-xs text-[#6c5a4d]">{minute}:{second}</span>}
        <label>Voix <select className="ml-2 rounded-lg border border-[#dfd0bf] bg-white p-2" value={segment.speaker} disabled={disabled} onChange={event => onEdit(index, { speaker: event.target.value as TranscriptSpeaker })}>
          {TRANSCRIPT_SPEAKERS.map(speaker => <option key={speaker} value={speaker}>{speaker}</option>)}</select></label></div>
        {reasons.length > 0 && <p role="status" className="mb-2 text-xs font-medium text-amber-900">À vérifier : {reasons.join(' ')}</p>}
        <label className="block">Texte transcrit<textarea className="mt-1 min-h-20 w-full rounded-lg border border-[#dfd0bf] p-2" value={segment.text} maxLength={2_000} disabled={disabled} onChange={event => onEdit(index, { text: event.target.value })} /></label>
      </div>
    })}</div>
    <label className="flex gap-2"><input type="checkbox" checked={reviewedPages.has(current)} disabled={disabled || segments.slice(first, first + TRANSCRIPT_REVIEW_PAGE_SIZE).some(segment => !segment.text.trim())} onChange={event => onPageReview(current, event.target.checked)} />J’ai relu et corrigé cette page; les voix incertaines restent non attribuées.</label>
  </section>
}
