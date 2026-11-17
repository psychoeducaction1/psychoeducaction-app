import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import ts from 'typescript'
import * as preferences from '../lib/professionalPreferences.ts'
import * as exclusions from '../lib/professionalExclusions.ts'

test('exclusions : les anciens commentaires et formats inconnus restent intacts', () => {
  for (const comment of ['', 'Ne prend pas certains mandats.\nExceptions sur discussion.', 'Motifs exclus : motif inconnu\n\nPrécision']) {
    assert.deepEqual(exclusions.readProfessionalExclusions(comment), { motifs: [], comment })
    assert.equal(exclusions.writeProfessionalExclusions([], comment), comment)
  }
})

test('exclusions : tous les motifs acceptés sont disponibles et conservés avec le commentaire', () => {
  const motifs = preferences.motifOptions.map(option => option.value)
  const comment = '  Limite fictive à préciser.\nDeuxième ligne.  '
  const text = exclusions.writeProfessionalExclusions(motifs, comment)
  assert.deepEqual(exclusions.readProfessionalExclusions(text), { motifs, comment })
  for (const option of preferences.motifOptions) assert.ok(text.includes(option.label))
  assert.deepEqual(exclusions.readProfessionalExclusions(exclusions.writeProfessionalExclusions(['sleep'], '')), { motifs: ['sleep'], comment: '' })
})

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (typeof node.type === 'function') return elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)]
}

test('éditeur : mêmes choix, cocher et décocher sans perdre le commentaire ni les motifs acceptés', () => {
  const exports: Record<string, unknown> = {}, require = createRequire(import.meta.url)
  const source = readFileSync(new URL('../components/ProfessionalPreferencesEditor.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, require: (specifier: string) => {
    if (specifier === 'react/jsx-runtime') return require(specifier)
    if (specifier === 'lucide-react') return { Plus: () => null, Trash2: () => null }
    if (specifier === '@/lib/professionalPreferences') return preferences
    if (specifier === '@/lib/professionalExclusions') return exclusions
    throw new Error('Unexpected editor import: ' + specifier)
  } })
  const Component = exports.ProfessionalPreferencesEditor as (props: Record<string, unknown>) => ReactElement
  let value = { ...preferences.emptyStructuredPreferences, pref_motifs: ['anxiety'], pref_exclusions: 'Ancien commentaire fictif.' }
  const render = () => Component({ value, onChange: (next: typeof value) => { value = next } })
  const group = (title: string) => elements(render()).find(element => element.type === 'fieldset' && Children.toArray(element.props.children as ReactNode).some(child => isValidElement<{ children: ReactNode }>(child) && child.type === 'legend' && child.props.children === title))!
  const inputs = (title: string) => elements(group(title)).filter(element => element.type === 'input')
  assert.equal(inputs('Motifs non pris en charge').length, preferences.motifOptions.length)
  assert.equal(inputs('Motifs et champs d’intérêt').length, preferences.motifOptions.length)
  const change = (checked: boolean) => {
    const input = inputs('Motifs non pris en charge')[0]
    ;(input.props.onChange as (event: unknown) => void)({ target: { checked } })
  }
  change(true)
  assert.deepEqual(exclusions.readProfessionalExclusions(value.pref_exclusions), { motifs: ['anxiety'], comment: 'Ancien commentaire fictif.' })
  assert.equal(inputs('Motifs non pris en charge')[0].props.checked, true)
  const textarea = elements(render()).find(element => element.type === 'textarea' && element.props.value === 'Ancien commentaire fictif.')!
  ;(textarea.props.onChange as (event: unknown) => void)({ target: { value: 'Commentaire modifié.' } })
  assert.deepEqual(exclusions.readProfessionalExclusions(value.pref_exclusions), { motifs: ['anxiety'], comment: 'Commentaire modifié.' })
  change(false)
  assert.equal(value.pref_exclusions, 'Commentaire modifié.')
  assert.deepEqual(value.pref_motifs, ['anxiety'])
})
