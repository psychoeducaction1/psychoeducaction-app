import 'server-only'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { isLocalClinicalRuntime } from '@/lib/clinical-local/runtime'
import { deidentifyClinicalSources, parseClinicalIdentifiers } from '@/lib/clinical-workspace/deidentify'
import type { ClinicalSources } from '@/lib/clinicalNoteEngine'

const ROLES = new Set(['personne', 'père', 'mère', 'conjoint', 'conjointe', 'enfant', 'école', 'établissement', 'employeur', 'lieu'])
const SOURCES = new Set(['transcript', 'history', 'metadata'])
const MAX_RESULT_BYTES = 45_000
let active = 0

export type LanguageCandidate = { source: keyof ClinicalSources; term: string; role: string; reason: string; antecedent?: string }

export function localLanguageEngineConfig(directory = process.cwd()) {
  if (!isLocalClinicalRuntime()) return null
  const root = realpathSync(resolve(/*turbopackIgnore: true*/ directory))
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, 'language-engine.json')
  const modulePath = resolve(folder, 'nlp-python')
  const script = resolve(root, 'scripts', 'clinical-local', 'entity-coreference.py')
  if (!existsSync(file)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink()
    || realpathSync(file) !== file || !existsSync(modulePath) || lstatSync(modulePath).isSymbolicLink()
    || !existsSync(resolve(modulePath, 'fr_core_news_sm')) || !existsSync(script) || lstatSync(script).isSymbolicLink()) {
    throw new Error('LANGUAGE_ENGINE_PATH_REFUSED')
  }
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LANGUAGE_ENGINE_CONFIG_REFUSED')
  const config = value as Record<string, unknown>
  if (Object.keys(config).sort().join(',') !== 'fictional,model,pythonPath,schemaVersion'
    || config.schemaVersion !== 1 || config.fictional !== true || config.model !== 'fr_core_news_sm'
    || typeof config.pythonPath !== 'string' || !isAbsolute(config.pythonPath)
    || !/^python(?:\.exe)?$/i.test(basename(config.pythonPath))
    || !existsSync(config.pythonPath) || lstatSync(config.pythonPath).isSymbolicLink()) {
    throw new Error('LANGUAGE_ENGINE_CONFIG_REFUSED')
  }
  return { pythonPath: config.pythonPath, modulePath, script }
}

function validCandidates(value: unknown, sources: ClinicalSources): LanguageCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LANGUAGE_RESULT_INVALID')
  const candidates = (value as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length > 60) throw new Error('LANGUAGE_RESULT_INVALID')
  const seen = new Set<string>()
  return candidates.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('LANGUAGE_RESULT_INVALID')
    const candidate = item as Record<string, unknown>
    if (typeof candidate.source !== 'string' || !SOURCES.has(candidate.source)
      || typeof candidate.term !== 'string' || candidate.term.length < 2 || candidate.term.length > 80
      || typeof candidate.role !== 'string' || !ROLES.has(candidate.role)
      || typeof candidate.reason !== 'string' || candidate.reason.length > 160
      || (candidate.antecedent !== undefined && (typeof candidate.antecedent !== 'string' || candidate.antecedent.length > 80))) {
      throw new Error(`LANGUAGE_RESULT_INVALID_${index}`)
    }
    const source = candidate.source as keyof ClinicalSources
    if (!sources[source].toLocaleLowerCase('fr-CA').includes(candidate.term.toLocaleLowerCase('fr-CA'))
      || seen.has(candidate.term.toLocaleLowerCase('fr-CA'))) throw new Error('LANGUAGE_RESULT_INVALID')
    seen.add(candidate.term.toLocaleLowerCase('fr-CA'))
    return candidate as LanguageCandidate
  })
}

/** Invoked only after route authorization. The clinical text never enters command arguments or logs. */
export async function analyzeLocalLanguage(sources: ClinicalSources, signal?: AbortSignal, directory = process.cwd()): Promise<LanguageCandidate[]> {
  const config = localLanguageEngineConfig(directory)
  if (!config) throw new Error('LANGUAGE_ENGINE_UNAVAILABLE')
  if (active >= 2) throw new Error('LANGUAGE_ENGINE_BUSY')
  active++
  try {
    const input = JSON.stringify(sources)
    if (Buffer.byteLength(input) > 700_000) throw new Error('LANGUAGE_INPUT_LIMIT')
    const output = await new Promise<string>((resolveOutput, rejectOutput) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180_000)
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const child = spawn(config.pythonPath, [config.script], {
        cwd: directory, shell: false, windowsHide: true, signal: controller.signal, stdio: ['pipe', 'pipe', 'ignore'],
        env: { NODE_ENV: process.env.NODE_ENV ?? 'development', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
          TMP: process.env.TMP, PYTHONPATH: config.modulePath, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
          PYTHONIOENCODING: 'utf-8' },
      })
      const chunks: Buffer[] = []
      let size = 0
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > MAX_RESULT_BYTES) child.kill()
        else chunks.push(chunk)
      })
      child.once('error', rejectOutput)
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort)
        if (code !== 0 || size > MAX_RESULT_BYTES) rejectOutput(new Error('LANGUAGE_ENGINE_UNAVAILABLE'))
        else resolveOutput(Buffer.concat(chunks, size).toString('utf8'))
      })
      child.stdin.on('error', () => { /* The process failure is handled by close/error. */ })
      child.stdin.end(input)
    })
    return validCandidates(JSON.parse(output) as unknown, sources)
  } finally { active-- }
}

/** A local candidate must be removed from every prepared source or explicitly reviewed as a false positive. */
export function uncoveredLocalCandidates(prepared: ClinicalSources, candidates: readonly LanguageCandidate[], retained: unknown) {
  if (!Array.isArray(retained) || retained.length > candidates.length || retained.some(item => typeof item !== 'string')) return null
  const reviewed = new Set(retained as string[])
  if ([...reviewed].some(term => !candidates.some(candidate => candidate.term === term))) return null
  const terms = candidates.filter(candidate => !reviewed.has(candidate.term)).map(candidate => `${candidate.role}|${candidate.term}`)
  const identifiers = parseClinicalIdentifiers(terms)
  if (!identifiers) return null
  const checked = deidentifyClinicalSources(prepared, identifiers)
  return checked.transformations.filter(change => terms.some(term => term.slice(term.indexOf('|') + 1).toLocaleLowerCase('fr-CA') === change.original.toLocaleLowerCase('fr-CA')))
}
