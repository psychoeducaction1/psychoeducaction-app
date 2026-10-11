import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildEligibleList,
  generateSatisfactionToken,
  groupEncountersByClient,
  resolveUniqueSatisfactionRecipients,
  type SatisfactionEncounter,
} from '@/lib/satisfaction'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00`)
  return !Number.isNaN(parsed.getTime())
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

type WaitingListEmailRow = {
  client_name: string | null
  first_requester_name: string | null
  second_requester_name: string | null
  contact_email: string | null
  contact_emails: string[] | string | null
}

function getContactEmails(row: WaitingListEmailRow): string[] {
  const list = Array.isArray(row.contact_emails)
    ? row.contact_emails
    : typeof row.contact_emails === 'string'
      ? [row.contact_emails]
      : []
  return [row.contact_email, ...list].map((email) => normalizeText(email))
}

async function logAudit(params: {
  actorId: string
  actorName: string | null
  actorRole: string | null
  action: string
  entityId: string | null
  description: string
  metadata: Record<string, unknown>
}) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin.from('audit_logs').insert({
      actor_profile_id: params.actorId,
      actor_name: params.actorName,
      actor_role: params.actorRole,
      action: params.action,
      entity_type: 'satisfaction_import',
      entity_id: params.entityId,
      description: params.description,
      metadata: params.metadata,
    })
  } catch (error) {
    console.error('[satisfaction-import] Audit log non bloquant:', {
      message: error instanceof Error ? error.message : 'Erreur inconnue',
    })
  }
}

/**
 * POST /api/satisfaction/import
 * Reçoit les rencontres parsées côté client + la période, regroupe par client,
 * applique le seuil (≥ 4), déduplique, exclut les déjà-sollicités et les
 * désabonnés, apparie les courriels via la liste d'attente, puis crée l'import
 * et les éligibles. La direction vérifie la liste AVANT tout envoi.
 */
export async function POST(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const actor = directionResult.context

  let body: {
    encounters?: unknown
    periodStart?: unknown
    periodEnd?: unknown
    fileName?: unknown
  }

  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const encounters = Array.isArray(body.encounters)
    ? (body.encounters as SatisfactionEncounter[])
    : []
  const periodStart = normalizeText(body.periodStart)
  const periodEnd = normalizeText(body.periodEnd)
  const fileName = normalizeText(body.fileName)

  if (encounters.length === 0) {
    return jsonResponse(
      { error: 'Aucune rencontre à analyser. Vérifiez le fichier importé.' },
      400
    )
  }
  if (!isValidDateString(periodStart) || !isValidDateString(periodEnd)) {
    return jsonResponse({ error: 'Période invalide.' }, 400)
  }
  if (periodStart > periodEnd) {
    return jsonResponse(
      { error: 'La date de début doit précéder la date de fin.' },
      400
    )
  }

  const supabaseAdmin = getSupabaseAdmin()

  try {
    const groups = groupEncountersByClient(encounters, periodStart, periodEnd)

    const { data: solicitedRows, error: solicitedError } = await supabaseAdmin
      .from('satisfaction_eligibles')
      .select('client_nom_normalise')
      .in('statut', ['en_cours', 'envoye'])

    if (solicitedError) throw solicitedError

    const { data: unsubscribedRows, error: unsubscribedError } =
      await supabaseAdmin.from('satisfaction_desabonnes').select('nom_normalise')

    if (unsubscribedError) throw unsubscribedError

    const alreadySolicited = new Set(
      (solicitedRows ?? []).map((row) => row.client_nom_normalise)
    )
    const unsubscribed = new Set(
      (unsubscribedRows ?? []).map((row) => row.nom_normalise)
    )

    const eligibleGroups = buildEligibleList(groups, alreadySolicited, unsubscribed)

    // Appariement des courriels via les fiches de la liste d'attente.
    const { data: waitingListRows, error: waitingListError } = await supabaseAdmin
      .from('waiting_list_clients')
      .select(
        'client_name, first_requester_name, second_requester_name, contact_email, contact_emails'
      )

    if (waitingListError) throw waitingListError

    const contactRows = ((waitingListRows ?? []) as WaitingListEmailRow[]).map(
      (row) => ({
        clientName: row.client_name,
        requesterNames: [row.first_requester_name, row.second_requester_name],
        emails: getContactEmails(row),
      })
    )

    const { data: importRow, error: importError } = await supabaseAdmin
      .from('satisfaction_imports')
      .insert({
        imported_by: actor.user.id,
        period_start: periodStart,
        period_end: periodEnd,
        row_count: encounters.length,
        file_name: fileName || null,
      })
      .select('id, imported_at, period_start, period_end, row_count, file_name')
      .single()

    if (importError) throw importError

    const eligibleInserts = eligibleGroups.map((group) => {
      const match = resolveUniqueSatisfactionRecipients(
        group.clientNomNormalise,
        contactRows
      )
      const recipientNames = match?.names.length
        ? match.names
        : [group.destinataireNom]

      return {
        import_id: importRow.id,
        client_nom: group.clientNom,
        client_nom_normalise: group.clientNomNormalise,
        destinataire_nom: recipientNames.join(' / '),
        destinataire_email: match?.emails[0] ?? null,
        destinataire_emails: match?.emails ?? [],
        professionnel: group.professionnel,
        nb_rencontres: group.nbRencontres,
        derniere_rencontre: group.derniereRencontre,
        statut: 'en_attente',
        jeton_reponse: generateSatisfactionToken(),
        jeton_desabonnement: generateSatisfactionToken(),
      }
    })

    let eligibles: Record<string, unknown>[] = []

    if (eligibleInserts.length > 0) {
      const { data, error: eligiblesError } = await supabaseAdmin
        .from('satisfaction_eligibles')
        .insert(eligibleInserts)
        .select(
          'id, client_nom, destinataire_nom, destinataire_email, destinataire_emails, professionnel, nb_rencontres, derniere_rencontre, statut, jeton_reponse, jeton_desabonnement'
        )
        .order('destinataire_nom', { ascending: true })

      if (eligiblesError) throw eligiblesError
      eligibles = (data ?? []) as Record<string, unknown>[]
    }

    const missingEmailCount = eligibles.filter(
      (row) => !normalizeText(row.destinataire_email)
    ).length

    await logAudit({
      actorId: actor.user.id,
      actorName: actor.profile.full_name ?? actor.user.email ?? null,
      actorRole: actor.profile.role,
      action: 'satisfaction_import_created',
      entityId: importRow.id,
      description: `Import satisfaction : ${eligibles.length} client(s) éligible(s)${fileName ? ` (${fileName})` : ''}.`,
      metadata: {
        import_id: importRow.id,
        file_name: fileName || null,
        period_start: periodStart,
        period_end: periodEnd,
        encounter_count: encounters.length,
        eligible_count: eligibles.length,
        missing_email_count: missingEmailCount,
      },
    })

    return jsonResponse(
      {
        success: true,
        import: importRow,
        eligibles,
        missingEmailCount,
      },
      200
    )
  } catch (error) {
    console.error('[satisfaction-import] Erreur:', error)
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur inconnue pendant l'analyse du fichier.",
      },
      500
    )
  }
}

/**
 * GET /api/satisfaction/import?importId=…
 * Sans importId : historique des imports avec statistiques.
 * Avec importId : éligibles d'un import précis (pour révision).
 */
export async function GET(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const importId = request.nextUrl.searchParams.get('importId')

  try {
    if (importId) {
      const { data: eligibles, error } = await supabaseAdmin
        .from('satisfaction_eligibles')
        .select(
          'id, import_id, client_nom, destinataire_nom, destinataire_email, destinataire_emails, professionnel, nb_rencontres, derniere_rencontre, statut, jeton_reponse, jeton_desabonnement, created_at'
        )
        .eq('import_id', importId)
        .order('destinataire_nom', { ascending: true })

      if (error) throw error

      return jsonResponse({ eligibles: eligibles ?? [] }, 200)
    }

    const { data: imports, error: importsError } = await supabaseAdmin
      .from('satisfaction_imports')
      .select('id, imported_at, period_start, period_end, row_count, file_name')
      .order('imported_at', { ascending: false })
      .limit(20)

    if (importsError) throw importsError

    const importIds = (imports ?? []).map((row) => row.id)

    const statsByImport: Record<
      string,
      { eligible_count: number; sent_count: number; response_count: number }
    > = {}

    for (const id of importIds) {
      statsByImport[id] = { eligible_count: 0, sent_count: 0, response_count: 0 }
    }

    if (importIds.length > 0) {
      const { data: eligibleRows, error: eligibleError } = await supabaseAdmin
        .from('satisfaction_eligibles')
        .select('id, import_id, statut')
        .in('import_id', importIds)

      if (eligibleError) throw eligibleError

      const eligibleIds: string[] = []
      const importByEligibleId = new Map<string, string>()

      for (const row of eligibleRows ?? []) {
        eligibleIds.push(row.id)
        importByEligibleId.set(row.id, row.import_id)
        const stats = statsByImport[row.import_id]
        if (stats) {
          stats.eligible_count += 1
          if (row.statut === 'envoye') stats.sent_count += 1
        }
      }

      if (eligibleIds.length > 0) {
        const { data: responseRows, error: responseError } = await supabaseAdmin
          .from('satisfaction_reponses')
          .select('eligible_id')
          .in('eligible_id', eligibleIds)

        if (responseError) throw responseError

        for (const row of responseRows ?? []) {
          const currentImportId = importByEligibleId.get(row.eligible_id)
          const stats = currentImportId
            ? statsByImport[currentImportId]
            : undefined
          if (stats) stats.response_count += 1
        }
      }
    }

    return jsonResponse(
      {
        imports: (imports ?? []).map((row) => ({
          ...row,
          ...(statsByImport[row.id] ?? {
            eligible_count: 0,
            sent_count: 0,
            response_count: 0,
          }),
        })),
      },
      200
    )
  } catch (error) {
    console.error('[satisfaction-import] Erreur lecture:', error)
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue pendant la lecture.',
      },
      500
    )
  }
}

/**
 * PATCH /api/satisfaction/import
 * { eligibleId, statut?: 'exclu' | 'en_attente', destinataireEmail?: string }
 * Permet d'exclure / réintégrer manuellement un éligible et de compléter
 * un courriel manquant avant l'envoi.
 */
export async function PATCH(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const actor = directionResult.context

  let body: { eligibleId?: unknown; statut?: unknown; destinataireEmail?: unknown }

  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const eligibleId = normalizeText(body.eligibleId)
  if (!eligibleId) {
    return jsonResponse({ error: 'eligibleId est requis.' }, 400)
  }

  const updates: Record<string, string | string[] | null> = {}

  if (body.statut !== undefined) {
    const statut = normalizeText(body.statut)
    if (statut !== 'exclu' && statut !== 'en_attente') {
      return jsonResponse({ error: 'Statut invalide.' }, 400)
    }
    updates.statut = statut
  }

  if (body.destinataireEmail !== undefined) {
    const email = normalizeText(body.destinataireEmail)
    if (email && !isValidEmail(email)) {
      return jsonResponse({ error: 'Courriel invalide.' }, 400)
    }
    updates.destinataire_email = email || null
    updates.destinataire_emails = email ? [email] : []
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'Rien à mettre à jour.' }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()

  try {
    const { data: current, error: currentError } = await supabaseAdmin
      .from('satisfaction_eligibles')
      .select('id, statut, destinataire_nom')
      .eq('id', eligibleId)
      .maybeSingle()

    if (currentError) throw currentError
    if (!current) return jsonResponse({ error: 'Éligible introuvable.' }, 404)
    if (current.statut === 'envoye' || current.statut === 'desabonne') {
      return jsonResponse(
        { error: 'Ce client a déjà été traité et ne peut plus être modifié.' },
        400
      )
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('satisfaction_eligibles')
      .update(updates)
      .eq('id', eligibleId)
      .select(
        'id, client_nom, destinataire_nom, destinataire_email, destinataire_emails, professionnel, nb_rencontres, derniere_rencontre, statut'
      )
      .single()

    if (updateError) throw updateError

    await logAudit({
      actorId: actor.user.id,
      actorName: actor.profile.full_name ?? actor.user.email ?? null,
      actorRole: actor.profile.role,
      action: 'satisfaction_eligible_updated',
      entityId: eligibleId,
      description: `Éligible satisfaction mis à jour (${current.destinataire_nom}).`,
      metadata: { eligible_id: eligibleId, updates },
    })

    return jsonResponse({ success: true, eligible: updated }, 200)
  } catch (error) {
    console.error('[satisfaction-import] Erreur mise à jour:', error)
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue pendant la mise à jour.',
      },
      500
    )
  }
}
