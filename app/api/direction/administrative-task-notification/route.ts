import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  ADMINISTRATIVE_TASK_NOTIFICATION_EMAIL,
  getAdministrativeTaskAssigneeLabel,
  type AdministrativeTaskAssignee,
} from '@/lib/administrativeTaskAccess'
import { sendResendEmail } from '@/lib/resendEmail'

function json(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function tokenFrom(request: NextRequest) {
  const value = request.headers.get('authorization') ?? ''
  return value.toLowerCase().startsWith('bearer ')
    ? value.slice('bearer '.length).trim()
    : ''
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const token = tokenFrom(request)
  if (!url || !key) return json({ error: 'Configuration Supabase manquante.' }, 500)
  if (!token) return json({ error: 'Non autorisé.' }, 401)

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Utilisateur introuvable.' }, 401)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()
  if (profile?.role !== 'direction') {
    return json({ error: 'Accès réservé à la direction.' }, 403)
  }

  const payload = (await request.json().catch(() => null)) as
    | { taskId?: unknown }
    | null
  const taskId = typeof payload?.taskId === 'string' ? payload.taskId.trim() : ''
  if (!taskId) return json({ error: 'La tâche est requise.' }, 400)

  const { data: task, error } = await supabase
    .from('administrative_tasks')
    .select('id, title, description, assigned_to, due_at')
    .eq('id', taskId)
    .limit(1)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!task) return json({ error: 'Tâche introuvable.' }, 404)

  const dueDate = task.due_at
    ? new Intl.DateTimeFormat('fr-CA', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/Toronto',
      }).format(new Date(task.due_at))
    : 'Aucune échéance'
  const assignedTo = getAdministrativeTaskAssigneeLabel(
    task.assigned_to as AdministrativeTaskAssignee
  )

  try {
    await sendResendEmail({
      to: ADMINISTRATIVE_TASK_NOTIFICATION_EMAIL,
      subject: `Nouvelle tâche administrative – ${task.title}`,
      text: [
        'Bonjour,',
        '',
        'Une nouvelle tâche administrative a été ajoutée dans la plateforme.',
        '',
        `Tâche : ${task.title}`,
        `Assignée à : ${assignedTo}`,
        `Échéance : ${dueDate}`,
        task.description ? `Détails : ${task.description}` : '',
        '',
        'Connectez-vous à la plateforme pour la consulter et la traiter.',
        '',
        'Clinique PsychoÉducAction',
      ].filter(Boolean).join('\n'),
    })
  } catch (caughtError) {
    return json(
      { error: caughtError instanceof Error ? caughtError.message : 'Envoi impossible.' },
      500
    )
  }

  await supabase
    .from('administrative_tasks')
    .update({ notification_sent_at: new Date().toISOString() })
    .eq('id', task.id)

  return json({ success: true }, 200)
}
