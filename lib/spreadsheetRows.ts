import * as XLSX from 'xlsx'
import {
  MAX_SPREADSHEET_BYTES, MAX_SPREADSHEET_ROWS, MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_CELLS, MAX_SPREADSHEET_TEXT_LENGTH, type SpreadsheetReadOptions,
} from '@/lib/spreadsheetImportLimits'

// Exécuté dans un worker dédié : aucun HTML ni formule du classeur n'est exécuté.
export function parseSpreadsheetRows(buffer: ArrayBuffer, options: SpreadsheetReadOptions): unknown[][] {
  if (!buffer.byteLength || buffer.byteLength > MAX_SPREADSHEET_BYTES) throw new Error('Taille du fichier Excel invalide (maximum 10 Mo).')
  const signature = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength))
  const zip = signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 3 && signature[3] === 4
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, i) => signature[i] === byte)
  if (!zip && !ole) throw new Error('Le contenu du fichier ne correspond pas à un classeur Excel pris en charge.')
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, {
      type: 'array', sheets: 0, sheetRows: MAX_SPREADSHEET_ROWS + 1,
      cellDates: options.cellDates === true, cellHTML: false, cellStyles: false,
      cellFormula: false, bookVBA: false,
    })
  } catch {
    throw new Error('Le classeur Excel ne peut pas être lu. Vérifiez son format et sa validité.')
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const reference = sheet?.['!fullref'] ?? sheet?.['!ref']
  if (!sheet || !reference) throw new Error('La première feuille du classeur est vide.')
  const range = XLSX.utils.decode_range(reference)
  if (range.e.r >= MAX_SPREADSHEET_ROWS || range.e.c >= MAX_SPREADSHEET_COLUMNS ||
    (range.e.r + 1) * (range.e.c + 1) > MAX_SPREADSHEET_CELLS) {
    throw new Error('Le classeur dépasse les limites : 20 000 activités, 64 colonnes ou 500 000 cellules. Réduisez la période exportée.')
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: options.raw, range }) as unknown[][]
  if (rows.some(row => row.some(value => typeof value === 'string' && value.length > MAX_SPREADSHEET_TEXT_LENGTH))) {
    throw new Error('Une cellule dépasse la limite de 5 000 caractères.')
  }
  return rows
}
