import { controlledMergeDestination } from './controlledMergeProfile.ts'
import { createHash } from 'node:crypto'
import { placedSignaturePdf, validPlacedSignature } from '../clinical-real/placedSignaturePdf.ts'
import { isMandatePdf } from '../clinical-mandates/transport.ts'
import type { MandatePdf } from '../clinical-mandates/types'
import { assertUnificationRuntime } from './isolation.ts'
import { documentStorageOperation, finishDocumentRpc } from '../clinical-real/documentStorage.ts'

type Source = { proofId: string; evidenceHash: string; documentHash: string; documentBase64: string; signatures: unknown[]; signatureSlots: number }
type Store = (args: Record<string, unknown>) => Promise<unknown>
const uuid = /^[a-f0-9-]{36}$/i
const hash = /^[a-f0-9]{64}$/
function source(value: unknown): value is Source {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Partial<Source>
  return typeof s.proofId === 'string' && uuid.test(s.proofId)
    && typeof s.evidenceHash === 'string' && hash.test(s.evidenceHash)
    && typeof s.documentHash === 'string' && hash.test(s.documentHash)
    && typeof s.documentBase64 === 'string' && s.documentBase64.length <= 7_000_000
    && Number.isInteger(s.signatureSlots) && Number(s.signatureSlots) > 0 && Number(s.signatureSlots) <= 30
    && Array.isArray(s.signatures) && s.signatures.length > 0 && s.signatures.length <= Number(s.signatureSlots)
    && s.signatures.every(validPlacedSignature)
}

/** Called only with the immutable recipe returned after an authorized signature.
 * The public request never supplies archive bytes or selects a proof to render. */
export async function archiveUnifiedSignedPdf(value: unknown, store: Store = storeLocalRenderedPdf): Promise<MandatePdf> {
  if (!source(value)) throw new Error('SIGNED_ARCHIVE_SOURCE_INVALID')
  const pdf = await placedSignaturePdf(value.documentBase64, value.documentHash, value.signatures, value.signatureSlots)
  const saved = await store({ p_proof_id: value.proofId, p_evidence_hash: value.evidenceHash,
    p_original_hash: value.documentHash, p_bytes_base64: Buffer.from(pdf.bytes).toString('base64'), p_sha256: pdf.sha256 })
  if (!isMandatePdf(saved)) throw new Error('SIGNED_ARCHIVE_RESULT_INVALID')
  const bytes = Buffer.from(saved.bytesBase64, 'base64')
  if (saved.byteLength !== bytes.byteLength || saved.sha256 !== pdf.sha256
    || createHash('sha256').update(bytes).digest('hex') !== saved.sha256
    || !bytes.equals(Buffer.from(pdf.bytes))) throw new Error('SIGNED_ARCHIVE_INTEGRITY_FAILED')
  return saved
}

/** Preview evidence is captured by PostgreSQL from the assigned professional's
 * profile. The browser cannot provide a signature, title or order number here. */
export async function renderAutomaticProfessionalPreview(original: MandatePdf, value: unknown): Promise<MandatePdf> {
  if (value === null) return original // Immutable versions predating automatic signatures.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROFESSIONAL_PREVIEW_INVALID')
  const recipe = value as Record<string, unknown>
  if (recipe.documentHash !== original.sha256 || recipe.documentBase64 !== original.bytesBase64
    || !['ready', 'missing'].includes(String(recipe.professionalSignatureStatus))
    || !Number.isInteger(recipe.signatureSlots) || Number(recipe.signatureSlots) < 0 || Number(recipe.signatureSlots) > 30
    || !Array.isArray(recipe.signatures) || recipe.signatures.length > 2
    || !recipe.signatures.every(validPlacedSignature)
    || (recipe.supervisorSignatureStatus !== undefined && !['ready', 'missing'].includes(String(recipe.supervisorSignatureStatus)))
    || recipe.signatures.length !== Number(recipe.professionalSignatureStatus === 'ready') + Number(recipe.supervisorSignatureStatus === 'ready'))
    throw new Error('PROFESSIONAL_PREVIEW_INVALID')
  const pdf = await placedSignaturePdf(original.bytesBase64, original.sha256, recipe.signatures, Number(recipe.signatureSlots))
  return { id: original.id, bytesBase64: Buffer.from(pdf.bytes).toString('base64'), sha256: pdf.sha256, byteLength: pdf.bytes.byteLength }
}

/** Recover any pending durable render after a successful canonical transaction.
 * The authenticated RPC decides which immutable sources this caller may read. */
export async function archiveAutomaticProfessionalSources(
  value: unknown, archive: (input: unknown) => Promise<MandatePdf> = archiveUnifiedSignedPdf,
): Promise<boolean> {
  if (!Array.isArray(value) || value.length > 100 || !value.every(source))
    throw new Error('AUTOMATIC_SIGNATURE_SOURCES_INVALID')
  for (const item of value) await archive(item)
  return value.length > 0
}

/** A narrowly scoped server-only persistence RPC. User/case authorization has
 * already occurred; this key cannot change conventions, evidence or case grants. */
async function storeLocalRenderedPdf(args: Record<string, unknown>): Promise<unknown> {
  assertUnificationRuntime()
  const url = process.env.PEA_CLINICAL_REAL_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url !== (process.env.PEA_CONTROLLED_MERGE === 'true' ? controlledMergeDestination.supabase : 'http://127.0.0.1:56321') || !key) throw new Error('LOCAL_SIGNED_ARCHIVE_REQUIRED')
  const operation = documentStorageOperation()
  const response = await fetch(`${url}/rest/v1/rpc/clinical_unified_store_signed_pdf`, {
    method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(operation ? { 'x-clinical-pdf-operation': operation } : {}) },
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error('SIGNED_ARCHIVE_STORE_FAILED')
  return finishDocumentRpc(await response.json(), url, operation, 'clinical_unified_store_signed_pdf')
}
