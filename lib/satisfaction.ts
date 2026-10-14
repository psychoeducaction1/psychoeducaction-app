import { classifyPayrollActivity } from './payrollActivity.ts'
import { getTorontoDate, shiftIsoDate } from './adSpend.ts'

/**
 * Logique métier de la fonction « Satisfaction des clients ».
 *
 * Fonctions pures, utilisables côté client (parsing de l'export Excel)
 * comme côté serveur (regroupement, éligibilité). Aucun import 'server-only'
 * ici : les accès Supabase se font dans les routes API.
 */

/** Nombre minimal de rencontres sur la période pour être éligible au sondage. */
export const SATISFACTION_MIN_ENCOUNTERS = 4
export const SATISFACTION_RECENCY_DAYS = 30
export const SATISFACTION_RECENCY_REASONS = [
  'Aucune rencontre dans les 30 derniers jours',
  // Ancien motif conservé pour actualiser les analyses enregistrées avant la correction.
  'Dernière rencontre dans le futur',
  'Dernière rencontre absente ou invalide',
] as const

export function getSatisfactionRecencyWindow(now = new Date()) {
  const to = getTorontoDate(now)
  return { from: shiftIsoDate(to, -(SATISFACTION_RECENCY_DAYS - 1)), to }
}

export function satisfactionRecencyReason(lastEncounter: string | null | undefined, now = new Date()): string | null {
  if (!lastEncounter || parseSatisfactionDate(lastEncounter) !== lastEncounter) return SATISFACTION_RECENCY_REASONS[2]
  const { from } = getSatisfactionRecencyWindow(now)
  return lastEncounter < from ? SATISFACTION_RECENCY_REASONS[0] : null
}

export function isRecentSatisfactionEncounter(lastEncounter: string | null | undefined, now = new Date()) {
  return satisfactionRecencyReason(lastEncounter, now) === null
}

// Les dossiers déjà traités restent consultables, même après expiration du délai.
export function shouldShowSatisfactionInvitation(row: { statut: string; derniere_rencontre?: string | null }, now = new Date()) {
  return !['en_attente', 'exclu'].includes(row.statut) || isRecentSatisfactionEncounter(row.derniere_rencontre, now)
}

export type SatisfactionEncounter = {
  clientNom: string
  clientNomNormalise: string
  requerantNom: string | null
  professionnel: string | null
  date: string // AAAA-MM-JJ
}

export type SatisfactionClientGroup = {
  clientNom: string
  clientNomNormalise: string
  requerantNom: string | null
  destinataireNom: string
  professionnel: string | null // professionnel le plus fréquent
  nbRencontres: number
  derniereRencontre: string // AAAA-MM-JJ
}

/**
 * Extrait la date (AAAA-MM-JJ) d'une cellule DATE de l'export Psylog,
 * dont le format est « AAAA-MM-JJ\nJour\nHH:MM - HH:MM ».
 * Retourne null si aucune date valide n'est trouvée.
 */
export function parseSatisfactionDate(raw: unknown): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw < 100000) {
    const origin = raw < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
    return new Date(origin + Math.floor(raw) * 86400000).toISOString().slice(0, 10)
  }
  if (typeof raw !== 'string') return null

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const dateLine = lines.find((line) => /^\d{4}-\d{2}-\d{2}/.test(line))

  if (!dateLine) return null

  const date = dateLine.slice(0, 10)
  const parsed = new Date(`${date}T00:00:00Z`)

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null

  return date
}

/**
 * Normalise un nom pour la déduplication : minuscules, accents retirés,
 * espaces et ponctuation normalisés. Même approche que normalizeActivityText
 * utilisée pour la paie.
 */
export function normalizeClientName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Une « rencontre » au sens du sondage de satisfaction : même classification
 * que la paie (couvre « Rencontre » et « Rencontre clinique »).
 */
export function isSatisfactionEncounter(
  description: string | null | undefined,
  detail: string | null | undefined
): boolean {
  return classifyPayrollActivity(description ?? '', detail ?? '') === 'rencontre'
}

