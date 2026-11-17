import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as clients from '../lib/clinical-admission/professionalClients.ts'

const require = createRequire(import.meta.url)
const hooks = { useState: (value: unknown) => [value, () => {}], useEffect() {}, useRef: () => ({ current: null }), useCallback: (callback: unknown) => callback }
const assignment = { id: 'fictional-assignment', professionalId: 'fictional-pro', clientId: null, episodeId: null, admissionId: 'fictional-admission', outcome: 'taken', status: 'active', canceledAt: null, clientSnapshot: { firstName: 'Client', lastName: 'Fictif' }, assignedAt: '2026-11-16T12:00:00Z', version: 1 }
const ui = (context: string) => ({ data: { context, notifications: [], assignments: [assignment] }, query: new URLSearchParams({ assignment: assignment.id }), select: async () => {}, openClient: async () => {} })

function component(file: string, name: string, modules: Record<string, unknown>) {
  const exports: Record<string, unknown> = {}
  const source = readFileSync(new URL('../components/clinical-admission/' + file, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, require: (specifier: string) => specifier === 'react/jsx-runtime' ? require(specifier) : specifier === 'react' ? hooks : modules[specifier] ?? {} })
  return exports[name] as (props: Record<string, unknown>) => ReactNode
}

test('détails : fiche et résultat présents, historique réservé à la présentation administrative', () => {
  const Component = component('ProfessionalPanel.tsx', 'AssignmentCase', {
    '@/components/Ui': { buttonClass: () => '' },
    '@/app/professionnel/shared': { getAssignedClientStatusMeta: () => ({ label: 'Service pris' }) },
    './shared': {
      panelClass: '', dateTime: () => 'date fictive',
      Details: () => createElement('p', null, 'Fiche fictive ouverte'),
      Fold: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', null, title, children),
      ActionForm: () => createElement('form'),
      AdmissionHistory: () => createElement('p', null, 'Historique conservé'),
    },
    '@/lib/clinical-workspace/presentationText': { clinicalUiText: (_lab: string, real: string) => real },
  })
  for (const context of ['clinical', 'administration']) {
    const html = renderToStaticMarkup(Component({ ui: ui(context), assignment, clientAccessible: false }))
    assert.match(html, /Fiche fictive ouverte/)
    assert.match(html, /Résultat du contact/)
    if (context === 'clinical') assert.doesNotMatch(html, /Historique conservé/)
    else assert.match(html, /Historique conservé/)
  }
})

test('panneau : bouton Détails et fiche directe pour le professionnel, repli conservé en administration', () => {
  const Component = component('ProfessionalClientsPanel.tsx', 'ProfessionalClientsPanel', {
    '@/lib/clinical-admission/professionalClients': clients,
    '@/components/Ui': { buttonClass: () => '', Badge: ({ children }: { children: ReactNode }) => children },
    '@/components/clinical-workspace/styles': { clinicalInput: '' },
    './shared': { panelClass: '' },
    './ProfessionalPanel': { AssignmentCase: () => createElement('p', null, 'Fiche fictive ouverte') },
  })
  for (const context of ['clinical', 'administration']) {
    const html = renderToStaticMarkup(Component({ ui: ui(context), workspace: { context, records: [], managedRecords: [], clients: [] }, professionalId: assignment.professionalId }))
    assert.match(html, />Détails<\/button>/)
    assert.doesNotMatch(html, /Détails de la prise en charge/)
    assert.match(html, /Fiche fictive ouverte/)
    if (context === 'clinical') assert.doesNotMatch(html, /<summary[^>]*>Prise en charge/)
    else assert.match(html, /<summary[^>]*>Prise en charge/)
  }
})
