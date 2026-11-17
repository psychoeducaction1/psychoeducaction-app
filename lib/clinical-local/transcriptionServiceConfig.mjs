import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const FILE = 'transcription-service.json'
const PORT = 3411

export function readTranscriptionServiceConfig(directory = process.cwd()) {
  const root = realpathSync(/*turbopackIgnore: true*/ directory)
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, FILE)
  if (!existsSync(file)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink()
    || realpathSync(dirname(file)) !== folder) throw new Error('TRANSCRIPTION_SERVICE_PATH_REFUSED')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'fictional,host,port,projectId,schemaVersion,token'
    || value.schemaVersion !== 1 || value.fictional !== true || value.projectId !== 'pea-clinical-lab'
    || value.host !== '127.0.0.1' || value.port !== PORT
    || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) {
    throw new Error('TRANSCRIPTION_SERVICE_CONFIG_REFUSED')
  }
  return value
}

export function prepareTranscriptionServiceConfig(directory = process.cwd()) {
  const root = realpathSync(/*turbopackIgnore: true*/ directory)
  const folder = resolve(root, '.local-clinical')
  if (!existsSync(folder)) mkdirSync(folder, { mode: 0o700 })
  if (lstatSync(folder).isSymbolicLink() || realpathSync(folder) !== folder) {
    throw new Error('TRANSCRIPTION_SERVICE_PATH_REFUSED')
  }
  const existing = readTranscriptionServiceConfig(root)
  if (existing) return existing
  const config = { schemaVersion: 1, fictional: true, projectId: 'pea-clinical-lab', host: '127.0.0.1', port: PORT,
    token: randomBytes(32).toString('hex') }
  writeFileSync(resolve(folder, FILE), JSON.stringify(config), { flag: 'wx', mode: 0o600 })
  return config
}