/**
 * Détermine le destinataire du sondage : le requérant quand il est renseigné
 * et différent du client (souvent un parent), sinon le client lui-même.
 */
export function resolveDestinataire(
  clientNom: string,
  requerantNom: string | null | undefined
): string {
  const requerant = (requerantNom ?? '').trim()

  if (
    requerant &&
    normalizeClientName(requerant) !== normalizeClientName(clientNom)
  ) {
    return requerant
  }

  return clientNom.trim()
}

/**
 * Extrait les rencontres éligibles des lignes brutes du fichier Excel
 * « Activités détaillées » (lues via xlsx avec `header: 1`, donc chaque
 * ligne est un tableau de cellules dans l'ordre : DATE, PROFESSIONNEL,
 * CLIENT, REQUÉRANT, DESCRIPTION, DÉTAIL, EMPLACEMENT, PAYÉ,
 * MONTANT RÉCLAMÉ, MANDAT).
 */
export function extractSatisfactionRows(rawRows: unknown[][]): SatisfactionEncounter[] {
  const headerRowIndex = rawRows.findIndex(
    (row) => typeof row[0] === 'string' && row[0].trim().toUpperCase() === 'DATE'
  )

  if (headerRowIndex === -1) return []

  const encounters: SatisfactionEncounter[] = []

  for (let index = headerRowIndex + 1; index < rawRows.length; index += 1) {
    const row = rawRows[index]
    const date = parseSatisfactionDate(row[0])
    const client = typeof row[2] === 'string' ? row[2].trim() : ''
    const description = typeof row[4] === 'string' ? row[4] : ''
    const detail = typeof row[5] === 'string' ? row[5] : ''

    if (!date || !client) continue
    if (!isSatisfactionEncounter(description, detail)) continue

    const requerant =
      typeof row[3] === 'string' && row[3].trim() ? row[3].trim() : null

    encounters.push({
      clientNom: client,
      clientNomNormalise: normalizeClientName(client),
      requerantNom: requerant,
      professionnel:
        typeof row[1] === 'string' && row[1].trim() ? row[1].trim() : null,
      date,
    })
  }

  return encounters
}

/**
 * Regroupe les rencontres par client (nom normalisé) sur la période donnée.
 * Le professionnel retenu est le plus fréquent ; le destinataire est le
 * requérant quand il diffère du client.
 */
export function groupEncountersByClient(
  encounters: SatisfactionEncounter[],
  periodStart: string,
  periodEnd: string
): SatisfactionClientGroup[] {
  const groups = new Map<
    string,
    SatisfactionClientGroup & { professionalCounts: Map<string, number> }
  >()

  for (const encounter of encounters) {
    if (encounter.date < periodStart || encounter.date > periodEnd) continue
    if (!encounter.clientNomNormalise) continue

    let group = groups.get(encounter.clientNomNormalise)

    if (!group) {
      group = {
        clientNom: encounter.clientNom,
        clientNomNormalise: encounter.clientNomNormalise,
        requerantNom: encounter.requerantNom,
        destinataireNom: resolveDestinataire(
          encounter.clientNom,
          encounter.requerantNom
        ),
        professionnel: null,
        nbRencontres: 0,
        derniereRencontre: encounter.date,
        professionalCounts: new Map<string, number>(),
      }
      groups.set(encounter.clientNomNormalise, group)
    }

    group.nbRencontres += 1

    if (encounter.date > group.derniereRencontre) {
      group.derniereRencontre = encounter.date
    }

    if (!group.requerantNom && encounter.requerantNom) {
      group.requerantNom = encounter.requerantNom
      group.destinataireNom = resolveDestinataire(
        group.clientNom,
        encounter.requerantNom
      )
    }

    if (encounter.professionnel) {
      group.professionalCounts.set(
        encounter.professionnel,
        (group.professionalCounts.get(encounter.professionnel) ?? 0) + 1
      )
    }
  }

  return [...groups.values()].map(({ professionalCounts, ...rest }) => {
    let topProfessional: string | null = null
    let topCount = 0

    for (const [professional, count] of professionalCounts) {
      if (count > topCount) {
        topCount = count
        topProfessional = professional
      }
    }

    return { ...rest, professionnel: topProfessional }
  })
}

