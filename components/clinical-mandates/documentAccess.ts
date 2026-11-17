import { ClinicalApiError } from '@/lib/clinical-workspace/api'
export async function checkedPdfBlob(response: Response, expectedHash: string): Promise<Blob> {
  if (!response.ok) { const body = await response.json().catch(() => null); throw new ClinicalApiError(body?.error ?? 'PDF exact indisponible ou accès retiré.', response.status, body?.code) }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 8 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Le fichier reçu n’est pas le PDF attendu.')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== expectedHash) throw new Error('L’empreinte reçue ne correspond pas au document figé. Signature bloquée.')
  return new Blob([bytes], { type: 'application/pdf' })
}
