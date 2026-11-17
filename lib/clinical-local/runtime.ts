import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { isStagingClinicalRuntime } from '../clinical-staging/runtime.ts'
export { isStagingClinicalRuntime, stagingAllowedEmails } from '../clinical-staging/runtime.ts'

export type LocalClinicalRuntime = { projectId: 'pea-clinical-lab'; supabaseUrl: 'http://127.0.0.1:54321'; anonKey: string; serviceRoleKey: string; dbUrl: string }
export type StagingClinicalRuntime = { projectId: 'pea-clinical-stage'; supabaseUrl: 'https://csnmblsosfgjgljgtwyr.supabase.co'; anonKey: string; serviceRoleKey: string; dbUrl: '' }
export type DurableClinicalRuntime = LocalClinicalRuntime | StagingClinicalRuntime
export type StripeTestConfig = { publishableKey: string; secretKey: string; webhookSecret: string }
export type OpenAiPilotConfig = { apiKey: string; allowedRecordIds: string[]; allowAllFictionalRecords: boolean }
/** Explicit opt-in for fictional records in the private local lab. */
export function readOpenAiPilotConfig(directory = process.cwd()): OpenAiPilotConfig | null {
  const root = realpathSync(/* turbopackIgnore: true */ directory)
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, 'openai-pilot.json')
  if (!existsSync(file)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink() || realpathSync(dirname(file)) !== folder) throw new Error('OPENAI_PILOT_PATH_REFUSED')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OPENAI_PILOT_CONFIG_REFUSED')
  const data = value as Record<string, unknown>
  const keys = Object.keys(data).sort().join(',')
  if (keys !== 'allowedRecordIds,apiKey,fictional,projectId'
    && keys !== 'allowAllFictionalRecords,allowedRecordIds,apiKey,fictional,projectId') throw new Error('OPENAI_PILOT_CONFIG_REFUSED')
  if (data.fictional !== true || data.projectId !== 'pea-clinical-lab'
    || typeof data.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{12,}$/.test(data.apiKey)
    || !Array.isArray(data.allowedRecordIds) || !data.allowedRecordIds.length
    || data.allowedRecordIds.length > 10 || new Set(data.allowedRecordIds).size !== data.allowedRecordIds.length
    || !data.allowedRecordIds.every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    || (data.allowAllFictionalRecords !== undefined && data.allowAllFictionalRecords !== true)) throw new Error('OPENAI_PILOT_CONFIG_REFUSED')
  return { apiKey: data.apiKey, allowedRecordIds: data.allowedRecordIds as string[], allowAllFictionalRecords: data.allowAllFictionalRecords === true }
}
/** Optional, private test-only credentials. The isolated launcher never inherits Stripe environment keys. */
export function readStripeTestConfig(directory = process.cwd()): StripeTestConfig | null {
  const root = realpathSync(/* turbopackIgnore: true */ directory)
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, 'stripe-test.json')
  if (!existsSync(file)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink() || realpathSync(dirname(file)) !== folder) throw new Error('STRIPE_TEST_PATH_REFUSED')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('STRIPE_TEST_CONFIG_REFUSED')
  const data = value as Record<string, unknown>
  if (Object.keys(data).sort().join(',') !== 'fictional,projectId,publishableKey,secretKey,webhookSecret'
    || data.fictional !== true || data.projectId !== 'pea-clinical-lab'
    || typeof data.publishableKey !== 'string' || !/^pk_test_[A-Za-z0-9]+$/.test(data.publishableKey)
    || typeof data.secretKey !== 'string' || !/^sk_test_[A-Za-z0-9]+$/.test(data.secretKey)
    || typeof data.webhookSecret !== 'string' || !/^whsec_[A-Za-z0-9]+$/.test(data.webhookSecret)) throw new Error('STRIPE_TEST_CONFIG_REFUSED')
  return { publishableKey: data.publishableKey, secretKey: data.secretKey, webhookSecret: data.webhookSecret }
}
export function readLocalClinicalRuntime(directory = process.cwd()): LocalClinicalRuntime {
  // This guarded runtime path must never pull the local secret directory into a build artifact.
  const root = realpathSync(/* turbopackIgnore: true */ directory)
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, 'runtime.json')
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink() || realpathSync(dirname(file)) !== folder) throw new Error('LOCAL_RUNTIME_PATH_REFUSED')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LOCAL_RUNTIME_INVALID')
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1 || data.fictional !== true || data.projectId !== 'pea-clinical-lab' || data.supabaseUrl !== 'http://127.0.0.1:54321') throw new Error('LOCAL_RUNTIME_REFUSED')
  for (const key of ['anonKey', 'serviceRoleKey', 'dbUrl']) if (typeof data[key] !== 'string' || !(data[key] as string).length) throw new Error('LOCAL_RUNTIME_INCOMPLETE')
  const database = new URL(data.dbUrl as string)
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' || database.port !== '54322' || database.pathname !== '/postgres' || database.username !== 'postgres' || !database.password || database.search || database.hash) throw new Error('LOCAL_DATABASE_REFUSED')
  return { projectId: 'pea-clinical-lab', supabaseUrl: 'http://127.0.0.1:54321', anonKey: data.anonKey as string, serviceRoleKey: data.serviceRoleKey as string, dbUrl: data.dbUrl as string }
}
export function isLocalClinicalRuntime(environment: Record<string, string | undefined> = process.env) {
  return environment.PEA_CLINICAL_RUNTIME === 'local-db' && environment.PEA_ISOLATED_DEVELOPMENT === 'true' && environment.PEA_CLINICAL_FIXTURES === 'true' && !environment.VERCEL
}

export function readStagingClinicalRuntime(environment: Record<string, string | undefined> = process.env): StagingClinicalRuntime {
  if (!isStagingClinicalRuntime(environment)
    || !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || !environment.SUPABASE_SERVICE_ROLE_KEY
    || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY === environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('STAGING_RUNTIME_REFUSED')
  }
  return {
    projectId: 'pea-clinical-stage', supabaseUrl: 'https://csnmblsosfgjgljgtwyr.supabase.co',
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY, dbUrl: '',
  }
}

export function isDurableClinicalRuntime(environment: Record<string, string | undefined> = process.env) {
  return isLocalClinicalRuntime(environment) || isStagingClinicalRuntime(environment)
}

export function readDurableClinicalRuntime(directory = process.cwd(), environment: Record<string, string | undefined> = process.env): DurableClinicalRuntime {
  return isStagingClinicalRuntime(environment) ? readStagingClinicalRuntime(environment) : readLocalClinicalRuntime(directory)
}
