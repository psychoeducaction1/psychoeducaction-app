import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendEmail } from '@/lib/resendEmail'
import { isSuperAdmin } from '@/lib/superAdmin'

const DIRECTION_EMAIL = 'contact@psychoeducaction.com'

type RequestBody = {
  taskId?: unknown
}

function json(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : ''
}

function formatDueDate(value: string | null) {
  if (!value) return 'Aucune échéance'

  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(new Date(value))
}

function taskDetails({
  title,
  description,
  priority,
  dueAt,
}: {
  title: string
  description: string | null
  priority: string
  dueAt: string | null
}) {
  const priorityLabels: Record<string, string> = {
    low: 'Basse',
    normal: 'Normale',
    high: 'Haute',
  }

  return [
    `Tâche : ${title}`,
    `Priorité : ${priorityLabels[priority] ?? priority}`,
    `Échéance : ${formatDueDate(dueAt)}`,
    description ? `Détails : ${description}` : '',
  ].filter(Boolean)
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const accessToken = getBearerToken(request)

  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: 'Configuration Supabase manquante.' }, 500)
  }
  if (!accessToken) return json({ error: 'Non autorisé.' }, 401)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Utilisateur introuvable.' }, 401)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)
  const hasDirectionAccess = isSuperAdmin({ email: user.email }, profile)
  if (!profile || (profile.role !== 'marketing' && !hasDirectionAccess)) {
    return json({ error: 'Accès non autorisé.' }, 403)
  }

  const payload = (await request.json().catch(() => null)) as RequestBody | null
  const taskId = typeof payload?.taskId === 'string' ? payload.taskId.trim() : ''
  if (!taskId) return json({ error: "L'identifiant de la tâche est requis." }, 400)

  const { data: task, error: taskError } = await supabase
    .from('marketing_tasks')
    .select('id, staff_id, title, description, priority, due_at, created_by')
    .eq('id', taskId)
    .limit(1)
    .maybeSingle()
  if (taskError) return json({ error: taskError.message }, 500)
  if (!task) return json({ error: 'Tâche introuvable.' }, 404)
  if (task.created_by !== user.id) {
    return json({ error: 'Cette notification doit être envoyée par le créateur de la tâche.' }, 403)
  }

  const { data: staff, error: staffError } = await supabase
    .from('marketing_staff')
    .select('profile_id, full_name, email, is_active')
    .eq('id', task.staff_id)
    .limit(1)
    .maybeSingle()
  if (staffError) return json({ error: staffError.message }, 500)
  if (!staff?.is_active || !staff.email?.trim()) {
    return json({ error: 'Le courriel de Camille est introuvable.' }, 404)
  }
  if (profile.role === 'marketing' && staff.profile_id !== user.id) {
    return json({ error: 'Cette tâche ne vous appartient pas.' }, 403)
  }

  const details = taskDetails({
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.due_at,
  })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  const marketingLink = appUrl ? `${appUrl}/marketing` : null

  try {
    await sendResendEmail({
      to: staff.email.trim(),
      subject: `Nouvelle tâche marketing : ${task.title}`,
      text: [
        `Bonjour ${staff.full_name?.split(' ')[0] || 'Camille'},`,
        '',
        profile.role === 'marketing'
          ? 'Votre nouvelle tâche a bien été ajoutée dans votre espace marketing.'
          : 'Une nouvelle tâche vous a été attribuée dans votre espace marketing.',
        '',
        ...details,
        '',
        marketingLink
          ? `Consulter la tâche : ${marketingLink}`
          : 'Connectez-vous à la plateforme pour consulter la tâche.',
        '',
        'Clinique PsychoÉducAction',
      ].join('\n'),
    })

    if (profile.role === 'marketing') {
      const creatorName = profile.full_name?.trim() || profile.email?.trim() || 'Camille Payette'
      await sendResendEmail({
        to: DIRECTION_EMAIL,
        subject: `Nouvelle tâche créée par Camille : ${task.title}`,
        text: [
          'Bonjour,',
          '',
          `${creatorName} a ajouté une nouvelle tâche dans son espace marketing.`,
          '',
          ...details,
          '',
          marketingLink
            ? `Consulter la tâche : ${marketingLink}`
            : 'Connectez-vous à la plateforme pour consulter la tâche.',
          '',
          'Clinique PsychoÉducAction',
        ].join('\n'),
      })
    }
  } catch (caughtError) {
    return json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "La notification n'a pas pu être envoyée.",
      },
      500
    )
  }

  return json({
    success: true,
    recipients:
      profile.role === 'marketing'
        ? [staff.email.trim(), DIRECTION_EMAIL]
        : [staff.email.trim()],
  }, 200)
}
