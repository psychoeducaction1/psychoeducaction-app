import test from 'node:test'
import assert from 'node:assert/strict'
import { CLINICAL_NOTE_BLUEPRINTS } from '../lib/clinicalNoteBlueprints.ts'
import { CLINICAL_NOTE_TEMPLATES } from '../lib/clinicalNoteTemplates.ts'
import { canValidateClinicalDraft, clinicalSourceSnapshot, formatClinicalEngineNote, parseClinicalAnalysis, parseClinicalEngineDraft, parseClinicalEngineResult, retainClinicalVersion } from '../lib/clinicalNoteEngine.ts'
import type { ClinicalEngineResult, ClinicalSources, ClinicalWorkingVersion } from '../lib/clinicalNoteEngine.ts'

const sources: ClinicalSources = {
  transcript: 'Père : mon fils joue avec ses amis et ne veut pas se coucher. Professionnel : est-ce au début de la nuit ? Père : oui. Professionnel : je prends cela en note.',
  history: '', metadata: '',
}
const analysis = {
  facts: [
    { id: 'f1', kind: 'propos', speaker: 'Père', text: 'Le père rapporte que son fils joue avec ses amis et refuse le coucher.', source: 'transcript', quote: 'mon fils joue avec ses amis et ne veut pas se coucher.' },
    { id: 'f2', kind: 'intervention', speaker: 'Professionnel', text: 'Question sur le moment des difficultés.', source: 'transcript', quote: 'est-ce au début de la nuit ?' },
  ], alerts: [{ category: 'information_manquante', priority: 'normal', text: 'Durée des difficultés à préciser.', factIds: [] }],
}
const parsed = parseClinicalAnalysis(analysis, sources)!
const draft = { sections: [{ id: 'informations', paragraphs: [{ text: parsed.facts[0].text, factIds: ['f1'] }], rows: [] }], alerts: [] }

test('les sept configurations sont distinctes, avec PAD/PEX, tableau de plan et observation ABC', () => {
  for (const template of CLINICAL_NOTE_TEMPLATES) {
    const configs = CLINICAL_NOTE_BLUEPRINTS[template.id]
    assert.ok(configs.length >= 6)
    assert.equal(new Set(configs.map(item => item.id)).size, configs.length)
  }
  assert.deepEqual(CLINICAL_NOTE_BLUEPRINTS.plan_intervention.find(item => item.id === 'plan')?.columns, ['Objectif général', 'Objectifs spécifiques', 'Moyens', 'Commentaires'])
  assert.ok(CLINICAL_NOTE_BLUEPRINTS.evaluation_3.some(item => item.id === 'pad'))
  assert.ok(CLINICAL_NOTE_BLUEPRINTS.evaluation_3.some(item => item.id === 'pex'))
  assert.deepEqual(CLINICAL_NOTE_BLUEPRINTS.observation.find(item => item.id === 'abc')?.columns, ['Antécédent', 'Comportement', 'Conséquence'])
})

test('chaque fait a une citation exacte dans la bonne source autorisée; citations inventées et doublons refusés', () => {
  assert.ok(parsed)
  for (const change of [{ quote: 'diagnostic inventé' }, { source: 'history' }, { source: 'unknown' }, { quote: '' }, { speaker: '' }]) {
    assert.equal(parseClinicalAnalysis({ ...analysis, facts: [{ ...analysis.facts[0], ...change }] }, sources), null)
  }
  assert.equal(parseClinicalAnalysis({ ...analysis, facts: [analysis.facts[0], analysis.facts[0]] }, sources), null)
  const previous = { ...analysis.facts[0], source: 'history', quote: 'Compte rendu fictif antérieur.' }
  assert.equal(parseClinicalAnalysis({ ...analysis, facts: [previous] }, sources), null)
  assert.ok(parseClinicalAnalysis({ ...analysis, facts: [previous] }, { ...sources, history: previous.quote }))
})

