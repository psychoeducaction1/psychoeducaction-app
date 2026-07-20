import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { buildProfessionalPendingReminderEmailTemplate } from '@/lib/assignmentEmailTemplates'
import { getAssignmentRequestMetrics } from '@/app/professionnel/shared'

export const dynamic = 'force-dynamic'

const REMINDER_DELAY_DAYS = 3
const ASSIGNED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Constante métier (pas un secret, pas une variable d'environnement) : le rappel
// automatique ne s'applique qu'aux assignations créées à partir de cette date. Les
// assignations antérieures ne reçoivent jamais de rappel, même si elles remplissent les
// autres critères d'éligibilité.
const PENDING_CONTACT_REMINDER_START_DATE = '2026-07-15'

type PendingAssignedClientRow = {
  id: string
  professional_id: string | null
  assignment_request_id: string | null
  first_name: string | null
  last_name: string | null
  assigned_date: string | null
  dossier_closed: boolean | null
  contacted: boolean | null
}

type AssignmentRequestRow = {
  id: string
  is_active: boolean | null
  requested_count: number | null
}

type ProfessionalProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  platform_access_enabled: boolean | null
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function getCutoffDateString(daysAgo: number): string {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - daysAgo)
  return cutoff.toISOString().slice(0, 10)
}

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.psychoeducaction.com').replace(
    /\/$/,
    ''
  )
}

async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string
  subject: string
  text: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? 'Assignations PsychoÉducAction <onboarding@resend.dev>'

  if (!apiKey) {
    throw new Error('RESEND_API_KEY est manquant.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject,
      text,
    }),
  })

  const responseText = await response.text()
  console.log('[pending-assignment-reminders] Resend response:', {
    status: response.status,
    ok: response.ok,
    body: response.ok ? undefined : responseText,
  })

  if (!response.ok) {
    throw new Error(`Erreur Resend ${response.status}: ${responseText || response.statusText}`)
  }
}

