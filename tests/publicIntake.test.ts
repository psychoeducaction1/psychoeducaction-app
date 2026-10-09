import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildIntakeSlots,
  dateKeyInToronto,
  dateTimeInputToUtcInToronto,
  dateTimeInputValueInToronto,
  isValidIntakeSlot,
  rangesOverlap,
  startOfLocalWeek,
  torontoLocalToUtc,
} from '../lib/publicIntakeSchedule.ts'
import {
  validateIdempotencyKey,
  validatePublicIntakePayload,
} from '../lib/publicIntakeValidation.ts'

test('génère les créneaux de semaine de 8 h à 18 h', () => {
  const slots = buildIntakeSlots(
    '2026-10-05',
    1,
    new Date('2026-10-01T12:00:00Z')
  )
  assert.equal(slots.length, 21)
  assert.equal(slots[0].startAt, torontoLocalToUtc('2026-10-05', 8, 0).toISOString())
  assert.equal(slots.at(-1)?.startAt, torontoLocalToUtc('2026-10-05', 18, 0).toISOString())
})

test('génère les créneaux du samedi de 12 h à 15 h 30', () => {
  const slots = buildIntakeSlots(
    '2026-10-03',
    1,
    new Date('2026-10-01T12:00:00Z')
  )
  assert.equal(slots.length, 8)
  assert.equal(slots.at(-1)?.startAt, torontoLocalToUtc('2026-10-03', 15, 30).toISOString())
})

test('ne génère aucun créneau le dimanche', () => {
  const slots = buildIntakeSlots(
    '2026-10-04',
    1,
    new Date('2026-10-01T12:00:00Z')
  )
  assert.equal(slots.length, 0)
})

test('refuse un créneau situé dans les deux prochaines heures', () => {
  const start = torontoLocalToUtc('2026-10-05', 10, 0)
  assert.equal(isValidIntakeSlot(start, new Date(start.getTime() - 119 * 60_000)), false)
  assert.equal(isValidIntakeSlot(start, new Date(start.getTime() - 120 * 60_000)), true)
})

test('détecte deux plages qui se chevauchent', () => {
  assert.equal(
    rangesOverlap(
      '2026-10-05T12:00:00Z',
      '2026-10-05T12:30:00Z',
      '2026-10-05T12:15:00Z',
      '2026-10-05T12:45:00Z'
    ),
    true
  )
})

test("l'API expose un identifiant de conversion distinct du rendez-vous", async () => {
  const route = await readFile(
    new URL('../app/api/public/intake/bookings/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(route, /appointmentId:\s*data\.appointmentId/)
  assert.match(route, /conversionEventId:\s*data\.conversionEventId/)
  assert.doesNotMatch(route, /conversionEventId:\s*data\.appointmentId/)
  assert.doesNotMatch(route, /bookingEventId/)
})

test('conserve les dates et heures du calendrier dans le fuseau de Toronto', () => {
  const appointment = new Date('2026-10-09T17:00:00Z')
  assert.equal(dateKeyInToronto(appointment), '2026-10-09')
  assert.equal(dateTimeInputValueInToronto(appointment), '2026-10-09T13:00')
  assert.equal(
    dateTimeInputToUtcInToronto('2026-10-09T13:00').toISOString(),
    '2026-10-09T17:00:00.000Z'
  )
  assert.equal(startOfLocalWeek('2026-10-09'), '2026-10-05')
})

test('chaque réservation reçoit un UUID de conversion unique', async () => {
  const sql = await readFile(
    new URL('../supabase/public-intake-calendar.sql', import.meta.url),
    'utf8'
  )

  assert.match(
    sql,
    /conversion_event_id uuid not null default gen_random_uuid\(\)/i
  )
  assert.match(
    sql,
    /update public\.intake_appointments\s+set conversion_event_id = gen_random_uuid\(\)\s+where conversion_event_id is null/i
  )
  assert.match(sql, /intake_appointments_conversion_event_id_idx/i)
  assert.match(
    sql,
    /returning id, conversion_event_id\s+into appointment_id, appointment_conversion_event_id/i
  )
  assert.match(
    sql,
    /'appointmentId', appointment_id,\s+'conversionEventId', appointment_conversion_event_id/i
  )
})

test('un retry idempotent réutilise le conversion_event_id enregistré', async () => {
  const sql = await readFile(
    new URL('../supabase/public-intake-calendar.sql', import.meta.url),
    'utf8'
  )

  assert.match(
    sql,
    /select appointment\.conversion_event_id\s+into appointment_conversion_event_id/i
  )
  assert.match(
    sql,
    /existing_response := existing_response \|\| jsonb_build_object\(\s*'conversionEventId', appointment_conversion_event_id/i
  )
  assert.match(sql, /return existing_response \|\| jsonb_build_object\('reused', true\)/i)
})

test("le contrat marketing n'expose aucune donnée personnelle ou clinique", async () => {
  const documentation = await readFile(
    new URL('../docs/public-intake-api.md', import.meta.url),
    'utf8'
  )
  const dataLayerContract = documentation.match(
    /L'objet envoyé au `dataLayer`[\s\S]*?exclus\./
  )?.[0] ?? ''

  const dataLayerSnippet = documentation.match(
    /window\.dataLayer\.push\(\{[\s\S]*?\}\);/
  )?.[0] ?? ''

  assert.match(dataLayerContract, /conversionEventId|identifiant/i)
  assert.match(dataLayerContract, /données personnelles ou cliniques[\s\S]*exclus/i)
  assert.match(dataLayerSnippet, /event:\s*"booking_form_submitted"/)
  assert.match(dataLayerSnippet, /conversion_event_id:\s*result\.conversionEventId/)
  assert.doesNotMatch(
    dataLayerSnippet,
    /appointmentId|firstName|lastName|phone|email|address|consultationReason/
  )
})

test('valide les clés d’idempotence et les soumissions complètes', () => {
  assert.equal(validateIdempotencyKey('court'), null)
  assert.equal(validateIdempotencyKey('form-550e8400-e29b-41d4-a716'), 'form-550e8400-e29b-41d4-a716')
  const result = validatePublicIntakePayload({
    firstName: 'Marie',
    lastName: 'Tremblay',
    phone: '(514) 555-0101',
    email: 'marie@example.com',
    requestType: 'self',
    requesterNames: [],
    modalities: ['telehealth'],
    contactType: 'rapid_callback',
  }, 'rapid_callback')
  assert.equal(result.error, undefined)
  assert.equal(result.data?.normalizedPhone, '5145550101')
})

test('la migration protège les doubles soumissions et doubles réservations', async () => {
  const sql = await readFile(
    new URL('../supabase/public-intake-calendar.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /idempotency_key text not null unique/i)
  assert.match(sql, /create table if not exists public\.public_intake_prospects/i)
  assert.match(sql, /intake_appointments_unique_scheduled_start_idx/i)
  assert.match(sql, /pg_advisory_xact_lock\(84201\)/i)
  assert.match(sql, /SLOT_UNAVAILABLE/i)
  assert.match(sql, /transfer_prospect_to_waiting_list/i)
  assert.match(sql, /'other'/i)
  assert.doesNotMatch(sql, /select response_payload into existing_response/i)
  assert.doesNotMatch(sql, /SERVICE_NOT_CONFIRMED/i)
  assert.doesNotMatch(
    sql,
    /Transféré depuis la liste des prospects après confirmation du service/i
  )
})
