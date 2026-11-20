import { parseSpreadsheetRows, spreadsheetSheetNames } from '../lib/spreadsheetRows'
import type { SpreadsheetReadOptions } from '../lib/spreadsheetImportLimits'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ buffer: ArrayBuffer; options: SpreadsheetReadOptions; sheetsOnly?: boolean }>) => void) | null
  postMessage: (value: unknown) => void
}
workerScope.onmessage = ({ data }) => {
  try {
    workerScope.postMessage({ ok: true, rows: data.sheetsOnly ? [spreadsheetSheetNames(data.buffer)] : parseSpreadsheetRows(data.buffer, data.options) })
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Impossible de lire ce classeur Excel.' })
  }
}
