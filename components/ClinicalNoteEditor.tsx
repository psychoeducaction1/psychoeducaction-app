'use client'

import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import type { ClinicalEngineResult, ClinicalSection } from '@/lib/clinicalNoteEngine'
import { buttonClass } from '@/components/ui/index'

export default function ClinicalNoteEditor({ result, disabled, onChange }: {
  result: ClinicalEngineResult; disabled: boolean; onChange: (sections: ClinicalSection[]) => void
}) {
  const configs = CLINICAL_NOTE_BLUEPRINTS[result.noteType]
  function update(id: string, change: (section: ClinicalSection) => ClinicalSection) {
    onChange(result.draft.sections.map(section => section.id === id ? change(section) : section))
  }
  function sources(ids: string[]) {
    const facts = result.analysis.facts.filter(fact => ids.includes(fact.id))
    return <details className="text-xs leading-5 text-[#7a6859]">
      <summary className="cursor-pointer">Passages sources ({facts.length})</summary>
      <p className="my-2">Références de la génération initiale : revérifiez leur correspondance après chaque correction manuelle.</p>
      {facts.map(fact => <blockquote key={fact.id} className="my-2 border-l-2 border-[#dfd0bf] pl-3"><strong>{fact.id} · {fact.source === 'history' ? 'Contexte antérieur' : fact.source === 'metadata' ? 'Renseignements confirmés' : 'Transcription actuelle'} · {fact.speaker} · {fact.kind}</strong><br />« {fact.quote} »</blockquote>)}
      {!facts.length && <p>Ajout manuel : à rapprocher de la source par le professionnel.</p>}
    </details>
  }
  return <div className="min-w-0 space-y-4">
    <p className="text-sm leading-6 text-[#7a6859]">Les rubriques vides sont absentes de la copie. Les corrections ne sont pas envoyées à l’IA automatiquement. Vous pouvez ajouter, retirer et déplacer les paragraphes.</p>
    {result.draft.sections.map(section => {
      const config = configs.find(item => item.id === section.id)!
      const populated = section.paragraphs.length > 0 || section.rows.length > 0
      return <details key={section.id} open={populated || undefined} className="min-w-0 rounded-xl border border-[#dfd0bf] p-4">
        <summary className="cursor-pointer font-semibold">{config.title}{!populated && <span className="ml-2 text-xs font-normal text-[#7a6859]">Vide — exclue de la copie</span>}</summary>
        <div className="mt-3 min-w-0 space-y-3">
          {config.guidance && <p className="text-xs leading-5 text-[#7a6859]">{config.guidance}</p>}
          {section.paragraphs.map((paragraph, index) => <div key={index} className="space-y-2 rounded-lg bg-[#fbf6ef] p-3">
            <label className="block text-sm">{config.title} — paragraphe {index + 1}<textarea value={paragraph.text} disabled={disabled} maxLength={4_000} className="mt-2 min-h-28 w-full rounded-lg border border-[#dfd0bf] bg-white p-3 leading-6" onChange={event => update(section.id, current => ({ ...current, paragraphs: current.paragraphs.map((item, i) => i === index ? { ...item, text: event.target.value } : item) }))} /></label>
            {sources(paragraph.factIds)}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass('secondary')} disabled={disabled} onClick={() => update(section.id, current => ({ ...current, paragraphs: current.paragraphs.filter((_, i) => i !== index) }))}>Retirer le paragraphe {index + 1}</button>
              <label className="min-w-0 text-xs">Déplacer ce paragraphe<select value="" disabled={disabled} className="ml-2 max-w-full rounded-lg border border-[#dfd0bf] bg-white p-2" onChange={event => {
                const target = event.target.value
                if (!target) return
                onChange(result.draft.sections.map(current => current.id === section.id ? { ...current, paragraphs: current.paragraphs.filter((_, i) => i !== index) } : current.id === target ? { ...current, paragraphs: [...current.paragraphs, paragraph] } : current))
              }}><option value="">Choisir une rubrique</option>{configs.filter(item => !item.columns && item.id !== section.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            </div>
          </div>)}
          {section.rows.map((row, index) => <div key={index} className="space-y-2 rounded-lg bg-[#fbf6ef] p-3">
            <p className="text-sm font-medium">Ligne {index + 1}</p>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">{config.columns?.map((column, cellIndex) => <label key={column} className="min-w-0 text-sm">{column}<textarea disabled={disabled} value={row.cells[cellIndex]} maxLength={2_000} className="mt-1 min-h-24 w-full rounded-lg border border-[#dfd0bf] bg-white p-2" onChange={event => update(section.id, current => ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, cells: item.cells.map((cell, j) => j === cellIndex ? event.target.value : cell) } : item) }))} /></label>)}</div>
            {sources(row.factIds)}
            <button type="button" className={buttonClass('secondary')} disabled={disabled} onClick={() => update(section.id, current => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))}>Retirer la ligne {index + 1}</button>
          </div>)}
          <button type="button" className={buttonClass('secondary')} disabled={disabled || (config.columns ? section.rows.length : section.paragraphs.length) >= 20} onClick={() => update(section.id, current => config.columns ? { ...current, rows: [...current.rows, { cells: config.columns.map(() => ''), factIds: [] }] } : { ...current, paragraphs: [...current.paragraphs, { text: '', factIds: [] }] })}>{config.columns ? 'Ajouter une ligne' : 'Ajouter un paragraphe'}</button>
        </div>
      </details>
    })}
  </div>
}
