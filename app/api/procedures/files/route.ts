import type { NextRequest } from 'next/server'
import { authorizeProcedurePdfs } from '@/lib/procedures/server'
import { handleProcedurePdfRequest } from '@/lib/procedures/pdfHttp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const GET = (request: NextRequest) => handleProcedurePdfRequest(request, undefined, () => authorizeProcedurePdfs(request))
export const POST = GET
