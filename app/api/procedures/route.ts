import type { NextRequest } from 'next/server'
import { authorizeProcedures } from '@/lib/procedures/server'
import { handleProcedureRequest } from '@/lib/procedures/http'

export const dynamic = 'force-dynamic'
export const GET = (request: NextRequest) => handleProcedureRequest(request, () => authorizeProcedures(request))
export const POST = (request: NextRequest) => handleProcedureRequest(request, () => authorizeProcedures(request))
