export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024
export const MAX_SPREADSHEET_ROWS = 20_001 // en-tête + 20 000 activités
export const MAX_SPREADSHEET_COLUMNS = 64
export const MAX_SPREADSHEET_CELLS = 500_000
export const MAX_SPREADSHEET_TEXT_LENGTH = 5_000
export const SPREADSHEET_TIMEOUT_MS = 15_000

export type SpreadsheetReadOptions = { raw: boolean; cellDates?: boolean }

export function validateSpreadsheetFile(file: { name: string; size: number }) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Choisissez un fichier Excel .xlsx ou .xls.')
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_SPREADSHEET_BYTES) {
    throw new Error('Le fichier Excel doit être non vide et ne pas dépasser 10 Mo.')
  }
}
