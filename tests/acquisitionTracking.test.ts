import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'
import { acquisitionAttributionFor } from '../lib/acquisitionAttribution.ts'
import { validatePublicIntakePayload } from '../lib/publicIntakeValidation.ts'

const globalScript = readFileSync(new URL('../docs/wordpress-acquisition-tracking.js', import.meta.url), 'utf8')
const formScript = readFileSync(new URL('../docs/wordpress-intake-form-tracking.js', import.meta.url), 'utf8')
const queueScript = readFileSync(new URL('../docs/gtm-meta-lead-queue.html', import.meta.url), 'utf8').replace(/<\/?script>/g, '')
const metaScript = readFileSync(new URL('../docs/gtm-meta-lead.html', import.meta.url), 'utf8').replace(/<\/?script>/g, '')
const bookingId = '11111111-1111-4111-8111-111111111111'
const callbackId = '22222222-2222-4222-8222-222222222222'

function storage(blocked = false, values = new Map<string, string>()) {
  return {
    values,
    getItem(key: string) { if (blocked) throw new Error('Storage blocked'); return values.get(key) ?? null },
    setItem(key: string, value: string) { if (blocked) throw new Error('Storage blocked'); values.set(key, value) },
    removeItem(key: string) { if (blocked) throw new Error('Storage blocked'); values.delete(key) },
  }
}

function browser(search = '', options: { blocked?: boolean; consent?: boolean; local?: ReturnType<typeof storage>; session?: ReturnType<typeof storage> } = {}) {
  const listeners = new Map<string, Array<() => void>>()
  let consent = options.consent ?? true
  const calls: unknown[][] = []
  const timers: Array<() => void> = []
  const window = {
    location: { search, pathname: '/reserver-un-appel/' },
    localStorage: options.local ?? storage(options.blocked),
    sessionStorage: options.session ?? storage(options.blocked),
    dataLayer: [] as unknown[],
    cmplz_has_consent: () => consent,
    fbq: (...args: unknown[]) => { calls.push(args) },
    setTimeout: (fn: () => void) => { timers.push(fn) },
  }
  const context = createContext({
    window, URLSearchParams,
    document: { cookie: '', addEventListener(name: string, fn: () => void) { listeners.set(name, [...(listeners.get(name) ?? []), fn]) } },
    fetch: () => { assert.fail('No network access in tracking tests') },
  })
  return { window, context, calls, timers, consent(value: boolean) { consent = value },
    event(name: string) { for (const fn of listeners.get(name) ?? []) fn() },
    run(script: string) { return runInContext(script, context) },
  }
}

function json(value: unknown) { return JSON.parse(JSON.stringify(value)) }

for (const [platform, query, expected] of [
  ['Google', '?utm_source=google&utm_medium=cpc&utm_campaign=fixture-google&utm_id=fixture-1&gclid=fixture-google-click', 'google_ads'],
  ['Meta', '?utm_source=meta&utm_medium=paid_social&utm_campaign=fixture-meta&utm_id=fixture-2&fbclid=fixture-meta-click', 'meta_ads'],
] as const) {
  test(`${platform}: conserve la provenance entre la page publicitaire et le formulaire, pour les deux demandes`, () => {
    const local = storage()
    const landing = browser(query, { local })
    landing.run(globalScript)
    const form = browser('', { local })
    form.run(globalScript)
    form.run(formScript)
    const utm = json(form.run('utm()'))
    assert.equal(acquisitionAttributionFor({ utm }).platform, expected)
    for (const [contactType, conversionEventId] of [['scheduled_call', bookingId], ['rapid_callback', callbackId]]) {
      const validation = validatePublicIntakePayload({
        firstName: 'Fixture', lastName: 'Client', phone: '5145550101', email: 'fixture@example.invalid',
        requestType: 'self', modalities: ['telehealth'], contactType, utm,
      })
      assert.deepEqual(validation.data?.utm, utm)
      assert.equal(form.run(`emitIntakeSubmitted(${JSON.stringify({ success: true, conversionEventId })}, '${contactType}')`), true)
      assert.equal(form.run(`emitIntakeSubmitted(${JSON.stringify({ success: true, conversionEventId })}, '${contactType}')`), false)
    }
    assert.deepEqual(json(form.window.dataLayer), [
      { event: 'booking_form_submitted', conversion_event_id: bookingId },
      { event: 'rapid_callback_submitted', conversion_event_id: callbackId },
    ])
  })
}

