'use client'

import { useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import type { ClinicalNoteContent, ClinicalNoteSummary } from '@/lib/clinical-core/types'
import { clinicalFixtureNoteText } from '@/lib/clinical-workspace/noteCopy'
import { clinicalInput } from './styles'

export function ClinicalNoteCopy({ note, content, dirty }: { note: ClinicalNoteSummary; content: ClinicalNoteContent; dirty: boolean }) {
  const text = clinicalFixtureNoteText(note, content, dirty)
  const area = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const [copiedText, setCopiedText] = useState('')
  const [fallback, setFallback] = useState(false)
  return <details className="mt-5 rounded-xl border border-[#dfd0bf] bg-[#f8f3ec] p-4"><summary className="cursor-pointer text-sm font-semibold text-[#805738]">Aperçu du texte et copie de la note fictive</summary>
    <p className="mt-3 text-xs leading-5 text-[#8a6f5d]">{dirty ? 'Cet aperçu contient des modifications locales qui ne sont pas encore sauvegardées.' : 'Cet aperçu correspond à la rédaction affichée.'} Le marquage fictif est conservé dans le texte copié.</p>
    <textarea aria-label="Texte de la note fictive à copier" ref={area} readOnly value={text} rows={12} className={`${clinicalInput} mt-3 font-mono text-xs leading-6`} />
    <button className={`${buttonClass('secondary')} mt-3`} disabled={busy} onClick={async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      setBusy(true); setFallback(false)
      try {
        await Promise.race([navigator.clipboard.writeText(text), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Copie indisponible.')), 1500) })])
        setCopiedText(text)
      } catch { setFallback(true); area.current?.focus(); area.current?.select() }
      finally { if (timer) clearTimeout(timer); setBusy(false) }
    }}><Copy size={15} />{busy ? 'Copie…' : 'Copier la note fictive'}</button>
    {copiedText === text && <p role="status" className="mt-2 text-sm text-[#456447]">Texte fictif copié.</p>}
    {fallback && <p role="status" className="mt-2 text-sm text-[#805738]">La copie automatique est indisponible. Copiez manuellement le texte sélectionné.</p>}
  </details>
}
