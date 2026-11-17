import type { NextRequest } from 'next/server'
import { authorizeProcedurePdfs } from '@/lib/procedures/server'
import { handleProcedurePdfRequest } from '@/lib/procedures/pdfHttp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleProcedurePdfRequest(request, (await context.params).id, () => authorizeProcedurePdfs(request))
}