test('une nouvelle campagne Meta remplace Google sans conserver son ancien identifiant', () => {
  const local = storage()
  browser('?utm_source=google&gclid=fixture-g', { local }).run(globalScript)
  const meta = browser('?utm_source=meta&fbclid=fixture-f', { local })
  meta.run(globalScript)
  assert.deepEqual(json(meta.run('window.peaAcquisition.attribution()')), { source: 'meta', fbclid: 'fixture-f' })
})

test('le chargement différé de Complianz ne détruit pas une provenance conservée avec consentement', () => {
  const local = storage()
  browser('?gclid=fixture-click&utm_campaign=fixture-campaign', { local }).run(globalScript)
  const next = browser('', { local })
  next.run('window.cmplz_has_consent = undefined; document.cookie = "cmplz_marketing=allow; other=fixture"')
  next.run(globalScript)
  assert.equal(json(next.run('window.peaAcquisition.attribution()')).gclid, 'fixture-click')
  next.run('window.cmplz_has_consent = function(){ return false }')
  next.event('cmplz_status_change')
  assert.equal(local.values.size, 0)
})

test('ne conserve pas l’attribution marketing sans consentement et efface le stockage lors du retrait', () => {
  const page = browser('?utm_source=google&gclid=fixture-click', { consent: false })
  page.run(globalScript)
  assert.equal(page.window.localStorage.values.size, 0)
  assert.equal(json(page.run('window.peaAcquisition.attribution()')).gclid, 'fixture-click')
  page.consent(true)
  page.event('cmplz_enable_category')
  assert.equal(page.window.localStorage.values.size, 1)
  page.consent(false)
  page.event('cmplz_revoke')
  assert.equal(page.window.localStorage.values.size, 0)
  const next = browser('', { local: page.window.localStorage, consent: false })
  next.run(globalScript)
  assert.deepEqual(json(next.run('window.peaAcquisition.attribution()')), {})
})

test('ignore les attributions expirées, invalides et anciennes sans durée de conservation', () => {
  for (const stored of [
    { version: 2, capturedAt: Date.now() - 31 * 86400000, parameters: { utm_source: 'google' } },
    { version: 2, capturedAt: Date.now() + 86400000, parameters: { utm_source: 'google' } },
    { utm_source: 'google', gclid: 'fixture-stale' },
    'invalid',
  ]) {
    const local = storage(false, new Map([['pea.acquisition', JSON.stringify(stored)]]))
    const page = browser('', { local })
    page.run(globalScript)
    assert.deepEqual(json(page.run('window.peaAcquisition.attribution()')), {})
    assert.equal(local.values.size, 0)
  }
})

test('un refus serveur, un identifiant interne seul ou un UUID invalide ne déclenche aucune conversion', () => {
  const page = browser()
  page.run(globalScript)
  page.run(formScript)
  for (const result of [{ success: false, conversionEventId: bookingId }, { appointmentId: bookingId, success: true },
    { success: true, conversionEventId: 'undefined' }, { conversionEventId: bookingId }]) {
    assert.equal(page.run(`emitIntakeSubmitted(${JSON.stringify(result)}, 'scheduled_call')`), false)
  }
  assert.equal(page.run(`emitIntakeSubmitted(${JSON.stringify({ success: true, conversionEventId: bookingId })}, 'unknown')`), false)
  assert.equal(page.window.dataLayer.length, 0)
})

test('le stockage bloqué ne casse ni la provenance courante ni la déduplication des deux demandes', () => {
  for (const global of [true, false]) {
    const page = browser('?gclid=fixture-click&utm_id=fixture-campaign', { blocked: true })
    if (global) page.run(globalScript)
    page.run(formScript)
    assert.equal(json(page.run('utm()')).gclid, 'fixture-click')
    for (const [type, id] of [['scheduled_call', bookingId], ['rapid_callback', callbackId]]) {
      for (let i = 0; i < 2; i++) page.run(`emitIntakeSubmitted({success:true, conversionEventId:'${id}'}, '${type}')`)
    }
    assert.equal(page.window.dataLayer.length, 2)
  }
})

test('la relecture idempotente après rechargement ne répète pas le même événement', () => {
  const session = storage()
  for (let i = 0; i < 2; i++) {
    const page = browser('', { session })
    page.run(globalScript)
    page.run(formScript)
    page.run(`emitIntakeSubmitted({success:true, conversionEventId:'${bookingId}'}, 'scheduled_call')`)
    assert.equal(page.window.dataLayer.length, i === 0 ? 1 : 0)
  }
})