/**
 * Détecte la période couverte par les rencontres (min/max des dates).
 */
export function detectEncounterPeriod(
  encounters: SatisfactionEncounter[]
): { start: string; end: string } | null {
  let start: string | null = null
  let end: string | null = null

  for (const encounter of encounters) {
    if (!start || encounter.date < start) start = encounter.date
    if (!end || encounter.date > end) end = encounter.date
  }

  if (!start || !end) return null

  return { start, end }
}

/**
 * Construit la liste des clients éligibles : seuil minimal de rencontres,
 * déduplication déjà faite par le regroupement, exclusion des clients déjà
 * sollicités et des désabonnés (noms normalisés fournis par l'appelant).
 */
export function buildEligibleList(
  groups: SatisfactionClientGroup[],
  alreadySolicitedNormalizedNames: Set<string>,
  unsubscribedNormalizedNames: Set<string>,
  now = new Date()
): SatisfactionClientGroup[] {
  return groups.filter(
    (group) =>
      group.nbRencontres >= SATISFACTION_MIN_ENCOUNTERS &&
      isRecentSatisfactionEncounter(group.derniereRencontre, now) &&
      !alreadySolicitedNormalizedNames.has(group.clientNomNormalise) &&
      !unsubscribedNormalizedNames.has(group.clientNomNormalise)
  )
}

