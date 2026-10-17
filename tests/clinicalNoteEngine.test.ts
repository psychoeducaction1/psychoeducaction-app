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

test('observation: une limite dictée reste dans la description copiée, avec une seule séquence ABC complète', () => {
  const quote = 'À 09 h 12, je vois le jeune s’écarter du groupe. Je n’ai observé ni ce qui précédait ni ce qui a suivi.'
  const sequence = 'À 09 h 05, après l’annonce du rangement, le jeune dit non; après le choix de crayon offert, il range les blocs.'
  const source = { transcript: `DONNÉES FICTIVES. Professionnel : ${sequence} ${quote}`, history: '', metadata: '' }
  const facts = parseClinicalAnalysis({ facts: [
    { id: 'abc', kind: 'observation', speaker: 'Professionnel', text: sequence, source: 'transcript', quote: sequence },
    { id: 'partiel', kind: 'observation', speaker: 'Professionnel', text: quote, source: 'transcript', quote },
  ], alerts: [] }, source)!.facts
  const result = parseClinicalEngineDraft({ sections: [
    { id: 'description', paragraphs: [{ text: quote, factIds: ['partiel'] }], rows: [] },
    { id: 'abc', paragraphs: [], rows: [{ cells: ['Annonce du rangement à 09 h 05.', 'Le jeune dit non.', 'Choix offert, puis rangement des blocs.'], factIds: ['abc'] }] },
  ], alerts: [{ category: 'information_manquante', priority: 'normal', text: 'Une autre observation pourrait compléter la séquence.', factIds: ['partiel'] }] }, 'observation', facts)!
  assert.ok(result)
  const text = formatClinicalEngineNote('observation', result.sections)
  assert.ok(text.includes(quote), 'La limite dictée est un fait de la description, conservé lors de la copie')
  assert.equal(result.sections.find(item => item.id === 'abc')!.rows.length, 1)
  assert.doesNotMatch(text, /Une autre observation pourrait/, 'La suggestion de relecture reste hors copie')
  assert.equal(parseClinicalAnalysis({ facts: [{ ...facts[1], quote }], alerts: [] }, { ...source, transcript: sequence }), null, 'Aucune citation de limite dictée si la source est silencieuse')
})

test('évaluation 3: objectif et divergence explicitement inexpliquée restent copiables avec PAD et PEX distincts', () => {
  const items = [
    ['objectif', 'Nous faisons la synthèse des informations recueillies.'],
    ['synthese', 'Le jeune décrit des couchers faciles; le père rapporte deux couchers difficiles. Le professionnel indique que cette divergence reste inexpliquée.'],
    ['pad', 'Selon un exemple antérieur, le jeune peut nommer son émotion et demander une pause.'],
    ['pex', 'L’enseignante a rapporté une séquence visuelle et sa disponibilité comme soutiens du milieu.'],
    ['jugement', 'Le professionnel formule un jugement provisoire, à valider, sans diagnostic.'],
  ]
  const source = { transcript: `DONNÉES FICTIVES. ${items.map(([, text]) => text).join(' ')}`, history: '', metadata: '' }
  const facts = parseClinicalAnalysis({ facts: items.map(([id, text]) => ({ id, kind: 'propos', speaker: 'Professionnel fictif', text, source: 'transcript', quote: text })), alerts: [] }, source)!.facts
  const result = parseClinicalEngineDraft({ sections: items.map(([id, text]) => ({ id, paragraphs: [{ text, factIds: [id] }], rows: [] })), alerts: [
    { category: 'contradiction', priority: 'normal', text: 'Vérifier les différences entre les sources.', factIds: ['synthese'] },
  ] }, 'evaluation_3', facts)!
  const text = formatClinicalEngineNote('evaluation_3', result.sections)
  assert.match(text, /OBJECTIF DE LA RENCONTRE\nNous faisons la synthèse/)
  assert.match(text, /cette divergence reste inexpliquée/)
  assert.match(text, /POTENTIEL ADAPTATIF \(PAD\)\nSelon un exemple antérieur/)
  assert.match(text, /POTENTIEL EXPÉRIENTIEL \(PEX\)\nL’enseignante a rapporté/)
  assert.equal(text.split('demander une pause').length - 1, 1)
  assert.doesNotMatch(text, /Vérifier les différences/)
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