test('une erreur de suivi ne transforme pas une confirmation réussie en erreur du formulaire', () => {
  const page = browser()
  page.run(formScript)
  page.run('window.peaAcquisition = { emitIntakeSuccess: function(){ throw new Error("Tracking unavailable") } }')
  assert.equal(page.run(`emitIntakeSubmitted({success:true, conversionEventId:'${bookingId}'}, 'scheduled_call')`), false)
})

for (const blocked of [false, true]) {
  test(`Meta: deux Lead distincts et aucun doublon, stockage ${blocked ? 'bloqué' : 'disponible'}`, () => {
    const page = browser('', { blocked })
    for (const id of [bookingId, callbackId, bookingId, callbackId]) {
      page.run(queueScript.replaceAll('{{DLV - conversion_event_id}}', id))
      page.run(metaScript.replaceAll('{{DLV - conversion_event_id}}', id))
    }
    assert.deepEqual(json(page.calls), [
      ['track', 'Lead', {}, { eventID: bookingId }],
      ['track', 'Lead', {}, { eventID: callbackId }],
    ])
  })
}

test('Meta: aucune transmission avant consentement ou après son retrait pendant un chargement tardif', () => {
  const page = browser('', { consent: false })
  page.run(queueScript.replaceAll('{{DLV - conversion_event_id}}', bookingId))
  page.run(metaScript.replaceAll('{{DLV - conversion_event_id}}', bookingId))
  assert.equal(page.calls.length, 0)
  page.consent(true)
  page.run('window.savedFbq = window.fbq; window.fbq = undefined')
  page.run(metaScript.replaceAll('{{DLV - conversion_event_id}}', 'undefined'))
  assert.equal(page.timers.length, 1)
  page.consent(false)
  page.run('window.fbq = window.savedFbq')
  page.timers.shift()?.()
  assert.equal(page.calls.length, 0)
  page.consent(true)
  page.run(metaScript.replaceAll('{{DLV - conversion_event_id}}', 'undefined'))
  assert.deepEqual(json(page.calls), [['track', 'Lead', {}, { eventID: bookingId }]])
})

test('Meta: ignore une file corrompue et attend le pixel sans perdre la conversion', () => {
  const session = storage(false, new Map([['pea_pending_meta_leads', '{"email":"fixture@example.invalid"}']]))
  const page = browser('', { session })
  page.run('window.savedFbq = window.fbq; window.fbq = undefined')
  page.run(queueScript.replaceAll('{{DLV - conversion_event_id}}', callbackId))
  page.run(metaScript.replaceAll('{{DLV - conversion_event_id}}', callbackId))
  page.run('window.fbq = window.savedFbq')
  page.timers.shift()?.()
  assert.deepEqual(json(page.calls), [['track', 'Lead', {}, { eventID: callbackId }]])
})

test('Acquisition reconnaît les variantes de source et distingue une origine inconnue des publicités', () => {
  const googleAttributions: Record<string, string>[] = [{ gclid: 'fixture' }, { gbraid: 'fixture' }, { wbraid: 'fixture' }, { source: ' Google ', medium: 'cpc' }]
  for (const utm of googleAttributions) {
    assert.equal(acquisitionAttributionFor({ utm }).platform, 'google_ads')
  }
  for (const source of ['fb', 'ig', 'meta', 'facebook', 'instagram']) {
    assert.equal(acquisitionAttributionFor({ utm: { source, medium: 'paid_social', id: 'fixture-1' } }).platform, 'meta_ads')
  }
  assert.equal(acquisitionAttributionFor({ utm: { fbclid: 'fixture' } }).platform, 'meta_ads')
  assert.equal(acquisitionAttributionFor({ utm: null }).platform, 'direct')
  assert.equal(acquisitionAttributionFor({ utm: { source: 'google', medium: 'organic' } }).platform, 'google')
  assert.equal(acquisitionAttributionFor({ utm: { id: 'fixture-1' } }).campaign, 'Campagne fixture-1')
})

test('les vraies API transmettent la provenance au RPC et la restituent dans Acquisition', () => {
  const result = spawnSync(process.execPath, [
    '--import', new URL('./register-aliases.mjs', import.meta.url).href,
    '--experimental-strip-types', fileURLToPath(new URL('./helpers/acquisitionTrackingRoutes.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
