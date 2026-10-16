import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { canAccessClinicalNotes, CLINICAL_NOTES_PILOT_USER_ID } from '../lib/clinicalNotesAccess.ts'
import { SUPER_ADMIN_EMAIL } from '../lib/superAdmin.ts'
import {
  createDemoSession, createDemoSessions, getDemoCopyText, getDemoNote, transitionDemoNote,
} from '../lib/clinicalNotesDemo.ts'

test('Prise de notes: deux comptes precis, profil charge et role attendu obligatoires', () => {
  const pilot = { id: CLINICAL_NOTES_PILOT_USER_ID, email: 'pilote@example.invalid' }
  assert.equal(canAccessClinicalNotes(pilot, { role: 'professionnel' }), true)
  assert.equal(canAccessClinicalNotes({ id: 'owner-fixture', email: SUPER_ADMIN_EMAIL }, { role: 'direction' }), true)
  for (const role of ['direction', 'professionnel', 'marketing', null]) {
    assert.equal(canAccessClinicalNotes({ id: 'other-fixture', email: 'other@example.invalid' }, { role }), false)
  }
  for (const role of ['direction', 'marketing', null]) assert.equal(canAccessClinicalNotes(pilot, { role }), false)
  assert.equal(canAccessClinicalNotes({ email: SUPER_ADMIN_EMAIL }, { role: 'professionnel' }), false)
  assert.equal(canAccessClinicalNotes(pilot, null), false)
  assert.equal(canAccessClinicalNotes({ email: SUPER_ADMIN_EMAIL }, undefined), false)
  assert.equal(canAccessClinicalNotes(null, { role: 'direction' }), false)
})

test('Prise de notes: vraie API, identites verifiees, RLS et refus sans acces privilegie', () => {
  const result = spawnSync(process.execPath, [
    '--import', new URL('./register-aliases.mjs', import.meta.url).href,
    '--experimental-strip-types', fileURLToPath(new URL('./helpers/clinicalNotesRoute.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})

test('le parcours fictif exige consentement, source et relecture avant copie', () => {
  let session = createDemoSession(8)
  assert.equal(transitionDemoNote(session, { type: 'source' }), session)
  assert.equal(transitionDemoNote(session, { type: 'generate' }), session)
  assert.equal(transitionDemoNote(session, { type: 'edit', text: 'Brouillon fictif' }), session)
  assert.equal(getDemoCopyText(session), null)
  session = transitionDemoNote(session, { type: 'configure', consent: true, mode: 'Présentiel', template: 'evaluation' })
  assert.equal(transitionDemoNote(session, { type: 'generate' }), session)
  session = transitionDemoNote(session, { type: 'source' })
  session = transitionDemoNote(session, { type: 'generate' })
  assert.equal(session.status, 'draft')
  assert.equal(session.text, getDemoNote('evaluation'))
  assert.equal(transitionDemoNote(session, { type: 'validate' }), session)
  assert.equal(transitionDemoNote(session, { type: 'deposit' }), session)
  assert.equal(getDemoCopyText(session), null)
  session = transitionDemoNote(session, { type: 'review', checked: true })
  session = transitionDemoNote(session, { type: 'validate' })
  assert.equal(session.status, 'validated')
  const copied = getDemoCopyText(session)
  assert.ok(copied?.includes('NE PAS DEPOSER DANS UN VRAI DOSSIER'))
  assert.ok(copied?.includes('FICT-008'))
  assert.ok(copied?.includes('Présentiel'))
  assert.equal(session.status, 'validated', 'La copie ne confirme jamais le depot')
  session = transitionDemoNote(session, { type: 'deposit' })
  assert.equal(session.status, 'deposited')
  assert.equal(transitionDemoNote(session, { type: 'edit', text: 'Modification fictive' }), session)
})

test('toute correction exige une nouvelle validation et un texte non vide', () => {
  let session = createDemoSessions()[0]
  session = transitionDemoNote(session, { type: 'review', checked: true })
  session = transitionDemoNote(session, { type: 'edit', text: 'Texte fictif modifié' })
  assert.equal(session.reviewed, false)
  assert.equal(transitionDemoNote(session, { type: 'validate' }), session)
  session = transitionDemoNote(session, { type: 'review', checked: true })
  session = transitionDemoNote(session, { type: 'validate' })
  session = transitionDemoNote(session, { type: 'reopen' })
  assert.equal(session.status, 'draft')
  assert.equal(session.reviewed, false)
  assert.equal(getDemoCopyText(session), null)
  session = transitionDemoNote(session, { type: 'edit', text: '  ' })
  session = transitionDemoNote(session, { type: 'review', checked: true })
  assert.equal(transitionDemoNote(session, { type: 'validate' }), session)
})

test('les essais ne partagent aucun etat et un changement de preparation invalide la source', () => {
  const initial = createDemoSessions()
  const fresh = createDemoSessions()
  initial[0].text = 'Modification fictive locale'
  assert.notEqual(initial[0].text, fresh[0].text)
  let session = transitionDemoNote(createDemoSession(9), { type: 'configure', consent: true })
  session = transitionDemoNote(session, { type: 'source' })
  session = transitionDemoNote(session, { type: 'configure', mode: 'Présentiel' })
  assert.equal(session.sourceReady, false)
  session = transitionDemoNote(session, { type: 'configure', consent: false })
  assert.equal(transitionDemoNote(session, { type: 'source' }), session)
})
