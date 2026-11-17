import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import ts from 'typescript'
import type { DurableCalendarEvent, DurableCalendarOffice, DurableCalendarWorkspace } from '../lib/clinical-calendar/durableTypes.ts'
import { officeDisplayColors, officeOccupations, officeSelectionQuery, selectedOfficeIds } from '../components/clinical-calendar/officeModel.ts'
import * as calendarModel from '../components/clinical-calendar/model.ts'

const officeA: DurableCalendarOffice = { id: 'bureau-a-fictif', name: 'Bureau A fictif', color: '#245f70', active: true, version: 1 }
const officeB: DurableCalendarOffice = { ...officeA, id: 'bureau-b-fictif', name: 'Bureau B fictif', color: '#a65b31' }
const startAt = '2026-10-18T13:00:00Z', endAt = '2026-10-18T13:27:00Z'
const event = { id: 'activité-privée-fictive', officeId: officeA.id, startAt, endAt, status: 'planned', clientName: 'Identité cliente à ne pas projeter', title: 'Motif confidentiel fictif', professionalId: 'acteur-privé' } as DurableCalendarEvent
function fixture(appointments = [event], busy: DurableCalendarWorkspace['busy'] = []) {
  return { offices: [officeA, officeB], appointments, busy }
}
test('bureaux : projection anonyme identique pour réservations propres et collègues, sans doublon ni annulation', () => {
  const rows = officeOccupations(fixture([event, { ...event, status: 'cancelled', officeId: officeB.id }], [{ officeId: officeA.id, startAt, endAt, kind: 'busy' }, { officeId: officeB.id, startAt, endAt, kind: 'busy' }]))
  assert.equal(rows.length, 2)
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['endAt', 'kind', 'officeId', 'startAt'])
  assert.equal(rows[0].startAt, startAt); assert.equal(rows[0].endAt, endAt)
  assert.doesNotMatch(JSON.stringify(rows), /Identité|Motif|acteur-privé|activité-privée|clientName|professionalId|title/)
  assert.deepEqual(officeOccupations(fixture([{ ...event, status: 'cancelled' }])), [])
})
test('bureaux : choix unique, multiple et tous conservés enURL, IDs non autorisés ignorés', () => {
  const offices = [officeA, officeB]
  assert.deepEqual(selectedOfficeIds(null, offices), [officeA.id, officeB.id])
  assert.deepEqual(selectedOfficeIds(officeB.id, offices), [officeB.id])
  assert.deepEqual(selectedOfficeIds([officeB.id, officeA.id, officeB.id, 'bureau-interdit'].join(','), offices), [officeA.id, officeB.id])
  assert.deepEqual(selectedOfficeIds('bureau-interdit', offices), [])
  assert.deepEqual(selectedOfficeIds('none', offices), [])
  assert.equal(officeSelectionQuery([officeB.id], offices), officeB.id)
  assert.equal(officeSelectionQuery([officeB.id, officeA.id], offices), null)
  assert.equal(officeSelectionQuery([], offices), 'none')
})
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (typeof node.type === 'function') return [node, ...elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))]
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)]
}
test('sélecteur : décocher, recocher et tout afficher avec les bureaux autorisés', () => {
  const exports: Record<string, unknown> = {}, require = createRequire(import.meta.url)
  const source = readFileSync(new URL('../components/clinical-calendar/CalendarNavigation.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, require: (specifier: string) => {
    if (specifier === 'react/jsx-runtime') return require(specifier)
    if (specifier === 'lucide-react') return { ChevronLeft: () => null, ChevronRight: () => null }
    if (specifier === '@/components/Ui') return { buttonClass: () => '' }
    if (specifier === './model') return calendarModel
    throw new Error('Unexpected selector import: ' + specifier)
  } })
  const Component = exports.OfficeSelection as (props: Record<string, unknown>) => ReactElement
  const offices = [officeA, officeB]
  let selection = selectedOfficeIds(null, offices)
  const render = (disabled = false) => Component({ offices, selected: selection, colors: officeDisplayColors(offices), disabled, onChange: (ids: string[]) => {
    selection = selectedOfficeIds(officeSelectionQuery(ids, offices), offices)
  } })
  const check = (index: number, checked: boolean) => {
    const inputs = elements(render()).filter(element => element.type === 'input')
    ;(inputs[index].props.onChange as (event: unknown) => void)({ target: { checked } })
  }
  check(0, false)
  assert.deepEqual(selection, [officeB.id])
  assert.equal(elements(render()).filter(element => element.type === 'input')[0].props.checked, false)
  check(1, false)
  assert.deepEqual(selection, [])
  assert.equal(officeSelectionQuery(selection, offices), 'none')
  check(0, true)
  assert.deepEqual(selection, [officeA.id])
  const all = elements(render()).find(element => element.type === 'button')!
  ;(all.props.onClick as () => void)()
  assert.deepEqual(selection, offices.map(office => office.id))
  assert.equal((render(true).props as { disabled: boolean }).disabled, true)
  assert.equal(elements(render()).filter(element => element.type === 'input').length, 2)
  const url = new URLSearchParams({ offices: officeB.id, day: '2026-11-16', view: 'day' })
  url.set('day', '2026-11-23'); url.set('view', 'week')
  assert.deepEqual(selectedOfficeIds(url.get('offices'), offices), [officeB.id])
})
