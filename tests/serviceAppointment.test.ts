import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { buildServiceAppointment, readStoredServiceAppointment, validateServiceAppointmentInput, serviceAppointmentSummary, serviceAppointmentInstructions } from '../lib/serviceAppointment.ts'
import { buildServiceTakenConfirmationEmail } from '../lib/serviceTakenConfirmationEmail.ts'
import { runWaitingListAssignmentAction } from '../lib/waitingListAssignmentActions.ts'

const offices = { montreal: '100, rue Fictive, bureau 233, Montréal', longueuil: '200, avenue Fictive, Longueuil' }
const input = { date: '2026-11-10', time: '14:30', modality: 'telehealth' as const }
const id = '10000000-0000-4000-8000-000000000001'
test('la confirmation exige trois champs valides et interprète les heures au Québec', () => {
  for (const value of [null, {}, { ...input, date: '' }, { ...input, time: '' }, { ...input, modality: '' },
    { ...input, date: '2026-02-30' }, { ...input, time: '24:00' }, { ...input, time: '10:60' }, { ...input, modality: '__proto__' },
    { ...input, date: '2026-03-08', time: '02:30' }, { ...input, date: '2026-11-01', time: '01:30' }]) {
    assert.throws(() => validateServiceAppointmentInput(value))
  }
  assert.equal(buildServiceAppointment(input, offices).startsAt, '2026-11-10T19:30:00.000Z')
  assert.equal(buildServiceAppointment({ ...input, date: '2026-07-10' }, offices).startsAt, '2026-07-10T18:30:00.000Z')
})
test('les quatre modalités gardent leur adresse figée et des consignes appropriées', () => {
  for (const modality of ['telehealth', 'home', 'montreal', 'longueuil'] as const) {
    const appointment = buildServiceAppointment({ ...input, modality, address: 'ADRESSE INJECTÉE' }, offices)
    const instructions = serviceAppointmentInstructions(appointment).join('\n')
    assert.deepEqual(readStoredServiceAppointment(appointment), appointment)
    const summary = serviceAppointmentSummary(appointment).join('\n')
    assert.match(summary, /10 novembre 2026/); assert.match(summary, /14 h 30/)
    if (modality === 'telehealth') { assert.match(instructions, /jour même/); assert.match(instructions, /indésirables/); assert.equal(appointment.address, null) }
    else if (modality === 'home') { assert.match(instructions, /domicile/); assert.doesNotMatch(instructions, /porte|bureaux|connexion/); assert.equal(appointment.address, null) }
    else { assert.equal(appointment.address, offices[modality]); if (modality === 'longueuil') assert.match(instructions, /heure exacte/); else assert.equal(instructions, ''); assert.doesNotMatch(instructions, /connexion|indésirables/) }
    assert.doesNotMatch(summary, /INJECTÉE/)
  }
  assert.throws(() => buildServiceAppointment({ ...input, modality: 'montreal' }, { montreal: '', longueuil: '' }), /adresse/)
  assert.throws(() => readStoredServiceAppointment({ ...buildServiceAppointment(input, offices), startsAt: '2026-11-10T14:30:00Z' }), /incohérent/)
})
test('le courriel contient la date, l’heure et la modalité, avec uniquement l’adresse du bureau choisi', () => {
  for (const modality of ['telehealth','home','montreal','longueuil'] as const) {
    const appointment = buildServiceAppointment({ ...input, modality }, offices)
    const email = buildServiceTakenConfirmationEmail({ clientFullName: 'Client fictif', professionalName: 'Professionnel fictif',
      professionalEmail: 'pro@example.invalid', professionalPhone: '000-000-0000', appointment })
    assert.match(email.text, /10 novembre 2026/); assert.match(email.text, /14 h 30/); assert.match(email.text, /Modalité :/)
    if (modality === 'montreal') { assert.ok(email.text.includes(offices.montreal)); assert.ok(!email.text.includes(offices.longueuil)) }
    if (modality === 'longueuil') { assert.ok(email.text.includes(offices.longueuil)); assert.ok(!email.text.includes(offices.montreal)) }
    if (modality === 'telehealth') { assert.match(email.text, /jour même/); assert.match(email.text, /indésirables/); assert.doesNotMatch(email.text, /Adresse :/) }
  }
})
test('le serveur refuse un service pris incomplet avant tout RPC et reconstruit le rendez-vous', async () => {
  for (const appointment of [undefined, {}, { ...input, time: '25:10' }]) {
    const result = await runWaitingListAssignmentAction('assign', id, { professionalId: id, idempotencyKey: id, outcome: 'service_taken', assignmentProcessId: id, appointment }, {
      authorize: async () => ({ actorId: id }), rpc: () => assert.fail('Aucune mutation avant validation du rendez-vous'),
    })
    assert.equal(result.status, 400)
  }
  const result = await runWaitingListAssignmentAction('assign', id, { professionalId: id, idempotencyKey: id, outcome: 'service_taken', appointment: { ...input, modality: 'montreal', address: 'falsifiée', startsAt: 'falsifié' } }, {
    authorize: async () => ({ actorId: id }), officeAddresses: () => offices,
    rpc: async (name, args) => { assert.equal(name, 'create_scheduled_waiting_list_assignment'); assert.deepEqual(args.p_appointment, buildServiceAppointment({ ...input, modality: 'montreal' }, offices)); return { data: { success: true }, error: null } },
  })
  assert.equal(result.status, 200)
})
test('la vraie route courriel utilise le rendez-vous enregistré et conserve le professionnel en copie', () => {
  const result = spawnSync(process.execPath, ['--import','./tests/register-aliases.mjs','--experimental-strip-types','tests/helpers/serviceTakenConfirmationRoute.mjs'], { encoding:'utf8', timeout:15000, windowsHide:true })
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})
