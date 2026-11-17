import sharp from 'sharp'

type Point = { x: number; y: number }

/** A bounded vector rendition of an uploaded signature, kept alongside its original bytes. */
export async function signatureImageStrokes(bytes: Buffer): Promise<Point[][]> {
  if (bytes.length < 8 || bytes.length > 524288) throw new Error('SIGNATURE_IMAGE_INVALID')
  const { data, info } = await sharp(bytes, { limitInputPixels: 1_000_000, failOn: 'error' })
    .resize(160, 64, { fit: 'contain', background: '#ffffff', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).greyscale().raw()
    .toBuffer({ resolveWithObject: true })
  const strokes: Point[][] = []
  for (let y = 0; y < info.height; y++) {
    let start = -1
    for (let x = 0; x <= info.width; x++) {
      const dark = x < info.width && data[(y * info.width + x) * info.channels] < 190
      if (dark && start < 0) start = x
      if (!dark && start >= 0) {
        strokes.push([{ x: start / info.width, y: (y + 0.5) / info.height },
          { x: Math.max(start + 1, x) / info.width, y: (y + 0.5) / info.height }])
        if (strokes.length > 500) throw new Error('SIGNATURE_IMAGE_TOO_COMPLEX')
        start = -1
      }
    }
  }
  if (!strokes.length) throw new Error('SIGNATURE_IMAGE_EMPTY')
  return strokes
}
