import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('le contrat du transfert clôture les appels passés et refuse un dossier existant sans modifier les futures réservations', async () => {
  const sql = await readFile(new URL('../supabase/prospect-direct-waiting-list-transfer.sql', import.meta.url), 'utf8')
  assert.match(sql, /p_actor_id and role = 'direction'/)
  assert.match(sql, /pg_advisory_xact_lock\(84201\)[\s\S]*pg_advisory_xact_lock\(84203\)/)
  assert.match(sql, /waiting_list_client_id is not null then[\s\S]*status = 'completed'[\s\S]*'reused', true/)
  assert.match(sql, /status = 'scheduled' and end_at <= now\(\)/)
  assert.match(sql, /intake_appointment_events[\s\S]*'completed'/)
  assert.match(sql, /EXISTING_WAITING_LIST_CLIENT[\s\S]*insert into public.waiting_list_clients/)
})
