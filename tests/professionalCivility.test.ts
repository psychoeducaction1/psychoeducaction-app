import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProfessionalName, isProfessionalCivility } from '../lib/professionalCivility.ts'
import { buildServiceAppointment } from '../lib/serviceAppointment.ts'
import { buildServiceTakenConfirmationEmail } from '../lib/serviceTakenConfirmationEmail.ts'

test('civilité explicite, sans déduction du prénom ni valeur par défaut', () => {
  assert.equal(formatProfessionalName('Camille Fixture'), 'Camille Fixture')
  assert.equal(formatProfessionalName('Camille Fixture', 'M.'), 'M. Camille Fixture')
  assert.equal(formatProfessionalName('Camille Fixture', 'Mme'), 'Mme Camille Fixture')
  for (const value of ['Mme.', 'M', 'Madame', '', null]) assert.equal(isProfessionalCivility(value), false)
})

test('confirmation chaleureuse, client unique et indésirables en gras avec HTML échappé', () => {
  for (const professionalCivility of ['M.', 'Mme', null] as const) {
    const email = buildServiceTakenConfirmationEmail({ clientFullName: 'Client <Fixture>', professionalName: 'Camille & Fixture', professionalCivility,
      professionalEmail: 'pro@example.invalid', professionalPhone: '000', appointment: buildServiceAppointment({ date: '2026-11-10', time: '14:30', modality: 'telehealth' }, { montreal: '', longueuil: '' }) })
    assert.ok(email.text.startsWith('Bonjour,\n\nNous avons le plaisir'))
    assert.equal(email.text.split('Client <Fixture>').length - 1, 1)
    assert.match(email.text, /dans le cadre du dossier de Client <Fixture> à la Clinique PsychoÉducAction/)
    assert.match(email.html, /<strong>Pensez à vérifier vos courriels indésirables.*<\/strong>/)
    assert.match(email.html, /Client &lt;Fixture&gt;/)
    assert.match(email.html, /Camille &amp; Fixture/)
    assert.doesNotMatch(email.html, /<Fixture>/)
    if (professionalCivility) assert.ok(email.text.includes(`${professionalCivility} Camille`))
  }
})
