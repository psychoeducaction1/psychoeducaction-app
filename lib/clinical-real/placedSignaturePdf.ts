import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

type Placement = { page: number; x: number; y: number }
const slotsPerPage = 4
const slotYs = [0.76, 0.56, 0.36, 0.16] as const
export function signatureSlotPlacement(sourcePages: number, slotIndex: number): Placement {
  if (!Number.isInteger(sourcePages) || sourcePages < 1 || sourcePages > 128
    || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 30)
    throw new Error('INVALID_SIGNATURE_SLOT')
  return { page: sourcePages + Math.floor(slotIndex / slotsPerPage) + 1,
    x: 0.12, y: slotYs[slotIndex % slotsPerPage] }
}
export type PlacedSignature = {
  name: string
  style: 'caveat' | 'times'
  placement: Placement
  signedAt: string
  renderVersion?: 2 | 3 | null
  strokes?: { x: number; y: number }[][]
  professionalTitle?: string
  professionalOrderNumber?: string
}

function validProfessionalLabel(value: unknown, limit: number): boolean {
  return value === undefined || typeof value === 'string' && value.length > 0 && value.length <= limit
    && value.trim() === value && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
}

function wrapProfessionalLabel(text: string, font: PDFFont, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/u)) {
    if (line && font.widthOfTextAtSize(`${line} ${word}`, 8) > width) {
      lines.push(line)
      line = ''
    }
    if (font.widthOfTextAtSize(word, 8) <= width) line += `${line ? ' ' : ''}${word}`
    else for (const character of word) {
      if (line && font.widthOfTextAtSize(line + character, 8) > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}

export function validPlacedSignature(value: unknown): value is PlacedSignature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<PlacedSignature>
  const place = item.placement
  const strokes = item.strokes
  const strokesValid = strokes === undefined || Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 500
    && strokes.reduce((n, line) => n + (Array.isArray(line) ? line.length : 10001), 0) <= 10000
    && strokes.every(line => Array.isArray(line) && line.length >= 2 && line.every(point => point
      && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1))
  return typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 200
    && strokesValid
    && validProfessionalLabel(item.professionalTitle, 160)
    && validProfessionalLabel(item.professionalOrderNumber, 100)
    && (item.professionalTitle === undefined && item.professionalOrderNumber === undefined || item.renderVersion === 3)
    && (item.style === 'caveat' || item.style === 'times')
    && (item.renderVersion == null || item.renderVersion === 2 || item.renderVersion === 3)
    && typeof item.signedAt === 'string' && !Number.isNaN(Date.parse(item.signedAt))
    && !!place && Number.isInteger(place.page) && place.page >= 1 && place.page <= 136
    && typeof place.x === 'number' && place.x >= 0.02 && place.x <= 0.8
    && typeof place.y === 'number' && place.y >= 0.08 && place.y <= 0.95
}

export async function placedSignaturePdf(
  documentBase64: string, documentHash: string, signatures: unknown, signatureSlots = 0,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (!/^[a-f0-9]{64}$/i.test(documentHash) || typeof documentBase64 !== 'string')
    throw new Error('INVALID_DOCUMENT')
  const original = Buffer.from(documentBase64, 'base64')
  if (original.length > 5 * 1024 * 1024 || original.subarray(0, 5).toString() !== '%PDF-'
    || createHash('sha256').update(original).digest('hex') !== documentHash.toLowerCase())
    throw new Error('INVALID_DOCUMENT')
  if (!Array.isArray(signatures) || signatures.length > 30 || !signatures.every(validPlacedSignature))
    throw new Error('INVALID_SIGNATURES')
  if (!Number.isInteger(signatureSlots) || signatureSlots < 0 || signatureSlots > 30)
    throw new Error('INVALID_SIGNATURE_SLOTS')
  if (signatures.length === 0 && signatureSlots === 0)
    return { bytes: original, sha256: documentHash.toLowerCase() }

  const pdf = await PDFDocument.load(original, { updateMetadata: false })
  const sourcePages = pdf.getPageCount()
  if (sourcePages + Math.ceil(signatureSlots / slotsPerPage) > 136)
    throw new Error('SIGNATURE_PAGES_LIMIT')
  const firstPage = pdf.getPage(0)
  const { width: sheetWidth, height: sheetHeight } = firstPage.getSize()
  const labelFont = await pdf.embedFont(StandardFonts.Helvetica)
  for (let sheet = 0; sheet < Math.ceil(signatureSlots / slotsPerPage); sheet++) {
    const page = pdf.addPage([sheetWidth, sheetHeight])
    page.drawText('Signatures du document', { x: sheetWidth * 0.1, y: sheetHeight * 0.91,
      size: 15, font: labelFont, color: rgb(0.25, 0.18, 0.14) })
    for (let row = 0; row < slotsPerPage; row++) {
      const index = sheet * slotsPerPage + row
      if (index >= signatureSlots) break
      const y = slotYs[row] * sheetHeight
      page.drawText(`Signature ${index + 1}`, { x: sheetWidth * 0.1, y: y + 36,
        size: 9, font: labelFont, color: rgb(0.35, 0.35, 0.35) })
      page.drawLine({ start: { x: sheetWidth * 0.1, y: y - 20 },
        end: { x: sheetWidth * 0.88, y: y - 20 }, thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7) })
    }
  }
  const pages = pdf.getPages()
  let caveat: Awaited<ReturnType<typeof pdf.embedFont>> | undefined
  let times: Awaited<ReturnType<typeof pdf.embedFont>> | undefined
  for (const signature of signatures as PlacedSignature[]) {
    const page = pages[signature.placement.page - 1]
    if (!page) throw new Error('INVALID_SIGNATURE_PAGE')
    if (signature.renderVersion === 3 && (signatureSlots === 0
      || !Array.from({ length: signatureSlots }, (_, slot) => signatureSlotPlacement(sourcePages, slot))
        .some(place => place.page === signature.placement.page
          && place.x === signature.placement.x && place.y === signature.placement.y)))
      throw new Error('INVALID_SIGNATURE_SLOT')
    if (signature.style === 'caveat' && !caveat) {
      pdf.registerFontkit(fontkit)
      caveat = await pdf.embedFont(await readFile(join(process.cwd(), 'public', 'fonts', 'SignatureCursive.ttf')))
    }
    if (signature.style === 'times' && !times) times = await pdf.embedFont(StandardFonts.TimesRomanItalic)
    const font = signature.style === 'caveat' ? caveat! : times!
    const { width, height } = page.getSize()
    const x = signature.placement.x * width
    const y = signature.placement.y * height
    const inZone = signature.style === 'caveat' && signature.placement.page === pages.length
      && signature.placement.x === 0.12 && signature.placement.y === 0.1
    if (inZone && signature.renderVersion !== 2) page.drawRectangle({ x: width * 0.1, y: height * 0.07,
      width: width * 0.78, height: height * 0.06, borderWidth: 1,
      borderColor: rgb(0.68, 0.43, 0.13), color: rgb(1, 0.98, 0.88) })
    const size = Math.min(inZone || signature.renderVersion === 3 ? 28 : 34,
      (width * (inZone || signature.renderVersion === 3 ? 0.86 : 0.96) - x)
        / font.widthOfTextAtSize(signature.name, 1))
    if (!signature.strokes && (!Number.isFinite(size) || size < 8)) throw new Error('SIGNATURE_DOES_NOT_FIT')
    if (signature.strokes) {
      if (signature.renderVersion === 3 && labelFont.widthOfTextAtSize(signature.name, 8) > width * 0.74)
        throw new Error('SIGNATURE_DOES_NOT_FIT')
      for (const line of signature.strokes) for (let i = 1; i < line.length; i++) {
        page.drawLine({ start: { x: x + line[i - 1].x * width * 0.68, y: y + (1 - line[i - 1].y) * 28 },
          end: { x: x + line[i].x * width * 0.68, y: y + (1 - line[i].y) * 28 },
          thickness: 1.2, color: rgb(0.12, 0.16, 0.27) })
      }
      page.drawText(signature.name, { x, y: y - 31, size: 8, font: labelFont, color: rgb(0.25, 0.25, 0.25) })
    } else page.drawText(signature.name, { x, y, size, font, color: rgb(0.12, 0.16, 0.27) })
    const dateFont = await pdf.embedFont(StandardFonts.Helvetica)
    const signedAt = new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(signature.signedAt))
    page.drawText(`Signé électroniquement le ${signedAt}`, {
      x, y: Math.max(8, y - 13), size: 7, font: dateFont, color: rgb(0.25, 0.25, 0.25),
    })
    // These optional labels come from the immutable professional snapshot. Keep
    // older signatures byte-identical and fit every new label inside its slot.
    if (signature.professionalTitle !== undefined || signature.professionalOrderNumber !== undefined) {
      const lines = [signature.professionalTitle,
        signature.professionalOrderNumber === undefined ? undefined : `No d’ordre : ${signature.professionalOrderNumber}`]
        .flatMap(text => text === undefined ? [] : wrapProfessionalLabel(text, labelFont, width * 0.74))
      const top = y - (signature.strokes ? 44 : 33)
      const bottom = Math.max(20, y - height * 0.2 + 52)
      if (top - (lines.length - 1) * 11 < bottom) throw new Error('SIGNATURE_METADATA_DOES_NOT_FIT')
      for (const [index, text] of lines.entries()) page.drawText(text, {
        x, y: top - index * 11, size: 8, font: labelFont, color: rgb(0.25, 0.25, 0.25),
      })
    }
  }
  const bytes = await pdf.save({ useObjectStreams: false })
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}
