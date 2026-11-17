'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import type { DurableCalendarOffice } from '@/lib/clinical-calendar/durableTypes'
import { officeDisplayName } from './officeModel'
import { frenchDay, type CalendarView } from './model'

export function CalendarDateNavigation({ day, days, view, views = ['day', 'week', 'month'], disabled, onStep, onToday, onView }: {
  day: string; days: string[]; view: CalendarView; views?: CalendarView[]; disabled: boolean
  onStep: (direction: number) => void; onToday: () => void; onView: (view: CalendarView) => void
}) {
  const heading = view === 'month' ? new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00Z')) : view === 'week' ? frenchDay(days[0], true) + ' — ' + frenchDay(days.at(-1)!, true) : frenchDay(day)
  return <div className="flex flex-wrap items-center gap-2">
    <div className="flex items-center gap-1"><button type="button" style={{ width: 40, minWidth: 40, flex: '0 0 40px' }} className={buttonClass('ghost')} disabled={disabled} aria-label="Période précédente" onClick={() => onStep(-1)}><ChevronLeft size={18} /></button><button type="button" style={{ width: 'auto' }} className={buttonClass('secondary')} disabled={disabled} onClick={onToday}>Aujourd’hui</button><button type="button" style={{ width: 40, minWidth: 40, flex: '0 0 40px' }} className={buttonClass('ghost')} disabled={disabled} aria-label="Période suivante" onClick={() => onStep(1)}><ChevronRight size={18} /></button></div>
    <strong className="text-sm capitalize">{heading}</strong><div className="flex flex-wrap gap-1">{views.map(value => <button key={value} type="button" style={{ width: 'auto' }} className={buttonClass(view === value ? 'primary' : 'secondary')} disabled={disabled} aria-pressed={view === value} onClick={() => onView(value)}>{value === 'day' ? 'Jour' : value === 'week' ? 'Semaine' : 'Mois'}</button>)}</div>
  </div>
}
export function OfficeSelection({ offices, selected, colors, disabled, onChange }: { offices: DurableCalendarOffice[]; selected: string[]; colors: Record<string, string>; disabled: boolean; onChange: (ids: string[]) => void }) {
  return <fieldset disabled={disabled} className="mt-4 min-w-0"><legend className="sr-only">Bureaux affichés</legend><div className="mb-3 flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold">Bureaux affichés</span><button type="button" style={{ width: 'auto' }} className={buttonClass('primary')} onClick={() => onChange(offices.map(office => office.id))}>Tous les bureaux</button><button type="button" style={{ width: 'auto' }} className={buttonClass('secondary')} onClick={() => onChange([])}>Tout désélectionner</button></div><div className="flex flex-wrap gap-2">{offices.map(office => <label key={office.id} className={'inline-flex min-h-10 max-w-full cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ' + (selected.includes(office.id) ? 'border-[#ac7951] bg-[#faf3e9]' : 'border-[#e4d8c9] bg-white')}><input type="checkbox" checked={selected.includes(office.id)} onChange={event => onChange(event.target.checked ? [...selected, office.id] : selected.filter(id => id !== office.id))} /><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors[office.id] }} /><span className="min-w-0 break-words">{officeDisplayName(office)}{office.active ? '' : ' (inactif)'}</span></label>)}</div>{!offices.length && <p className="text-sm text-[#8a6f5d]">Aucun bureau accessible pour cette période.</p>}</fieldset>
}
