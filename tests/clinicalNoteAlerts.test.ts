import test from 'node:test'
import assert from 'node:assert/strict'
import { deduplicateClinicalAlerts, groupClinicalAlerts } from '../lib/clinicalNoteAlerts.ts'
import { formatClinicalEngineNote } from '../lib/clinicalNoteEngine.ts'
import type { ClinicalAlert } from '../lib/clinicalNoteEngine.ts'

const alert = (text: string, factIds: string[] = ['F7', 'F10'], extra: Partial<ClinicalAlert> = {}): ClinicalAlert => ({ category: 'risque', priority: 'prioritaire', text, factIds, ...extra })

test('les vrais doublons ignorent espaces, apostrophes et ordre des références sans perdre la priorité', () => {
  const input = [
    alert("L'exaspération est à clarifier.", ['F7', 'F10'], { category: 'ambiguite', priority: 'prioritaire' }),
    alert('L’exaspération   est à clarifier.', ['F10', 'F7'], { category: 'ambiguite', priority: 'normal' }),
  ]
  const before = structuredClone(input)
  const result = deduplicateClinicalAlerts(input)
  assert.equal(result.length, 1)
  assert.equal(result[0].priority, 'prioritaire')
  assert.equal(result[0].text, input[1].text)
  assert.deepEqual(result[0].factIds, ['F10', 'F7'])
  assert.deepEqual(input, before, 'Aucune mutation des alertes ou de leurs références')
})

test('trois formulations du même passage deviennent un point avec précisions, pas trois alertes visibles', () => {
  const input = [alert('Exaspération parentale à clarifier.'), alert('Ces propos ne permettent pas de conclure à un danger.'), alert('Propos à clarifier; aucune évaluation du risque rapportée.')]
  const groups = groupClinicalAlerts(input)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].category, 'risque')
  assert.equal(groups[0].priority, 'prioritaire')
  assert.equal(groups[0].points.length, 1)
  const point = groups[0].points[0]
  assert.equal(point.primary.text, input[2].text)
  assert.deepEqual(point.details.map(item => item.text), input.slice(0, 2).map(item => item.text))
})

test('des références communes regroupent seulement la présentation: nuances et références supplémentaires restent consultables', () => {
  const input = [alert('Le qualificatif familial ne prouve pas un diagnostic.', ['F3', 'F6', 'F8', 'F9'], { category: 'fidelite', priority: 'normal' }), alert('Le lien jeux/sommeil est une opinion du parent.', ['F3', 'F6', 'F9'], { category: 'fidelite', priority: 'normal' })]
  const point = groupClinicalAlerts(input)[0].points[0]
  assert.deepEqual(point.factIds, ['F3', 'F6', 'F8', 'F9'])
  assert.equal(point.primary.text, input[1].text)
  assert.equal(point.details[0].text, input[0].text)
  assert.equal(deduplicateClinicalAlerts(input).length, 2, 'Même origine ne prouve pas même contenu clinique')
})

test('alertes distinctes sans référence, références disjointes et catégories différentes restent séparées', () => {
  const input = [
    alert('Durée à préciser.', [], { category: 'information_manquante', priority: 'normal' }),
    alert('Point de vue du jeune à recueillir.', [], { category: 'information_manquante', priority: 'normal' }),
    alert('Durée à préciser.', [], { category: 'information_manquante', priority: 'normal' }),
    alert('Propos préoccupant du père.', ['F1']), alert('Autre propos du jeune.', ['F2']),
    alert('Auteur à confirmer.', ['F1'], { category: 'attribution', priority: 'normal' }),
  ]
  const groups = groupClinicalAlerts(input)
  assert.equal(groups.length, 3)
  assert.equal(groups[0].category, 'risque', 'La priorité passe avant l’ordre d’arrivée')
  assert.equal(groups.find(group => group.category === 'risque')!.points.length, 2)
  assert.equal(groups.find(group => group.category === 'information_manquante')!.points.length, 2)
  assert.equal(groups.find(group => group.category === 'attribution')!.points.length, 1)
})

test('une alerte prioritaire reste visible, même suivie d’une formulation normale; deux sens différents sont préservés', () => {
  const groups = groupClinicalAlerts([
    alert('Une contradiction importante nécessite vérification.', ['F1'], { category: 'contradiction', priority: 'prioritaire' }),
    alert('La présence du jeune est annoncée.', ['F1'], { category: 'contradiction', priority: 'normal' }),
  ])
  assert.equal(groups[0].points[0].primary.priority, 'prioritaire')
  assert.equal(groups[0].points[0].details.length, 1)
  assert.match(groups[0].points[0].details[0].text, /présence du jeune/)
  const bridged = groupClinicalAlerts([
    alert('Ancienne alerte prioritaire.', ['F2'], { category: 'contradiction' }),
    alert('Alerte prioritaire la plus récente.', ['F1'], { category: 'contradiction' }),
    alert('Précision normale ultérieure.', ['F2'], { category: 'contradiction', priority: 'normal' }),
    alert('Précision reliant les passages.', ['F1', 'F2'], { category: 'contradiction', priority: 'normal' }),
  ])
  assert.equal(bridged[0].points[0].primary.text, 'Alerte prioritaire la plus récente.')
})

test('la dernière étape reste principale après déduplication et les regroupements transitifs ne perdent aucun point', () => {
  const first = alert('Première formulation.', ['F1'])
  const other = alert('Deuxième précision.', ['F1'])
  assert.equal(groupClinicalAlerts([first, other, first])[0].points[0].primary.text, first.text)
  const groups = groupClinicalAlerts([alert('Point A.', ['F1']), alert('Point B.', ['F2']), alert('Lien entre A et B.', ['F1', 'F2'])])
  assert.equal(groups[0].points.length, 1)
  assert.deepEqual(groups[0].points[0].factIds, ['F1', 'F2'])
  assert.equal(groups[0].points[0].details.length, 2)
})

test('le regroupement ne touche ni les données initiales ni le texte clinique à copier', () => {
  const input = [alert('Alerte fictive un.'), alert('Alerte fictive deux.')]
  const before = structuredClone(input)
  const sections = [{ id: 'informations', paragraphs: [{ text: 'Le père rapporte une difficulté au coucher.', factIds: ['F7'] }], rows: [] }]
  const note = formatClinicalEngineNote('evolution', sections)
  groupClinicalAlerts(input)
  assert.deepEqual(input, before)
  assert.equal(formatClinicalEngineNote('evolution', sections), note)
  assert.doesNotMatch(note, /Alerte fictive/)
  assert.deepEqual(groupClinicalAlerts([]), [])
})
