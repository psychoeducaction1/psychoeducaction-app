import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function parseLocalTestDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error('Set LOCAL_TEST_DATABASE_URL to an isolated local PostgreSQL database. No connection was attempted.')
  }
  let database
  try {
    database = new URL(rawUrl)
    decodeURIComponent(database.username)
    decodeURIComponent(database.password)
    decodeURIComponent(database.pathname)
  } catch {
    throw new Error('LOCAL_TEST_DATABASE_URL is invalid. No connection was attempted.')
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !loopbackHosts.has(database.hostname) || database.search || database.hash ||
      !database.username ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(decodeURIComponent(database.pathname.slice(1)))) {
    throw new Error('Database tests accept only a local loopback PostgreSQL URL without query parameters. No connection was attempted.')
  }
  return database
}

function run() {
  let database
  try { database = parseLocalTestDatabaseUrl(process.env.LOCAL_TEST_DATABASE_URL) } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    return
  }
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG'))
  )

  // Never pass the password in arguments or read the application's .env.local.
  const result = spawnSync('psql', [
    '-X', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', database.hostname.replace(/^\[|\]$/g, ''), '-p', database.port || '5432',
    '-U', decodeURIComponent(database.username), '-d', decodeURIComponent(database.pathname.slice(1)),
    '-f', fileURLToPath(new URL('../tests/integration/public-intake.sql', import.meta.url)),
    '-f', fileURLToPath(new URL('../tests/integration/prospects-and-calls.sql', import.meta.url)),
    '-f', fileURLToPath(new URL('../tests/integration/prospect-call-workflow.sql', import.meta.url)),
  ], {
    stdio: 'inherit', timeout: 60_000, windowsHide: true,
    env: {
      ...cleanEnvironment,
      PGPASSWORD: decodeURIComponent(database.password),
      PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable',
      PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=5000 -c plpgsql.check_asserts=on',
    },
  })

  if (result.error) {
    console.error(result.error.code === 'ENOENT'
      ? 'psql is required for local database tests; install PostgreSQL client tools first.'
      : 'The local database test process could not finish.')
  }
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) run()
