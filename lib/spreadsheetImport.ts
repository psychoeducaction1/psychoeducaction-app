import { MAX_SPREADSHEET_BYTES, SPREADSHEET_TIMEOUT_MS, validateSpreadsheetFile, type SpreadsheetReadOptions } from '@/lib/spreadsheetImportLimits'

type ImportWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
type ImportDependencies = { createWorker?: () => ImportWorker; timeoutMs?: number }

export async function readSpreadsheetRows(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
  options: SpreadsheetReadOptions,
  signal?: AbortSignal,
  dependencies: ImportDependencies = {},
): Promise<unknown[][]> {
  validateSpreadsheetFile(file)
  signal?.throwIfAborted()
  const buffer = await file.arrayBuffer()
  signal?.throwIfAborted()
  if (!buffer.byteLength || buffer.byteLength > MAX_SPREADSHEET_BYTES) throw new Error('Taille du fichier Excel invalide (maximum 10 Mo).')
  return new Promise((resolve, reject) => {
    const worker = dependencies.createWorker?.() ?? new Worker(new URL('../workers/spreadsheetImport.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: Error, rows?: unknown[][]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(rows!)
    }
    const abort = () => finish(new DOMException('Import annulé.', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('La lecture du classeur a pris trop de temps. Réduisez la taille du fichier.')), dependencies.timeoutMs ?? SPREADSHEET_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(new Error('Impossible de lire ce classeur Excel.'))
    worker.onmessage = ({ data }: MessageEvent) => {
      if (data?.ok === true && Array.isArray(data.rows) && data.rows.every(Array.isArray)) finish(undefined, data.rows)
      else finish(new Error(data?.ok === false && typeof data.error === 'string' ? data.error : 'Réponse de lecture Excel invalide.'))
    }
    try { worker.postMessage({ buffer, options }, [buffer]) } catch { finish(new Error('Impossible de démarrer la lecture Excel.')) }
  })
}