test('aucun paragraphe ou tableau IA sans référence connue; rubriques et nombres de colonnes contrôlés', () => {
  assert.ok(parseClinicalEngineDraft(draft, 'evolution', parsed.facts))
  for (const change of [{ factIds: [] }, { factIds: ['f99'] }, { text: 'Non documenté.' }]) {
    assert.equal(parseClinicalEngineDraft({ ...draft, sections: [{ ...draft.sections[0], paragraphs: [{ ...draft.sections[0].paragraphs[0], ...change }] }] }, 'evolution', parsed.facts), null)
  }
  assert.equal(parseClinicalEngineDraft({ ...draft, sections: [{ ...draft.sections[0], id: '__proto__' }] }, 'evolution', parsed.facts), null)
  assert.equal(parseClinicalEngineDraft({ ...draft, sections: [draft.sections[0], draft.sections[0]] }, 'evolution', parsed.facts), null)
  const abc = (cells: string[]) => ({ sections: [{ id: 'abc', paragraphs: [], rows: [{ cells, factIds: ['f1'] }] }], alerts: [] })
  assert.equal(parseClinicalEngineDraft(abc(['Situation', 'Action', '']), 'observation', parsed.facts), null)
  assert.equal(parseClinicalEngineDraft(abc(['Situation', 'Action']), 'observation', parsed.facts), null)
  assert.ok(parseClinicalEngineDraft(abc(['Situation documentée', 'Action documentée', 'Conséquence documentée']), 'observation', parsed.facts))
})

test('texte copié sans alertes ni rubriques vides; les propos ne deviennent pas un diagnostic', () => {
  const result = parseClinicalEngineDraft(draft, 'evolution', parsed.facts)!
  const formatted = formatClinicalEngineNote('evolution', result.sections)
  assert.match(formatted, /DONNÉES FICTIVES/)
  assert.match(formatted, /Le père rapporte/)
  assert.doesNotMatch(formatted, /Durée des difficultés|Non documenté|SUITE CONVENUE|OBSERVATIONS|diagnostic/i)
  const plan = parseClinicalEngineDraft({ sections: [{ id: 'plan', paragraphs: [], rows: [{ cells: ['Objectif convenu', '', 'Moyen convenu', ''], factIds: ['f1'] }] }], alerts: [] }, 'plan_intervention', parsed.facts)!
  assert.match(formatClinicalEngineNote('plan_intervention', plan.sections), /Objectif général : Objectif convenu/)
})

test('les risques exigent une priorité et des références valides; pas de validation automatique', () => {
  for (const badAlert of [{ category: 'risque', priority: 'normal', text: 'À revoir', factIds: ['f1'] }, { category: 'risque', priority: 'prioritaire', text: 'À revoir', factIds: ['f99'] }]) {
    assert.equal(parseClinicalAnalysis({ ...analysis, alerts: [badAlert] }, sources), null)
  }
  const alert = { category: 'risque', priority: 'prioritaire', text: 'Propos à revoir par le professionnel', factIds: ['f1'] }
  assert.ok(parseClinicalAnalysis({ ...analysis, alerts: [alert] }, sources))
  const sections = parseClinicalEngineDraft(draft, 'evolution', parsed.facts)!.sections
  assert.equal(canValidateClinicalDraft(false, sections, [true, true, true]), true)
  assert.equal(canValidateClinicalDraft(true, sections, [true, true, true]), false)
  assert.equal(canValidateClinicalDraft(false, sections, [true, false, true]), false)
  assert.equal(canValidateClinicalDraft(false, [], [true, true, true]), false)
})

test('changer une source/type rend le brouillon périmé sans modifier le texte ou les versions manuelles', () => {
  const result: ClinicalEngineResult = { formatVersion: 2, noteType: 'evolution', analysis: parsed, draft: parseClinicalEngineDraft(draft, 'evolution', parsed.facts)! }
  const snapshot = clinicalSourceSnapshot('evolution', sources)
  assert.notEqual(snapshot, clinicalSourceSnapshot('evaluation_1', sources))
  for (const key of ['transcript', 'history', 'metadata'] as const) assert.notEqual(snapshot, clinicalSourceSnapshot('evolution', { ...sources, [key]: `${sources[key]} Correction fictive` }))
  let versions: ClinicalWorkingVersion[] = []
  for (let id = 1; id <= 7; id++) versions = retainClinicalVersion(versions, { id, label: 'Version fictive', result, sources, original: sources.transcript, snapshot })
  assert.deepEqual(versions.map(item => item.id), [3, 4, 5, 6, 7])
  result.draft.sections.find(item => item.id === 'informations')!.paragraphs[0].text = 'Correction manuelle'
  assert.notEqual(versions[4].result.draft.sections.find(item => item.id === 'informations')!.paragraphs[0].text, 'Correction manuelle')
  assert.equal(versions[4].snapshot, snapshot)
  assert.ok(parseClinicalEngineResult(versions[4].result, sources))
  assert.equal(parseClinicalEngineResult({ ...versions[4].result, formatVersion: 3 }, sources), null)
})
