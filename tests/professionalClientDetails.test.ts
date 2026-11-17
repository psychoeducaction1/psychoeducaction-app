import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as outcomes from '../lib/clinical-admission/outcomeErrors.ts'
import * as clients from '../lib/clinical-admission/professionalClients.ts'

const require = createRequire(import.meta.url)
const hooks = { useState: (value: unknown) => [value, () => {}], useEffect() {}, useRef: () => ({ current: null }), useCallback: (callback: unknown) => callback }
const assignment = { id: 'fictional-assignment', professionalId: 'fictional-pro', clientId: null, episodeId: null, admissionId: 'fictional-admission', outcome: 'taken', status: 'active', canceledAt: null, clientSnapshot: { firstName: 'Client', lastName: 'Fictif' }, assignedAt: '2026-11-16T12:00:00Z', version: 1 }
const ui = (context: string) => ({ data: { context, notifications: [], assignments: [assignment] }, query: new URLSearchParams({ assignment: assignment.id }), select: async () => {}, openClient: async () => {} })

function component(file: string, name: string, modules: Record<string, unknown>, reactHooks = hooks) {
  const exports: Record<string, unknown> = {}
  const source = readFileSync(new URL('../components/clinical-admission/' + file, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, require: (specifier: string) => specifier === 'react/jsx-runtime' ? require(specifier) : specifier === 'react' ? reactHooks : modules[specifier] ?? {} })
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

test('résultat : le refus serveur conserve le formulaire et propose la fermeture du dossier dans les deux contextes', async () => {
  for (const context of ['clinical', 'administration']) {
    const states: unknown[] = []; let index = 0
    let submit: (values: Record<string, string>) => Promise<void> = async () => { throw new Error('Formulaire absent') }
    const stateHooks = { ...hooks, useState: (initial: unknown) => {
      const position = index++
      if (!(position in states)) states[position] = initial
      return [states[position], (next: unknown) => { states[position] = next }]
    } }
    const Component = component('ProfessionalPanel.tsx', 'AssignmentCase', {
      '@/lib/clinical-admission/outcomeErrors': outcomes,
      '@/components/Ui': { buttonClass: () => '' },
      '@/app/professionnel/shared': { getAssignedClientStatusMeta: () => ({ label: 'Service pris' }), getNonServiceReasonError: () => null },
      './shared': {
        panelClass: '', dateTime: () => 'date fictive', text: (value: unknown) => String(value ?? ''),
        Details: () => createElement('p', null, 'Fiche fictive'),
        Fold: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', null, title, children),
        ActionForm: ({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: typeof submit }) => {
          if (submitLabel === 'Enregistrer le résultat') submit = onSubmit
          return createElement('form')
        },
        AdmissionHistory: () => null,
      },
      '@/lib/clinical-workspace/presentationText': { clinicalUiText: (_lab: string, real: string) => real },
    }, stateHooks)
    const input = { ...ui(context), run: async () => { throw { code: outcomes.assignmentEncounterCode, message: outcomes.assignmentEncounterMessage } } }
    const render = () => { index = 0; return renderToStaticMarkup(Component({ ui: input, assignment: { ...assignment, clientId: 'fictional-client' }, clientAccessible: false })) }
    render()
    await assert.rejects(submit({ outcome: 'not_taken', reason: 'Motif fictif' }))
    const html = render()
    assert.match(html, /Une rencontre a déjà eu lieu/)
    assert.match(html, /Aller à la fermeture du dossier/)
    assert.match(html, /Résultat du contact/)
    assert.ok(html.includes('Statut du dossier'))
  }
})

test('HTTP : le code SQL de rencontre produit une réponse métier 409 explicite', async () => {
  const exports: Record<string, unknown> = {}
  const source = readFileSync(new URL('../lib/clinical-unification/http.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, Response, require: (specifier: string) => {
    if (specifier === '../clinical-admission/outcomeErrors.ts') return outcomes
    if (specifier === './auth.ts') return { UnifiedAuthenticationError: class extends Error {} }
    if (specifier === '../clinical-mandates/defaultErrors.ts') return { mandateDefaultFailure: () => null }
    return {}
  } })
  const failure = exports.unifiedHttpFailure as (error: unknown) => Response
  const response = failure({ code: '40001', message: outcomes.assignmentEncounterCode })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: outcomes.assignmentEncounterMessage, code: outcomes.assignmentEncounterCode })
  assert.equal(failure({ code: '40001', message: 'OTHER_CONFLICT' }).status, 409)
  const unlinked = failure({ code: '40001', message: outcomes.assignmentEncounterLinkCode })
  assert.equal(unlinked.status, 409)
  assert.deepEqual(await unlinked.json(), { error: outcomes.assignmentEncounterLinkMessage, code: outcomes.assignmentEncounterLinkCode })
})