/** Génère un jeton unique et imprévisible pour les liens de réponse. */
export function generateSatisfactionToken(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export type SatisfactionEmailContent = {
  subject: string
  text: string
  html: string
}

export type SatisfactionContactRecord = {
  clientName: string | null
  requesterNames: Array<string | null | undefined>
  emails: Array<string | null | undefined>
}

export type SatisfactionRecipientMatch = {
  names: string[]
  emails: string[]
}

/**
 * Retourne les coordonnées uniquement lorsqu'une seule fiche correspond au
 * client. Une homonymie doit être vérifiée manuellement avant tout envoi.
 */
export function resolveUniqueSatisfactionRecipients(
  normalizedClientName: string,
  records: SatisfactionContactRecord[]
): SatisfactionRecipientMatch | null {
  const matches = records.filter(
    (record) => normalizeClientName(record.clientName) === normalizedClientName
  )

  if (matches.length !== 1) return null

  const record = matches[0]
  const emails = [...new Set(
    record.emails
      .map((email) => (email ?? '').trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )]
  const names = [...new Set(
    record.requesterNames
      .map((name) => (name ?? '').trim())
      .filter(Boolean)
  )]

  if (emails.length === 0) return null

  return { names, emails }
}

/**
 * Construit le courriel d'invitation au sondage (texte + HTML).
 * Utilisé à l'identique pour l'aperçu côté direction et pour l'envoi.
 */
export const SATISFACTION_GOOGLE_REVIEW_URL = 'https://g.page/r/CVVLMQwVgjl_EAE/review'

export function buildSatisfactionTestLinks(appUrl = 'https://app.psychoeducaction.com') {
  const origin = new URL(appUrl).origin
  if (!/^https?:\/\//.test(origin)) throw new Error('Adresse de test invalide.')
  return {
    response: `${origin}/satisfaction/test`,
    google: SATISFACTION_GOOGLE_REVIEW_URL,
    unsubscribe: `${origin}/satisfaction/test?view=unsubscribe`,
  }
}

export function buildSatisfactionEmail({
  destinatairePrenom,
  lienReponse,
  lienDesabonnement,
  test = false,
  testAppUrl,
}: {
  destinatairePrenom: string
  lienReponse: string
  lienDesabonnement: string
  professionnel?: string | null
  test?: boolean
  testAppUrl?: string
}): SatisfactionEmailContent {
  const subject = `${test ? '[TEST] ' : ''}Votre avis compte pour nous — Clinique PsychoÉducAction`
  const testLinks = test ? buildSatisfactionTestLinks(testAppUrl) : null
  const responseLink = testLinks?.response ?? lienReponse
  const googleLink = testLinks?.google ?? SATISFACTION_GOOGLE_REVIEW_URL
  const unsubscribeLink = testLinks?.unsubscribe ?? lienDesabonnement
  const logoUrl = new URL('/psychoeducaction-email-logo.png', testAppUrl ?? 'https://app.psychoeducaction.com').href

  const text = [
    ...(test ? ['COURRIEL TEST — le premier bouton ouvre la vraie fiche Google. Le sondage privé et le désabonnement sont en démonstration, sans enregistrement réel.', ''] : []),
    `Bonjour ${destinatairePrenom},`,
    '',
    'Vous ou votre proche avez reçu des services à la Clinique PsychoÉducAction. Vous pouvez partager votre expérience de deux façons :',
    '',
    'LAISSER UN AVIS SUR GOOGLE',
    'Partagez une note et, si vous le souhaitez, un commentaire public sur Google.',
    googleLink,
    '',
    'RÉPONDRE AU SONDAGE PRIVÉ',
    'Indiquez votre niveau de satisfaction et partagez vos commentaires ou suggestions avec notre équipe. Ces réponses ne sont pas publiées sur Google.',
    responseLink,
    '',
    "Merci de contribuer à l'amélioration de nos services.",
    '',
    'Si vous ne souhaitez plus recevoir ces invitations, vous pouvez vous désabonner ici :',
    unsubscribeLink,
    '',
    "— L'équipe de la Clinique PsychoÉducAction",
    'www.psychoeducaction.com',
  ].join('\n')

  const html = [
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#fbf7f1;font-family:Arial,sans-serif;color:#332820;line-height:1.6;">',
    '<div style="max-width:580px;margin:auto;background:#fffdf9;border:1px solid #eadfd2;border-radius:20px;padding:28px;">',
    `<img src="${escapeHtml(logoUrl)}" alt="Clinique PsychoÉducAction" width="220" height="220" style="display:block;width:220px;max-width:100%;height:auto;margin:0 auto;" />`,
    ...(test ? ['<p style="padding:12px;background:#fff0d9;border-radius:8px;font-weight:bold;">TEST — le premier bouton ouvre la vraie fiche Google. Le sondage privé et le désabonnement sont en démonstration, sans enregistrement réel.</p>'] : []),
    '<h1 style="font-size:24px;line-height:1.3;">Votre avis compte pour nous</h1>',
    `<p>Bonjour ${escapeHtml(destinatairePrenom)},</p>`,
    '<p>Vous ou votre proche avez reçu des services à la Clinique PsychoÉducAction. Vous pouvez partager votre expérience de deux façons :</p>',
    '<h2 style="font-size:18px;margin-top:24px;">Un avis public sur Google</h2>',
    '<p>Partagez une note et, si vous le souhaitez, un commentaire public sur Google.</p>',
    `<p><a href="${escapeHtml(googleLink)}" style="display:inline-block;padding:12px 24px;background-color:#9b6a3d;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;">Laisser un avis sur Google</a></p>`,
    '<h2 style="font-size:18px;margin-top:24px;">Un sondage privé pour la clinique</h2>',
    '<p>Indiquez votre niveau de satisfaction et partagez vos commentaires ou suggestions avec notre équipe. Ces réponses ne sont pas publiées sur Google.</p>',
    `<p><a href="${escapeHtml(responseLink)}" style="display:inline-block;padding:12px 24px;background-color:#9b6a3d;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;">Répondre au sondage privé</a></p>`,
    `<p>Merci de contribuer à l'amélioration de nos services.</p>`,
    `<p style="font-size:12px;color:#8a6f5d;">Si vous ne souhaitez plus recevoir ces invitations, vous pouvez <a href="${escapeHtml(unsubscribeLink)}">vous désabonner ici</a>.</p>`,
    `<p>— L'équipe de la Clinique PsychoÉducAction<br/>www.psychoeducaction.com</p>`,
    '</div></body></html>',
  ].join('\n')

  return { subject, text, html }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function getFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'à vous'
}
