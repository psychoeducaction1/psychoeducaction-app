import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
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

  const supabaseAdmin = getSupabaseAdmin()
  const { error: deleteError } = await supabaseAdmin
    .from('audit_logs')
    .delete()
    .eq('id', auditLogId)

  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 500)
  }

  return jsonResponse({ success: true }, 200)
}
