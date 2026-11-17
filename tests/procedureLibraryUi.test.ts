import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Children, createElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as model from '../lib/procedures/model.ts'

const require = createRequire(import.meta.url)
const section = { id: '10000000-0000-4000-8000-000000000001', title: 'Section fictive', version: 1, position: 0 }
const article = { id: '20000000-0000-4000-8000-000000000001', sectionId: section.id, title: 'Procédure fictive', body: '<script>Exemple fictif</script>', keywords: ['mot'], status: 'review' as const, version: 1, updatedAt: '2026-11-17T12:00:00Z', sourceTitle: null }
class FixtureError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }

function harness(name: string, initial: unknown[], call: (body: unknown) => Promise<unknown> = async () => ({ id: article.id, version: 2 })) {
  let cursor = 0, refCursor = 0
  const states = [...initial], refs: { current: unknown }[] = []
  const hooks = {
    useState(value: unknown) { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (v: unknown) => unknown)(states[index]) : next }] },
    useRef(value: unknown) { const index = refCursor++; refs[index] ??= { current: value }; return refs[index] },
    useEffect() {}, useCallback(value: unknown) { return value },
  }
  const exports: Record<string, unknown> = {}
  const source = readFileSync(new URL('../components/procedures/ProcedureLibrary.tsx', import.meta.url), 'utf8') + '\nexport { LibraryPage as TestPage, ArticleEditor as TestEditor }'
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const box = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  runInNewContext(js, { exports, Error, require: (specifier: string) => {
    if (specifier === 'react') return hooks
    if (specifier === 'react/jsx-runtime') return require(specifier)
    if (specifier === 'next/navigation') return { useRouter: () => ({ push() {} }) }
    if (specifier === 'lucide-react') return { Plus: () => null, Search: () => null }
    if (specifier === '@/components/AppNav') return { AppNav: () => null }
    if (specifier === '@/components/Ui') return { buttonClass: () => '', Badge: box }
    if (specifier === '@/components/ui/index') return { PageHeader: ({ title }: { title: string }) => createElement('h1', null, title), EmptyState: ({ title }: { title: string }) => createElement('p', null, title) }
    if (specifier === '@/components/clinical-workspace/styles') return { clinicalCard: '', clinicalInput: '', clinicalLabel: '' }
    if (specifier === '@/components/clinical-workspace/NavigationGuard') return { useClinicalHistory() {}, useClinicalNavigation: () => ({ canLeave: async () => true }), useClinicalFormGuard: () => ({ markPending() {}, markSaved() {}, markSettled() {} }) }
    if (specifier === '@/lib/procedures/model') return model
    if (specifier === '@/lib/procedures/client') return { procedureRequest: call, ProcedureError: FixtureError }
    return {}
  } })
  return { states, render: (props: Record<string, unknown> = {}) => { cursor = 0; refCursor = 0; return (exports[name] as (props: Record<string, unknown>) => ReactNode)(props) } }
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (typeof node.type === 'function') return elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)]
}

test('interface : recherche, sélection, droits de modification et contenu échappé', () => {
  const h = harness('TestPage', [{ canEdit: true, sections: [section], articles: [article] }, false, '', '', '', '', article.id, null, null, '/clinique'])
  const html = renderToStaticMarkup(h.render())
  assert.match(html, /Procédures de la clinique/)
  assert.match(html, /Ajouter une procédure/)
  assert.match(html, /Modifier/)
  assert.match(html, /&lt;script&gt;Exemple fictif&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  const search = elements(h.render()).find(node => node.type === 'input' && node.props.type === 'search')!
  ;(search.props.onChange as (event: unknown) => void)({ target: { value: 'introuvable' } })
  assert.match(renderToStaticMarkup(h.render()), /Aucune procédure trouvée/)
  h.states[0] = { canEdit: false, sections: [section], articles: [article] }
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /Ajouter une procédure|>Modifier</)
  h.states[0] = null
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /Exemple fictif/)
})

test('éditeur : conflit conserve le texte et une sauvegarde confirmée seule ferme le formulaire', async () => {
  const value = { ...article, expectedVersion: 1 }
  let saved = false, denied = false
  const h = harness('TestEditor', [], async () => { throw new FixtureError('Version modifiée ailleurs.', 409) })
  const props = { value, sections: [section], onSaved: async () => { saved = true }, onDenied: () => { denied = true }, onCancel() {} }
  const textarea = elements(h.render(props)).find(node => node.type === 'textarea')!
  ;(textarea.props.onChange as (event: unknown) => void)({ target: { value: 'Texte fictif modifié à conserver.' } })
  const form = elements(h.render(props)).find(node => node.type === 'form')!
  await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
  assert.equal(saved, false); assert.equal(denied, false)
  const html = renderToStaticMarkup(h.render(props))
  assert.match(html, /Texte fictif modifié à conserver/)
  assert.match(html, /Version modifiée ailleurs/)
  const success = harness('TestEditor', [])
  const submit = elements(success.render(props)).find(node => node.type === 'form')!
  await (submit.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
  assert.equal(saved, true)
})
