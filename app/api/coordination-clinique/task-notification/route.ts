import { NextRequest, NextResponse } from 'next/server'
import { getClinicalCoordinationContext } from '@/lib/clinicalCoordinationServer'
import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { sendResendEmail } from '@/lib/resendEmail'
import { SUPER_ADMIN_EMAIL } from '@/lib/superAdmin'

export async function POST(request: NextRequest) {
  const result = await getClinicalCoordinationContext(request)
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status })
  const { db, user, staff, isManager } = result.context
  let payload: Record<string, unknown>
  try { payload = await readBoundedJsonObject(request, 2048) } catch (error) {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: error instanceof JsonBodyError ? error.status : 400 })
  }
  if (typeof payload.taskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.taskId)) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  if (!staff) return NextResponse.json({ error: 'Espace indisponible.' }, { status: 409 })
  const { data: task, error } = await db.from('clinical_coordination_tasks').select('id, staff_id, created_by').eq('id', payload.taskId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Vérification impossible.' }, { status: 503 })
  if (!task || task.staff_id !== staff.id || task.created_by !== user.id) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  // Relecture du profil pour ne pas conserver une ancienne adresse après un changement.
  const { data: recipient, error: recipientError } = await db.from('profiles').select('email, platform_access_enabled').eq('id', staff.profile_id).maybeSingle()
  if (recipientError || !recipient?.email || recipient.platform_access_enabled === false) return NextResponse.json({ error: 'Destinataire indisponible.' }, { status: 409 })
  try {
    await sendResendEmail({ to: recipient.email, cc: isManager ? undefined : [SUPER_ADMIN_EMAIL],
      subject: 'Nouvelle tâche de coordination clinique',
      // Aucun détail clinique ni pièce jointe ne sort de l'espace privé.
      text: 'Bonjour,\n\nUne nouvelle tâche a été ajoutée dans votre espace de coordination clinique. Connectez-vous à la plateforme pour la consulter.\n\nClinique PsychoÉducAction',
      idempotencyKey: `clinical-coordination/task/${task.id}`,
    })
  } catch { return NextResponse.json({ error: 'La tâche est enregistrée, mais la notification n’a pas pu être envoyée.' }, { status: 502 }) }
  return NextResponse.json({ success: true })
}
