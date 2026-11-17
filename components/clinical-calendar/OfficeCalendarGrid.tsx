'use client'

import { useEffect, useRef } from 'react'
import type { DurableCalendarOffice } from '@/lib/clinical-calendar/durableTypes'
import { frenchDay } from './model'
import { firstFreeMinuteInOfficeSegments, officeClock, officeDayTimeline, officeSegments, officeSlotAtElapsed, type OfficeDayTimeline, type OfficeOccupation } from './officeModel'

type OfficeGridProps = {
  days: string[]; offices: DurableCalendarOffice[]; colors: Record<string, string>; occupations: OfficeOccupation[]; disabled: boolean
  canReserve: (officeId: string, day: string) => boolean; onSlot: (day: string, minute: number, officeId: string, disambiguation?: 'earlier' | 'later') => void
}
const scale = 2
function OfficeLane({ day, office, timeline, code, color, occupations, disabled, reservable, showClock, onSlot }: {
  day: string; office: DurableCalendarOffice; timeline: OfficeDayTimeline; code: string; color: string; occupations: OfficeOccupation[]
  disabled: boolean; reservable: boolean; showClock: boolean; onSlot: OfficeGridProps['onSlot']
}) {
  const segments = officeSegments(occupations, office.id, day)
  const freeMinute = (start: number, end: number) => firstFreeMinuteInOfficeSegments(segments, start, end, timeline.minutes)
  return <div className={'relative min-w-0 flex-1 border-l border-[#eadfd2] ' + (reservable ? '' : 'bg-[#f6f4f1]')} data-office-lane={office.id} aria-label={code + ' · ' + office.name}>
    {Array.from({ length: Math.ceil(timeline.minutes / 30) }, (_, half) => {
      const free = freeMinute(half * 30, (half + 1) * 30), point = free === null ? null : officeSlotAtElapsed(day, free)
      const time = point ? String(Math.floor(point.minute / 60)).padStart(2, '0') + ':' + String(point.minute % 60).padStart(2, '0') + (point.disambiguation ? point.disambiguation === 'earlier' ? ' (première occurrence)' : ' (deuxième occurrence)' : '') : ''
      return <button key={half} type="button" disabled={disabled || !reservable || free === null} className={'absolute right-0 border-t border-[#eadfd2]/75 bg-transparent hover:bg-[#dfc5a4]/25 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[#8a5633] disabled:cursor-default ' + (showClock ? 'left-14' : 'left-0')} style={{ top: half * 30 * scale, height: Math.min(30, timeline.minutes - half * 30) * scale }}
        aria-label={(reservable && point ? 'Réserver ' + time : 'Indisponible') + (showClock ? ' · ' : ' · ' + code + ' · ') + office.name + ' · ' + frenchDay(day)}
        onClick={event => {
          const pointerMinute = event.detail ? half * 30 + Math.max(0, Math.min(29, Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / scale))) : free
          const minute = pointerMinute === null ? null : freeMinute(pointerMinute, (half + 1) * 30)
          if (minute === null) return
          const selected = officeSlotAtElapsed(day, minute)
          if (selected.disambiguation) onSlot(selected.day, selected.minute, office.id, selected.disambiguation)
          else onSlot(selected.day, selected.minute, office.id)
        }} />
    })}
    {segments.map((segment, index) => <div key={segment.row.startAt + ':' + index} role="img" className={'absolute z-[2] overflow-hidden rounded border text-white ' + (showClock ? 'right-1 left-14 px-1 text-[11px]' : 'inset-x-px text-center text-[9px]')} style={{ top: segment.start * scale, height: (segment.end - segment.start) * scale, backgroundColor: color, borderColor: color }} title={(showClock ? '' : code + ' · ') + office.name + ' · Occupé · ' + officeClock(segment.row.startAt) + '–' + officeClock(segment.row.endAt)} aria-label={(showClock ? '' : code + ' · ') + office.name + ' · Occupé de ' + officeClock(segment.row.startAt) + ' à ' + officeClock(segment.row.endAt)}>
      {segment.end - segment.start >= 6 && <p className="truncate font-semibold">{showClock ? 'Occupé' : code}</p>}{showClock && segment.end - segment.start >= 24 && <p className="truncate">{officeClock(segment.row.startAt)}–{officeClock(segment.row.endAt)}</p>}
    </div>)}
  </div>
}
function OfficeTimelineMarks({ timeline, maximum, compact }: { timeline: OfficeDayTimeline; maximum: number; compact: boolean }) {
  return <>
    {timeline.ticks.map(tick => <div key={tick.minute} className="pointer-events-none absolute inset-x-0 z-[1] border-t border-[#eadfd2]" style={{ top: tick.minute * scale }}><span className={'absolute left-0 bg-[#fffaf3] py-0.5 pl-1 text-[#795f4d] ' + (compact ? 'w-10 text-[9px]' : 'w-[52px] text-[10px]')}>{tick.label}</span></div>)}
    {timeline.minutes < maximum && <div aria-label="Hors de cette journée ; aucune réservation" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#d8cbbb] bg-[#f0ece6]" style={{ top: timeline.minutes * scale, height: (maximum - timeline.minutes) * scale }} />}
  </>
}
export function OfficeCalendarGrid({ days, offices, colors, occupations, disabled, canReserve, onSlot }: OfficeGridProps) {
  const scroll = useRef<HTMLDivElement>(null), week = days.length > 1
  const daily = days.map(day => ({ day, timeline: officeDayTimeline(day) }))
  const columns = week ? daily : daily.flatMap(column => offices.map(office => ({ ...column, office })))
  const maximum = Math.max(0, ...daily.map(column => column.timeline.minutes)), clockChange = daily.some(column => column.timeline.minutes !== 1440)
  const codes = new Map(offices.map((office, index) => [office.id, 'B' + (index + 1)]))
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * 60 * scale }, [days.length])
  if (!offices.length) return <p className="rounded-xl border border-[#eadfd2] p-5 text-sm">Sélectionnez au moins un bureau pour afficher ses disponibilités.</p>
  return <div className="grid min-w-0 gap-2">
    {week && <div aria-label="Repères des bureaux" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{offices.map(office => <span key={office.id} className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[office.id] }} /><strong>{codes.get(office.id)}</strong><span>· {office.name}</span></span>)}</div>}
    {clockChange && <p className="text-xs text-[#795f4d]">Changement d’heure : repérez les heures locales dans chaque colonne. Les heures répétées sont distinguées ; aucune plage n’est proposée pour une heure inexistante.</p>}
    <div ref={scroll} role="region" tabIndex={0} aria-label="Disponibilité des bureaux ; heures locales de Montréal dans chaque colonne, défilement entre les jours ou bureaux et les heures" className="isolate max-h-[min(70dvh,720px)] min-w-0 overflow-auto overscroll-contain rounded-xl border border-[#dfd0bf] bg-white">
      <div className="grid min-w-full" data-office-view={week ? 'week' : 'day'} style={{ gridTemplateColumns: 'repeat(' + columns.length + ', minmax(' + (week ? 110 : 176) + 'px, 1fr))' }}>
        {week ? daily.map(({ day }) => <div key={day} className="sticky top-0 z-20 min-w-0 border-b border-l bg-[#fffaf3] pt-2 text-xs font-semibold"><p className="px-1 pb-2 text-center">{frenchDay(day, true)}</p><div className="flex pl-10">{offices.map(office => <span key={office.id} className="min-w-0 flex-1 border-l text-center text-[9px]" style={{ borderTop: '3px solid ' + colors[office.id] }} title={office.name} aria-label={codes.get(office.id) + ' · ' + office.name}>{codes.get(office.id)}</span>)}</div></div>)
          : offices.map(office => <div key={days[0] + office.id} className="sticky top-0 z-20 min-w-0 border-b border-l bg-[#fffaf3] px-2 py-2 text-xs font-semibold" style={{ borderTop: '4px solid ' + colors[office.id] }}><p>{frenchDay(days[0], true)}</p><p className="mt-1 truncate">{office.name}</p></div>)}
        {week ? daily.map(({ day, timeline }) => <div key={day} data-office-day={day} className="relative min-w-0 border-l border-[#eadfd2]" style={{ height: maximum * scale }}><OfficeTimelineMarks timeline={timeline} maximum={maximum} compact /><div className="absolute inset-y-0 right-0 left-10 flex">{offices.map(office => <OfficeLane key={office.id} day={day} office={office} timeline={timeline} code={codes.get(office.id)!} color={colors[office.id]} occupations={occupations} disabled={disabled} reservable={office.active && canReserve(office.id, day)} showClock={false} onSlot={onSlot} />)}</div></div>)
          : daily.flatMap(({ day, timeline }) => offices.map(office => <div key={day + office.id} data-office-day={day} className="relative min-w-0" style={{ height: maximum * scale }}><OfficeTimelineMarks timeline={timeline} maximum={maximum} compact={false} /><div className="absolute inset-0 flex"><OfficeLane day={day} office={office} timeline={timeline} code={codes.get(office.id)!} color={colors[office.id]} occupations={occupations} disabled={disabled} reservable={office.active && canReserve(office.id, day)} showClock onSlot={onSlot} /></div></div>))}
      </div>
    </div>
  </div>
}