export async function GET(request: NextRequest) {
  console.log('[pending-assignment-reminders] Route appelée.')

  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return jsonResponse({ error: 'CRON_SECRET est manquant côté serveur.' }, 500)
  }

  const authorization = request.headers.get('authorization') ?? ''

  if (authorization !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Non autorisé.' }, 401)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const cutoffDate = getCutoffDateString(REMINDER_DELAY_DAYS)

  const { data: candidateRows, error: candidateError } = await supabaseAdmin
    .from('assigned_clients')
    .select(
      'id, professional_id, assignment_request_id, first_name, last_name, assigned_date, dossier_closed, contacted'
    )
    .eq('contacted', false)
    .is('canceled_at', null)
    .is('pending_contact_reminder_sent_at', null)
    .not('assigned_date', 'is', null)
    .not('assignment_request_id', 'is', null)
    .lte('assigned_date', cutoffDate)

  if (candidateError) {
    return jsonResponse({ error: candidateError.message }, 500)
  }

  const allCandidates = (candidateRows ?? []) as PendingAssignedClientRow[]

  let invalidDatesSkipped = 0
  let closedDossiersExcluded = 0
  let assignmentsExcludedBeforeStartDate = 0

  const validCandidates = allCandidates.filter((row) => {
    if (!row.assigned_date || !ASSIGNED_DATE_PATTERN.test(row.assigned_date)) {
      console.warn('[pending-assignment-reminders] assigned_date invalide ignorée:', {
        id: row.id,
        assignedDate: row.assigned_date,
      })
      invalidDatesSkipped++
      return false
    }

    // Règle métier : le rappel automatique ne s'applique qu'aux assignations créées à
    // partir de PENDING_CONTACT_REMINDER_START_DATE. Les assignations antérieures ne
    // doivent jamais recevoir de rappel, même si elles remplissent les autres critères.
    if (row.assigned_date < PENDING_CONTACT_REMINDER_START_DATE) {
      assignmentsExcludedBeforeStartDate++
      return false
    }

    if (row.dossier_closed === true) {
      closedDossiersExcluded++
      return false
    }

    return true
  })

  console.log('[pending-assignment-reminders] Candidats bruts:', {
    cutoffDate,
    reminderStartDate: PENDING_CONTACT_REMINDER_START_DATE,
    total: allCandidates.length,
    valides: validCandidates.length,
    invalidDatesSkipped,
    assignmentsExcludedBeforeStartDate,
    closedDossiersExcluded,
  })

  if (validCandidates.length === 0) {
    return jsonResponse(
      {
        success: true,
        professionalsNotified: 0,
        clientsNotified: 0,
        professionalsSkipped: 0,
        professionalsSkippedNoPlatformAccess: 0,
        requestsExcludedAsCompleted: 0,
        closedDossiersExcluded,
        assignmentsExcludedBeforeStartDate,
        invalidDatesSkipped,
        errors: [],
      },
      200
    )
  }

  const requestIds = Array.from(
    new Set(validCandidates.map((row) => row.assignment_request_id).filter(Boolean))
  ) as string[]

  const [{ data: requestsData, error: requestsError }, { data: acceptedCountRows, error: acceptedCountError }] =
    await Promise.all([
      supabaseAdmin
        .from('assignment_requests')
        .select('id, is_active, requested_count')
        .in('id', requestIds),
      supabaseAdmin
        .from('assigned_clients')
        .select('assignment_request_id')
        .in('assignment_request_id', requestIds)
        .eq('is_active', true)
        .is('canceled_at', null),
    ])

  if (requestsError) {
    return jsonResponse({ error: requestsError.message }, 500)
  }

  if (acceptedCountError) {
    return jsonResponse({ error: acceptedCountError.message }, 500)
  }

  const acceptedCountByRequestId = new Map<string, number>()
  for (const row of (acceptedCountRows ?? []) as { assignment_request_id: string | null }[]) {
    if (!row.assignment_request_id) continue
    acceptedCountByRequestId.set(
      row.assignment_request_id,
      (acceptedCountByRequestId.get(row.assignment_request_id) ?? 0) + 1
    )
  }

  const requestsById = new Map<string, AssignmentRequestRow>(
    ((requestsData ?? []) as AssignmentRequestRow[]).map((request) => [request.id, request])
  )

  let requestsExcludedAsCompleted = 0

  const eligibleCandidates = validCandidates.filter((row) => {
    const request = row.assignment_request_id ? requestsById.get(row.assignment_request_id) : null

    if (!request) return false

    const metrics = getAssignmentRequestMetrics({
      isActive: request.is_active,
      requestedCount: request.requested_count,
      acceptedCount: acceptedCountByRequestId.get(request.id) ?? 0,
    })

    if (metrics.isCompleted) {
      requestsExcludedAsCompleted++
      return false
    }

    return true
  })

  console.log('[pending-assignment-reminders] Après exclusion des demandes complétées:', {
    eligible: eligibleCandidates.length,
    requestsExcludedAsCompleted,
  })

  const grouped = new Map<string, PendingAssignedClientRow[]>()
  for (const row of eligibleCandidates) {
    if (!row.professional_id) continue
    const list = grouped.get(row.professional_id) ?? []
    list.push(row)
    grouped.set(row.professional_id, list)
  }

  const professionalIds = Array.from(grouped.keys())

  if (professionalIds.length === 0) {
    return jsonResponse(
      {
        success: true,
        professionalsNotified: 0,
        clientsNotified: 0,
        professionalsSkipped: 0,
        professionalsSkippedNoPlatformAccess: 0,
        requestsExcludedAsCompleted,
        closedDossiersExcluded,
        assignmentsExcludedBeforeStartDate,
        invalidDatesSkipped,
        errors: [],
      },
      200
    )
  }

  const { data: profilesData, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, platform_access_enabled')
    .in('id', professionalIds)

  if (profilesError) {
    return jsonResponse({ error: profilesError.message }, 500)
  }

  const profilesMap = new Map<string, ProfessionalProfileRow>(
    ((profilesData ?? []) as ProfessionalProfileRow[]).map((profile) => [profile.id, profile])
  )

  const appUrl = getAppUrl()
  let professionalsNotified = 0
  let professionalsSkipped = 0
  let professionalsSkippedNoPlatformAccess = 0
  let clientsNotified = 0
  const errors: Array<{ professionalId: string; message: string }> = []

  for (const professionalId of professionalIds) {
    const clients = grouped.get(professionalId) ?? []
    const profile = profilesMap.get(professionalId)

    if (!profile || !profile.email?.trim()) {
      professionalsSkipped++
      continue
    }

    // Un professionnel sans accès plateforme est toujours exclu, et aucune de ses
    // lignes n'est marquée/claim, afin qu'aucun timestamp de rappel ne soit inscrit.
    if (profile.platform_access_enabled === false) {
      professionalsSkipped++
      professionalsSkippedNoPlatformAccess++
      continue
    }

    const clientIds = clients.map((client) => client.id)

    // Étape de "claim" atomique : seules les lignes encore non marquées sont
    // effectivement mises à jour. Sert de vérification fraîche juste avant l'envoi et
    // réduit le risque de double envoi si deux exécutions du cron se chevauchent.
    const nowIso = new Date().toISOString()
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('assigned_clients')
      .update({ pending_contact_reminder_sent_at: nowIso })
      .in('id', clientIds)
      .is('pending_contact_reminder_sent_at', null)
      .select('id')

    if (claimError) {
      errors.push({ professionalId, message: `Échec du claim: ${claimError.message}` })
      continue
    }

    const claimedIds = new Set(((claimedRows ?? []) as { id: string }[]).map((row) => row.id))

    if (claimedIds.size === 0) {
      continue
    }

    const claimedClients = clients.filter((client) => claimedIds.has(client.id))
    const professionalName = profile.full_name?.trim() || profile.email.trim()
    const template = buildProfessionalPendingReminderEmailTemplate({
      professionalName,
      professionalEmail: profile.email,
      appUrl,
      pendingClients: claimedClients.map((client) => ({
        firstName: client.first_name?.trim() || 'Client',
        lastName: client.last_name?.trim() || '',
        assignedDate: client.assigned_date ?? cutoffDate,
      })),
    })

    try {
      await sendEmail({ to: template.to, subject: template.subject, text: template.message })
    } catch (error) {
      console.error(
        "[pending-assignment-reminders] Échec d'envoi courriel, annulation du claim pour réessai:",
        { professionalId, clientIds: Array.from(claimedIds), error }
      )

      const { error: rollbackError } = await supabaseAdmin
        .from('assigned_clients')
        .update({ pending_contact_reminder_sent_at: null })
        .in('id', Array.from(claimedIds))

      if (rollbackError) {
        console.error('[pending-assignment-reminders] Échec du rollback du claim:', {
          professionalId,
          clientIds: Array.from(claimedIds),
          message: rollbackError.message,
        })
      }

      errors.push({
        professionalId,
        message: error instanceof Error ? error.message : "Erreur inconnue pendant l'envoi.",
      })
      continue
    }

    try {
      await supabaseAdmin.from('audit_logs').insert({
        actor_profile_id: null,
        actor_name: 'Rappel automatique (tâche planifiée)',
        actor_role: null,
        action: 'pending_contact_reminder_sent',
        entity_type: 'profile',
        entity_id: professionalId,
        description: `Rappel automatique envoyé à ${professionalName} pour ${claimedIds.size} client(s) en attente de contact.`,
        metadata: {
          professional_id: professionalId,
          professional_email: profile.email,
          client_count: claimedIds.size,
          assigned_client_ids: Array.from(claimedIds),
          cutoff_date: cutoffDate,
        },
      })
    } catch (auditError) {
      console.error("[pending-assignment-reminders] Échec de l'écriture audit_logs (non bloquant):", {
        professionalId,
        error: auditError,
      })
    }

    professionalsNotified++
    clientsNotified += claimedIds.size
  }

  const summary = {
    success: true,
    professionalsNotified,
    clientsNotified,
    professionalsSkipped,
    professionalsSkippedNoPlatformAccess,
    requestsExcludedAsCompleted,
    closedDossiersExcluded,
    assignmentsExcludedBeforeStartDate,
    invalidDatesSkipped,
    errors,
  }

  console.log('[pending-assignment-reminders] Résumé:', summary)

  return jsonResponse(summary, 200)
}
