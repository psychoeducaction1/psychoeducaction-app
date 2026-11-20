// Only schema is copied from the named local pilot. All test rows are synthetic.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_OR_REMOTE_DATABASE_ACCEPTED')
const root = path.resolve(import.meta.dirname, '../..')
const container = 'supabase_db_pea-unification-pilot'
const database = 'pea_advance_opening_test_' + Date.now()
if (!/^pea_advance_opening_test_[0-9]{13}$/.test(database)) throw new Error('ISOLATED_TARGET_REFUSED')

const run = (args, input) => execFileSync('docker', ['exec', ...(input ? ['-i'] : []), container, ...args], {
  input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
})
const sql = input => run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], input)
const file = name => fs.readFileSync(path.join(root, name), 'utf8')
let created = false
try {
  run(['createdb', '-U', 'postgres', database])
  created = true
  sql(`
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create extension if not exists "uuid-ossp" with schema extensions;
    create extension if not exists btree_gist with schema extensions;
  `)
  const schema = run(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges',
    '-n', 'public', '-n', 'clinical', '-n', 'auth', '-n', 'storage'])
  sql(schema.replace(/CREATE SCHEMA /g, 'CREATE SCHEMA IF NOT EXISTS '))
  sql(file('tests/fixtures/automatic-invoice-defaults.sql'))
  sql(file('supabase/clinical/real-1000-automatic-invoices-manual-delivery.sql'))
  const identityQuery = `select 'public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid)'::regprocedure::oid,
    'clinical.note_json(uuid)'::regprocedure::oid;`
  const identities = sql(identityQuery)
  sql(file('supabase/clinical/real-1030-not-held-encounters.sql'))
  if (sql(identityQuery) !== identities) throw new Error('EXISTING_FUNCTION_IDENTITY_CHANGED')
  for (const migration of [
    'real-1040-administrative-capacity-pause.sql', 'real-1050-invoice-email-template.sql',
    'real-1060-advance-opening-fee.sql', 'real-1070-professional-client-review.sql',
    'real-1080-capacity-notice.sql',
  ]) sql(file('supabase/clinical/' + migration))
  sql(file('tests/fixtures/automatic-invoice-client.sql') + '\n' + file('tests/integration/advance-opening-and-email-template.sql'))
  console.log(JSON.stringify({ passed: true, mode: 'local-schema-only-with-synthetic-data',
    sourceRowsCopied: 0, remoteDatabase: false, providerCalls: 0, transactionRolledBack: true }))
} catch (error) {
  console.error(String(error.stderr || error.message).slice(0, 2500))
  process.exitCode = 1
} finally {
  if (created) run(['dropdb', '-U', 'postgres', database])
}
