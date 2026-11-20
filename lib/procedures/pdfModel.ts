export const procedurePdfMaxBytes = 3 * 1024 * 1024
export type ProcedurePdf = { id: string; articleId: string; documentId: string; version: number; label: string; fileName: string; byteLength: number; createdAt: string }
export type ProcedurePdfInput = { id: string; articleId: string; documentId: string; expectedVersion: number; label: string; fileName: string; mediaType: 'application/pdf'; bytesBase64: string }
export type ProcedurePdfBytes = ProcedurePdf & { mediaType: 'application/pdf'; sha256: string; bytesBase64: string }
export function validProcedurePdfName(name: string) { return name.trim().length > 0 && name.length <= 180 && /\.pdf$/i.test(name) && !/[\x00-\x1f\x7f\\/]/.test(name) }
