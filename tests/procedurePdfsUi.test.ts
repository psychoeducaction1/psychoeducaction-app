import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Children, createElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as model from '../lib/procedures/pdfModel.ts'

const require = createRequire(import.meta.url)
const file = { id: '30000000-0000-4000-8000-000000000001', articleId: '20000000-0000-4000-8000-000000000001', documentId: '40000000-0000-4000-8000-000000000001', version: 1, label: 'Guide fictif', fileName: 'guide.pdf', byteLength: 100, createdAt: '2026-11-17T12:00:00Z' }
class FixtureError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
function harness(name: string, initial: unknown[], client: Record<string, unknown> = {}) {
  let cursor = 0, refCursor = 0
  const states = [...initial], refs: { current: unknown }[] = []
  const hooks = {
    useState(value: unknown) { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (v: unknown) => unknown)(states[index]) : next }] },
    useRef(value: unknown) { const index = refCursor++; refs[index] ??= { current: value }; return refs[index] },
    useEffect() {}, useCallback(value: unknown) { return value },
  }
  const exports: Record<string, unknown> = {}
  const source = readFileSync(new URL('../components/procedures/ProcedurePdfs.tsx', import.meta.url), 'utf8') + '\nexport { PdfEditor as TestEditor }'
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(js, { exports, Error, Uint8Array, AbortController, btoa, crypto: { randomUUID: () => '50000000-0000-4000-8000-000000000001' }, require: (specifier: string) => {
    if (specifier === 'react') return hooks
    if (specifier === 'react/jsx-runtime') return require(specifier)
    if (specifier === '@/components/Ui') return { buttonClass: () => '' }
    if (specifier === '@/components/intake/ProspectDialog') return { ProspectDialog: ({ children }: { children: ReactNode }) => createElement('div', null, children) }
    if (specifier === '@/components/clinical-workspace/styles') return { clinicalInput: '', clinicalLabel: '' }
    if (specifier === '@/components/clinical-workspace/NavigationGuard') return { useClinicalNavigation: () => ({ canLeave: async () => true }), useClinicalFormGuard: () => ({ markPending() {}, markSaved() {}, markSettled() {} }) }
    if (specifier === '@/lib/procedures/pdfModel') return model
    if (specifier === '@/lib/procedures/client') return { ProcedureError: FixtureError, ...client }
    return {}
  } })
  return { states, render: (props: Record<string, unknown>) => { cursor = 0; refCursor = 0; return (exports[name] as (props: Record<string, unknown>) => ReactNode)(props) } }
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (typeof node.type === 'function') return elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)]
}
test('PDF interface : consultation et versions accessibles en lecture, édition masquée, révocation purge la liste', async () => {
  const h = harness('ProcedurePdfs', [[file, { ...file, id: 'new', version: 2 }], true, false, false, '', '', null, null], { readProcedurePdf: async () => { throw new FixtureError('Accès retiré.', 403) } })
  const props = { articleId: file.articleId, canEdit: false, onEditorChange() {} }
  let html = renderToStaticMarkup(h.render(props))
  assert.match(html, /Consulter|Télécharger/); assert.match(html, /Versions précédentes/)
  assert.doesNotMatch(html, /Joindre un PDF|Remplacer le PDF/)
  const button = elements(h.render(props)).find(node => node.type === 'button' && node.props.children === 'Consulter')!
  await (button.props.onClick as () => Promise<void>)()
  // onClick launches an async operation; allow its rejection handler to settle.
  await new Promise(resolve => setImmediate(resolve))
  html = renderToStaticMarkup(h.render(props))
  assert.match(html, /Accès retiré/); assert.doesNotMatch(html, /Guide fictif|Joindre un PDF/)
})
test('PDF éditeur : conflit conserve le fichier et le titre, reprise garde le même identifiant', async () => {
  const sent: Record<string, unknown>[] = []
  let saved = false
  const h = harness('TestEditor', [], { saveProcedurePdf: async (input: Record<string, unknown>) => { sent.push(input); throw new FixtureError('Ce document a changé.', 409) } })
  const props = { articleId: file.articleId, value: { documentId: file.documentId, expectedVersion: 1, label: file.label }, onCancel() {}, onSaved: async () => { saved = true }, onDenied() {} }
  const input = elements(h.render(props)).find(node => node.type === 'input' && node.props.type === 'file')!
  ;(input.props.onChange as (event: unknown) => void)({ target: { files: [{ name: 'guide.pdf', type: 'application/pdf', size: 8, arrayBuffer: async () => new TextEncoder().encode('%PDF-foo').buffer }] } })
  for (let attempt=0; attempt<2; attempt++) {
    const form = elements(h.render(props)).find(node => node.type === 'form')!
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
  }
  assert.equal(saved, false); assert.equal(sent.length, 2); assert.equal(sent[0].id, sent[1].id)
  assert.match(renderToStaticMarkup(h.render(props)), /Ce document a changé|Guide fictif/)
  assert.equal(h.states[1] !== null, true)
})
