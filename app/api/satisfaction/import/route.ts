import { NextRequest, NextResponse } from 'next/server'
import { getSuperAdminContext } from '@/lib/superAdminServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildEligibleList,
  detectEncounterPeriod,
  generateSatisfactionToken,
  groupEncountersByClient,
  isRecentSatisfactionEncounter,
  shouldShowSatisfactionInvitation,
  resolveUniqueSatisfactionRecipients,
} from '@/lib/satisfaction'
import { analyzeSatisfactionImport, isSatisfactionDate, refreshSatisfactionAnalysisRecency, validateSatisfactionEncounters, type SatisfactionAnalysis } from '@/lib/satisfactionWorkspace'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidDateString(value: string) {
  return isSatisfactionDate(value)
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
 * et les éligibles. Le super administrateur vérifie la liste AVANT tout envoi.
 */
export async function POST(request: NextRequest) {
  const directionResult = await getSuperAdminContext(request)

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

  const encounters = validateSatisfactionEncounters(body.encounters)
  const detectedPeriod = encounters ? detectEncounterPeriod(encounters) : null
  const periodStart = normalizeText(body.periodStart) || detectedPeriod?.start || ''
  const periodEnd = normalizeText(body.periodEnd) || detectedPeriod?.end || ''
  const fileName = normalizeText(body.fileName)

  if (!encounters) {
    return jsonResponse(
      { error: 'Rencontres absentes ou invalides. Vérifiez les noms et les dates du fichier importé.' },
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
    const now = new Date()
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

    const eligibleGroups = buildEligibleList(groups, alreadySolicited, unsubscribed, now)

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
    const analysis = analyzeSatisfactionImport(encounters, periodStart, periodEnd, alreadySolicited, unsubscribed, contactRows, now)

    const { data: importRow, error: importError } = await supabaseAdmin
      .from('satisfaction_imports')
      .insert({
        imported_by: actor.user.id,
        period_start: periodStart,
        period_end: periodEnd,
        row_count: encounters.length,
        file_name: fileName || null,
        analysis,
      })
      .select('id, imported_at, period_start, period_end, row_count, file_name')
      .single()

    if (importError) {
      if (['PGRST204', '42703'].includes(importError.code)) {
        return jsonResponse({ error: 'La mise à jour du module doit être terminée avant un nouvel import.' }, 503)
      }
      throw importError
    }

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
        analysis,
      },
      200
    )
  } catch (error) {
    console.error('[satisfaction-import] Erreur:', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN' })
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
  const directionResult = await getSuperAdminContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const importId = request.nextUrl.searchParams.get('importId')
  const now = new Date()

  try {
    if (importId) {
      const { data: importRow, error: importError } = await supabaseAdmin
        .from('satisfaction_imports').select('*').eq('id', importId).maybeSingle()
      if (importError) throw importError
      if (!importRow) return jsonResponse({ error: 'Import introuvable.' }, 404)
      const { data: eligibles, error } = await supabaseAdmin
        .from('satisfaction_eligibles')
        .select(
          'id, import_id, client_nom, destinataire_nom, destinataire_email, destinataire_emails, professionnel, nb_rencontres, derniere_rencontre, statut, jeton_reponse, jeton_desabonnement, created_at'
        )
        .eq('import_id', importId)
        .order('destinataire_nom', { ascending: true })

      if (error) throw error
      const ids = (eligibles ?? []).map(row => row.id)
      const responses = ids.length ? await supabaseAdmin.from('satisfaction_reponses')
        .select('eligible_id, note, commentaire, repondu_le').in('eligible_id', ids) : { data: [], error: null }
      const sends = ids.length ? await supabaseAdmin.from('satisfaction_envois')
        .select('eligible_id, statut, envoye_le, erreur').in('eligible_id', ids)
        .order('envoye_le', { ascending: false }) : { data: [], error: null }
      if (responses.error) throw responses.error
      if (sends.error) throw sends.error
      return jsonResponse({ import: importRow, analysis: refreshSatisfactionAnalysisRecency((importRow.analysis ?? null) as SatisfactionAnalysis | null, now),
        eligibles: (eligibles ?? []).filter(row => shouldShowSatisfactionInvitation(row, now)).map(row => ({ ...row,
          reponse: responses.data?.find(response => response.eligible_id === row.id) ?? null,
          dernier_envoi: sends.data?.find(send => send.eligible_id === row.id) ?? null,
        })) }, 200)
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
        .select('id, import_id, statut, derniere_rencontre')
        .in('import_id', importIds)

      if (eligibleError) throw eligibleError

      const eligibleIds: string[] = []
      const importByEligibleId = new Map<string, string>()

      for (const row of eligibleRows ?? []) {
        eligibleIds.push(row.id)
        importByEligibleId.set(row.id, row.import_id)
        const stats = statsByImport[row.import_id]
        if (stats) {
          if (isRecentSatisfactionEncounter(row.derniere_rencontre, now) && !['exclu', 'desabonne'].includes(row.statut)) stats.eligible_count += 1
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
    console.error('[satisfaction-import] Erreur lecture:', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN' })
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
  const directionResult = await getSuperAdminContext(request)

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
      .select('id, statut, destinataire_nom, derniere_rencontre')
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
    if (updates.statut === 'en_attente' && !isRecentSatisfactionEncounter(current.derniere_rencontre)) {
      return jsonResponse({ error: 'Ce client ne peut pas être réintégré : il doit avoir une rencontre dans les 30 derniers jours ou à venir.' }, 400)
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
    console.error('[satisfaction-import] Erreur mise à jour:', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN' })
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
