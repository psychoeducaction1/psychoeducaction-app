import { NextRequest, NextResponse } from 'next/server'
import { getSuperAdminContext } from '@/lib/superAdminServer'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const superAdminResult = await getSuperAdminContext(request)

  if (superAdminResult.error) {
    return jsonResponse(
      { error: superAdminResult.error.message },
      superAdminResult.error.status
    )
  }

  const { id } = await context.params
  const auditLogId = normalizeId(id)

  if (!auditLogId) {
    return jsonResponse({ error: "L'identifiant de l'entrée est requis." }, 400)
  }

  // Compatibilité avec les anciens onglets : aucune suppression, même privilégiée.
  return jsonResponse({ error: 'Les entrées du journal sont conservées et ne peuvent plus être supprimées.' }, 410)
}
