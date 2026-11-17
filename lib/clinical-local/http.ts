import { ClinicalError } from '@/lib/clinical-core/validation'
import { readDurableClinicalRuntime, isStagingClinicalRuntime, stagingAllowedEmails, type DurableClinicalRuntime } from '@/lib/clinical-local/runtime'
import type { ClinicalAccessContext, FixtureActor } from '@/lib/clinical-core/types'

// Exact SQL210 identifiers only. Never expose arbitrary database messages or details.
const admissionFailures: Record<string, { sqlState: string; status: number; message: string }> = {
  ADMISSION_DUPLICATE_REQUEST: { sqlState: '40001', status: 409, message: 'Une demande avec les mêmes renseignements existe déjà. Vérifiez la demande existante avant de poursuivre.' },
  ADMISSION_DETAILS_REQUIRED: { sqlState: '40001', status: 409, message: 'Complétez le motif et vérifiez que cette demande est ouverte avant de l’assigner.' },
  ADMISSION_NO_CAPACITY: { sqlState: '40001', status: 409, message: "Ce professionnel n’a plus de place disponible dans une demande active. Choisissez un autre professionnel ou actualisez les demandes." },
  MANDATE_PROFESSIONAL_TITLE_REQUIRED: { sqlState: '22023', status: 409, message: 'Renseignez le titre du professionnel dans sa fiche avant de l’assigner. Aucun dossier ni mandat n’a été créé.' },
  PROFESSIONAL_SERVICE_NOT_AUTHORIZED: { sqlState: '42501', status: 409, message: 'Autorisez le service demandé dans la fiche du professionnel, sous « Paramètres des services individuels », avant de l’assigner. Aucun dossier ni mandat n’a été créé.' },
  ADMISSION_CAPACITY_BELOW_OCCUPIED: { sqlState: '40001', status: 409, message: "La quantité demandée ne peut pas être inférieure aux places déjà réservées." },
  ADMISSION_CAPACITY_COMPLETED: { sqlState: '40001', status: 409, message: "Cette demande est déjà complétée. Créez une nouvelle demande pour ajouter des places." },
  ADMISSION_ALREADY_ASSIGNED: { sqlState: '40001', status: 409, message: "Cette demande client a déjà une assignation active." },
  ADMISSION_ACTIVE_WORK_EXISTS: { sqlState: '40001', status: 409, message: "Une assignation ou une démarche est encore active. Traitez-la avant de modifier le classement." },
  ADMISSION_NOT_WAITING: { sqlState: '40001', status: 409, message: "Cette demande n’est plus disponible dans la liste d’attente. Actualisez son état." },
  ADMISSION_NEWER_ASSIGNMENT_EXISTS: { sqlState: '40001', status: 409, message: "Une assignation plus récente existe. Actualisez avant de poursuivre." },
  ADMISSION_PROCESS_CONFLICT: { sqlState: '40001', status: 409, message: "La démarche ou le professionnel envisagé a changé. Actualisez avant de poursuivre." },
  ADMISSION_PROCESS_TERMINAL: { sqlState: '40001', status: 409, message: "Cette démarche est terminée. Utilisez l’action de reprise pour la rouvrir." },
  ADMISSION_PROCESS_NOT_TERMINAL: { sqlState: '40001', status: 409, message: "Cette démarche est encore active et ne peut pas être reprise depuis l’historique." },
  ADMISSION_ASSIGNMENT_CANCELLED: { sqlState: '40001', status: 409, message: "Cette assignation est annulée. Une nouvelle assignation est nécessaire." },
  ADMISSION_SLOT_UNAVAILABLE: { sqlState: '40001', status: 409, message: "Ce créneau n’est plus disponible. Choisissez une autre heure." },
  ADMISSION_INVALID_SLOT: { sqlState: '22023', status: 400, message: "Choisissez un créneau dans les heures d’ouverture, avec au moins deux heures de préavis." },
  ADMISSION_INVALID_OFFER_SLOTS: { sqlState: '22023', status: 400, message: 'Sélectionnez entre une et 60 plages pour cette demande.' },
  ADMISSION_INVALID_OFFER_SLOT: { sqlState: '22023', status: 400, message: 'Une plage proposée est invalide. Vérifiez les heures choisies.' },
  ADMISSION_INVALID_OFFER_DATE: { sqlState: '22023', status: 400, message: 'Les plages proposées doivent être datées dans les 180 prochains jours.' },
  ADMISSION_INVALID_OFFER_DURATION: { sqlState: '22023', status: 400, message: 'Chaque plage proposée doit durer une à quatre heures entières.' },
  ADMISSION_OVERLAPPING_OFFER_SLOTS: { sqlState: '22023', status: 400, message: 'Deux plages proposées se chevauchent. Corrigez la sélection.' },
  ADMISSION_OFFER_EXCEEDS_HOURS: { sqlState: '22023', status: 400, message: 'Le nombre de nouveaux clients ne peut pas dépasser le nombre d’heures offertes.' },
  ADMISSION_INVALID_OFFER_PREFERENCE: { sqlState: '22023', status: 400, message: 'Choisissez une préférence valide et précisez le commentaire pour « Autre ».' },
  ADMISSION_DUPLICATE_DIFFERENT_PATIENT: { sqlState: '40001', status: 409, message: "Une demande identique est déjà rattachée à une autre identité. Vérifiez les dossiers avant de poursuivre." },
  ADMISSION_IDENTITY_MISMATCH: { sqlState: '40001', status: 409, message: "Les renseignements ne correspondent pas à l’identité sélectionnée. Vérifiez le client à rattacher." },
  ADMISSION_REFUSAL_REASON_REQUIRED: { sqlState: '22023', status: 400, message: "Précisez le motif du service non pris. Si vous choisissez Autre, ajoutez une explication." },
  ADMISSION_IDEMPOTENCY_CONFLICT: { sqlState: '40001', status: 409, message: "Cette clé de reprise correspond à une autre opération. Actualisez avant de poursuivre." },
  ADMISSION_VOLUME_REQUIRES_PAGINATION: { sqlState: '54000', status: 503, message: "Le volume des admissions dépasse la projection autorisée. Aucun résultat partiel n’est affiché." },
}

const calendarFailures: Record<string, {sqlState:string;status:number;message:string}> = {
  CALENDAR_VOLUME_EXCEEDED: {sqlState:'54000',status:503,message:'Le volume du calendrier est trop important. Réduisez la période ; aucun résultat partiel n’est affiché.'},
  CALENDAR_INVALID_KILOMETERS: {sqlState:'22023',status:400,message:'Indiquez un déplacement entre zéro et2000 kilomètres, avec deux décimales au maximum.'},
  CALENDAR_OUTSIDE_AVAILABILITY: {sqlState:'23P01',status:409,message:"La rencontre et ses déplacements doivent être compris dans une disponibilité du professionnel."},
  CALENDAR_PATIENT_CONFLICT: {sqlState:'23P01',status:409,message:"Ce client a déjà une rencontre sur cette plage."},
  CALENDAR_OFFICE_NOT_GRANTED: {sqlState:'42501',status:403,message:"Ce bureau n’est pas attribué au professionnel pour cette date."},
  CALENDAR_PROFESSIONAL_UNAVAILABLE: {sqlState:'42501',status:403,message:"Le professionnel n’est pas disponible pour cette opération."},
  CALENDAR_EPISODE_FORBIDDEN: {sqlState:'42501',status:403,message:"Cet épisode n’est pas autorisé pour ce professionnel."},
  CALENDAR_VERSION_CONFLICT: {sqlState:'40001',status:409,message:"Cette activité a changé. Actualisez avant de poursuivre ; votre saisie est conservée."},
  CALENDAR_SERIES_CONFLICT: {sqlState:'40001',status:409,message:"La série a changé. Actualisez sa prévisualisation avant de confirmer."},
  CALENDAR_OFFICE_IN_USE: {sqlState:'40001',status:409,message:"Des activités planifiées utilisent encore ce bureau. Modifiez-les avant de le désactiver."},
  CALENDAR_AVAILABILITY_INVALIDATES_EVENT: {sqlState:'40001',status:409,message:"Ces disponibilités ne couvrent plus une activité planifiée. Conservez une plage qui couvre les activités et leurs déplacements."},
  CALENDAR_GRANTS_INVALIDATE_EVENT: {sqlState:'40001',status:409,message:"Cette modification de bureaux invaliderait une activité planifiée. Modifiez d’abord les activités concernées."},
  CALENDAR_ACTIVITY_UNAVAILABLE: {sqlState:'40001',status:409,message:"Cette activité ne peut pas être corrigée dans son état actuel."},
  CALENDAR_IDEMPOTENCY_CONFLICT: {sqlState:'40001',status:409,message:"Cette clé de reprise correspond à une autre opération. Actualisez avant de poursuivre."},
  CALENDAR_INVALID_RANGE: {sqlState:'22023',status:400,message:"Choisissez une période valide de un à 93 jours."},
  CALENDAR_INVALID_TRANSITION: {sqlState:'22023',status:400,message:"Cette transition ne correspond pas à l’état actuel de l’activité."},
  CALENDAR_TIMELY_CANCELLATION_FREE: {sqlState:'22023',status:400,message:'Une annulation au moins24 heures avant le rendez-vous ne peut pas entraîner de frais.'},
  CALENDAR_FINANCIAL_UNAVAILABLE: {sqlState:'40001',status:409,message:'Les conditions financières de cette activité ne sont pas encore disponibles. Aucun frais n’a été enregistré.'},
  CALENDAR_FINANCIAL_FORBIDDEN: {sqlState:'42501',status:403,message:'Les tarifs et la répartition relèvent de l’espace Administration.'},
  CALENDAR_PROFESSIONAL_CHANGE_BLOCKED: {sqlState:'40001',status:409,message:'Le professionnel ne peut plus être changé sur cette activité. Les notes, activités et factures déjà liées sont conservées.'},
  CALENDAR_INVALID_ABSENCE_FEE: {sqlState:'22023',status:400,message:'Ces frais ne sont pas applicables à cette absence ou annulation.'},
  CALENDAR_INVALID_ABSENCE_TRAVEL: {sqlState:'22023',status:400,message:'Un déplacement effectué ne peut être déclaré que pour une rencontre à domicile.'},
  CALENDAR_ABSENCE_OCCURRENCE_REQUIRED: {sqlState:'22023',status:400,message:'Déclarez l’absence pour une seule rencontre, sans récurrence ni modification des occurrences suivantes.'},
  CALENDAR_INVALID_RECURRENCE: {sqlState:'22023',status:400,message:"La récurrence demandée est invalide."},
  CALENDAR_FORBIDDEN: {sqlState:'42501',status:403,message:"Le journal d’audit est réservé à la direction et à l’administration."},
  CLINICAL_OUTSIDE_AVAILABILITY: {sqlState:'23P01',status:409,message:'La rencontre et ses déplacements doivent être compris dans une disponibilité du professionnel.'},
  CLINICAL_APPOINTMENT_CONFLICT: {sqlState:'23P01',status:409,message:'Le professionnel, le client ou le bureau est déjà occupé sur cette plage.'},
  CLINICAL_AMBIGUOUS_TIME: {sqlState:'22023',status:400,message:'Cette heure se produit deux fois. Précisez la première ou la deuxième occurrence.'},
  CLINICAL_NONEXISTENT_TIME: {sqlState:'22023',status:400,message:'Cette heure n’existe pas lors du changement d’heure. Choisissez une autre heure.'},
}

const activityFinanceFailures: Record<string,{sqlState:string;status:number;message:string}> = {
  ACTIVITY_FINANCE_FORBIDDEN:{sqlState:'42501',status:403,message:"Cette action financière n’est pas autorisée pour ce compte et cet espace."},
  ACTIVITY_FINANCE_CONDITIONS_INVALID:{sqlState:'22023',status:400,message:"Vérifiez la revue des conditions et la preuve signée applicable à cette activité."},
  ACTIVITY_FINANCE_INVALID_INPUT:{sqlState:'22023',status:400,message:"Vérifiez les informations financières de cette activité."},
  ACTIVITY_FINANCE_SIGNED_MANDATE_REQUIRED:{sqlState:'40001',status:409,message:"Le tarif et les payeurs doivent être renseignés dans le mandat attribué avant de définir une exception financière."},
  ACTIVITY_FINANCE_REASON_REQUIRED:{sqlState:'22023',status:400,message:"Précisez la justification du tarif ou de la répartition exceptionnelle."},
  ACTIVITY_FINANCE_PAYER_TOTAL:{sqlState:'22023',status:400,message:"La répartition doit reprendre les payeurs du mandat et totaliser100 %."},
  ACTIVITY_FINANCE_PAYER_INVALID:{sqlState:'22023',status:400,message:"Sélectionnez uniquement les payeurs du mandat applicable."},
  ACTIVITY_FINANCE_ISSUED_REQUIRES_CORRECTION:{sqlState:'40001',status:409,message:"Une facture est déjà émise. Utilisez une correction traçable ; les documents existants sont conservés."},
  ACTIVITY_FINANCE_INVALID_ABSENCE:{sqlState:'22023',status:400,message:"Les informations d’absence ne correspondent pas à ce rendez-vous."},
  ACTIVITY_FINANCE_ZERO_REQUIRED:{sqlState:'22023',status:400,message:"Cette activité ou cette annulation ne peut pas entraîner de frais. Sélectionnez0 %."},
  ACTIVITY_FINANCE_ACCEPTED_CONDITIONS_REQUIRED:{sqlState:'40001',status:409,message:"Les conditions signées n’autorisent pas ces frais. Choisissez0 % ou faites vérifier les conditions par l’administration."},
  ACTIVITY_FINANCE_HOME_CONDITIONS_REQUIRED:{sqlState:'40001',status:409,message:"Les conditions validées ne permettent pas de facturer ce déplacement effectué à domicile."},
  ACTIVITY_FINANCE_MANDATE_CHANGED:{sqlState:'40001',status:409,message:"Le mandat applicable a changé. Faites vérifier l’exception avant une nouvelle préparation financière."},
  ACTIVITY_FINANCE_NOT_BILLABLE:{sqlState:'40001',status:409,message:"Cette activité est non facturable ; aucun brouillon ne peut être préparé."},
}

const mandateFailures:Record<string,{sqlState:string;status:number;message:string}>={
 MANDATE_VERSION_CONFLICT:{sqlState:'40001',status:409,message:'Cette version du mandat a changé. Actualisez avant de poursuivre ; votre saisie est conservée.'},
 MANDATE_IDEMPOTENCY_CONFLICT:{sqlState:'40001',status:409,message:'Cette clé de reprise correspond à une autre opération.'},
 MANDATE_ALREADY_SIGNED:{sqlState:'40001',status:409,message:'Ce signataire a déjà signé cette version.'},
 MANDATE_NOT_PREPARED:{sqlState:'40001',status:409,message:'Préparez et vérifiez les documents avant cette opération.'},
 MANDATE_SIGNATURES_REQUIRED:{sqlState:'40001',status:409,message:'Les signatures requises ne sont pas toutes enregistrées.'},
 MANDATE_RATE_DATE_CONFLICT:{sqlState:'40001',status:409,message:'Choisissez une date postérieure au dernier tarif de ce service.'},
 MANDATE_FORBIDDEN:{sqlState:'42501',status:403,message:'Ce mandat ou cette action n’est pas autorisé pour ce compte et cet espace.'},
 MANDATE_PROFESSIONAL_ACCESS_REQUIRED:{sqlState:'42501',status:403,message:'Le professionnel doit être autorisé pour cet épisode avant de préparer le mandat.'},
 MANDATE_IMMUTABLE:{sqlState:'42501',status:409,message:'Cette version est figée. Créez un avenant pour la corriger.'},
 MANDATE_NOT_FOUND:{sqlState:'P0002',status:404,message:'Ce mandat n’est pas disponible.'},
 MANDATE_LEGAL_REVIEW_REQUIRED:{sqlState:'22023',status:400,message:'Confirmez la révision humaine de cet exemple fictif et précisez son contexte.'},
 MANDATE_MINOR_REVIEW_REQUIRED:{sqlState:'22023',status:400,message:'Vérifiez les représentants et documentez la décision humaine pour ce mineur fictif.'},
 MANDATE_AUTHORITY_REVIEW_REQUIRED:{sqlState:'22023',status:400,message:'Vérifiez et documentez l’autorité du représentant.'},
 MANDATE_PAYER_TOTAL:{sqlState:'22023',status:400,message:'La répartition entre les payeurs doit totaliser 100 %.'},
 MANDATE_MINOR_CLIENT_SIGNER:{sqlState:'22023',status:400,message:'Un client de moins de 14 ans ne peut pas signer le consentement clinique de cet exemple.'},
 MANDATE_MINOR_PARENT_REQUIRED:{sqlState:'22023',status:400,message:'Ajoutez les parents ou représentants requis comme signataires du consentement clinique.'},
 MANDATE_OVERRIDE_REASON_REQUIRED:{sqlState:'22023',status:400,message:'Précisez la raison du tarif exceptionnel.'},
 MANDATE_HISTORICAL_RATE_REQUIRES_OVERRIDE:{sqlState:'22023',status:400,message:'Le tarif sélectionné est ancien. Sélectionnez le tarif applicable ou documentez une exception.'},
 MANDATE_FICTIONAL_EMAIL_REQUIRED:{sqlState:'22023',status:400,message:'Utilisez uniquement une adresse fictive se terminant par .invalid.'},
 MANDATE_SIGNER_MISMATCH:{sqlState:'22023',status:400,message:'La signature ne correspond pas au signataire et au document préparés.'},
 MANDATE_SIGNER_RIGHTS_REQUIRED:{sqlState:'22023',status:400,message:'Vérifiez les droits explicites du signataire avant de poursuivre.'},
 MANDATE_REQUIRED_SIGNER_MISSING:{sqlState:'22023',status:400,message:'Ajoutez au moins un signataire requis.'},
 MANDATE_PARTIES_REQUIRED:{sqlState:'22023',status:400,message:'Renseignez les payeurs et les signataires avant de préparer le mandat.'},
 MANDATE_INVALID_INPUT:{sqlState:'22023',status:400,message:'Les renseignements du mandat sont invalides.'},
 MANDATE_INVALID_REFERENCE:{sqlState:'22023',status:400,message:'Un service, modèle, tarif ou intervenant sélectionné n’est plus disponible.'},
 MANDATE_INVALID_PAYER:{sqlState:'22023',status:400,message:'Vérifiez les personnes désignées comme payeurs.'},
 MANDATE_INVALID_SIGNER:{sqlState:'22023',status:400,message:'Vérifiez les personnes et les documents désignés pour signer.'},
 MANDATE_DUPLICATE_PARTY:{sqlState:'22023',status:400,message:'Une personne ou un signataire figure plusieurs fois dans ce mandat.'},
 MANDATE_PDF_UNSUPPORTED_CHARACTER:{sqlState:'22023',status:400,message:'Un caractère n’est pas pris en charge par le PDF. Utilisez les caractères français et occidentaux usuels.'},
 MANDATE_PDF_TOO_LARGE:{sqlState:'22023',status:400,message:'Le document dépasse la taille permise.'},
}

const COOKIE = isStagingClinicalRuntime() ? '__Host-pea_stage_session' : 'pea_lab_session'
const APP_ORIGIN = isStagingClinicalRuntime() ? process.env.NEXT_PUBLIC_APP_URL! : process.env.PEA_LAB_PORT === '3101' ? 'http://127.0.0.1:3101' : 'http://127.0.0.1:3100'
export const localResponseHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, X-Clinical-Context', 'X-Content-Type-Options': 'nosniff' }
export function localJson(body: unknown, status = 200, headers: Record<string,string> = {}) { return Response.json(body, { status, headers: { ...localResponseHeaders, ...headers } }) }
export function checkLocalOrigin(request: Request) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== APP_ORIGIN) throw new ClinicalError(403, 'ORIGIN_REFUSED', 'Cette origine n’est pas autorisée dans le laboratoire.')
}
export function contextOf(request: Request): ClinicalAccessContext {
  const value = request.headers.get('X-Clinical-Context')
  if (value !== 'administration' && value !== 'clinical') throw new ClinicalError(400, 'CONTEXT_REQUIRED', 'Choisissez l’espace Administration ou Clinique.')
  return value
}
export function sessionToken(request: Request) {
  const authorization = request.headers.get('Authorization')
  if (authorization) return /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)?.[1] ?? ''
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))
  return cookie?.slice(COOKIE.length + 1) ?? ''
}
export function sessionCookie(token = '', maxAge = 0) {
  if (!/^[A-Za-z0-9._~-]*$/.test(token)) throw new Error('LOCAL_SESSION_INVALID')
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.min(maxAge, 3600))}${isStagingClinicalRuntime() ? '; Secure' : ''}`
}
export async function localRpc<T>(runtime: DurableClinicalRuntime, token: string, name: 'lab_billing_opening_policy' | 'lab_note_template_query' | 'lab_note_template_command' | 'lab_note_signature_query' | 'lab_ai_encounter_consent' | 'lab_legacy_waiting_dashboard' | 'lab_note_pdf' | 'lab_note_delete' | 'lab_office_directory_query' | 'lab_office_directory_command' | 'lab_professional_query' | 'lab_professional_command' | 'lab_professional_create' | 'lab_professional_signed_pdf_query' | 'lab_professional_services_query' | 'lab_professional_services_command' | 'lab_client_overview' | 'lab_client_document' | 'lab_client_command' | 'lab_client_create' | 'lab_mandate_delivery_query' | 'lab_mandate_delivery_command' | 'lab_mandate_preview_pdf' | 'lab_identity' | 'lab_query' | 'lab_command' | 'lab_environment' | 'lab_admission_query' | 'lab_admission_command' | 'lab_calendar_query' | 'lab_calendar_journal' | 'lab_calendar_command' | 'lab_calendar_financial_query' | 'lab_mandate_query' | 'lab_mandate_command' | 'lab_consent_portal' | 'lab_billing_query' | 'lab_billing_command' | 'lab_billing_receipt_send_demo' | 'lab_billing_batch_service' | 'lab_billing_reminder_policy' | 'lab_billing_stripe_test_reserve' | 'lab_billing_stripe_test_attach' | 'lab_billing_stripe_test_settle' | 'lab_billing_stripe_card_query' | 'lab_billing_stripe_card_customer' | 'lab_billing_stripe_card_save' | 'lab_billing_stripe_saved_prepare' | 'lab_billing_stripe_saved_settle' | 'lab_billing_stripe_saved_fail' | 'lab_billing_stripe_checkout_verify' | 'lab_calendar_complete_elapsed_service' | 'lab_fee_query' | 'lab_fee_quote' | 'lab_fee_server_command', args: Record<string,unknown> = {}): Promise<T> {
  const serverOnly=name==='lab_fee_server_command'||name==='lab_billing_batch_service'||name==='lab_calendar_complete_elapsed_service'||name==='lab_billing_stripe_test_settle'||name==='lab_billing_stripe_card_save'||name==='lab_billing_stripe_saved_settle'||name==='lab_billing_stripe_saved_fail'
  if(serverOnly&&token!==runtime.serviceRoleKey)throw new ClinicalError(403,'FORBIDDEN','Cette opération est réservée au serveur local.')
  if(!serverOnly&&token===runtime.serviceRoleKey)throw new ClinicalError(403,'FORBIDDEN','Ce contexte nécessite une session utilisateur.')
  const apiKey=serverOnly?runtime.serviceRoleKey:runtime.anonKey
  const bearer=serverOnly&&runtime.serviceRoleKey.startsWith('sb_secret_')?'':token
  if(!token && name!=='lab_consent_portal') throw new ClinicalError(401,'UNAUTHENTICATED','Une session locale est requise.')
  const invoke = async () => {
    const response = await fetch(`${runtime.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { apikey: apiKey, ...(bearer ? {Authorization: `Bearer ${bearer}`} : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) })
    const payload = await response.json().catch(error => {
      if (error instanceof Error && error.name === 'TimeoutError') throw error
      return null
    })
    return { response, payload }
  }
  let result: Awaited<ReturnType<typeof invoke>>
  try { result = await invoke() }
  catch (error) {
    if (name !== 'lab_admission_command' || !(error instanceof Error && error.name === 'TimeoutError')) throw error
    // The receipt key is part of args: a replay may return the first committed result.
    result = await invoke()
  }
  const { response, payload } = result
  if (!response.ok) {
    if (['lab_calendar_query','lab_calendar_command','lab_calendar_financial_query','lab_billing_query','lab_billing_opening_policy','lab_billing_command','lab_billing_receipt_send_demo','lab_billing_batch_service','lab_billing_stripe_test_reserve','lab_billing_stripe_test_attach','lab_billing_stripe_test_settle','lab_billing_stripe_card_query','lab_billing_stripe_card_customer','lab_billing_stripe_card_save','lab_billing_stripe_saved_prepare','lab_billing_stripe_saved_settle','lab_billing_stripe_saved_fail','lab_billing_stripe_checkout_verify','lab_fee_query','lab_fee_quote','lab_fee_server_command'].includes(name)) {
      const known=typeof payload?.message==='string'&&Object.hasOwn(activityFinanceFailures,payload.message)?activityFinanceFailures[payload.message]:undefined
      if(known&&payload?.code===known.sqlState)throw new ClinicalError(known.status,payload.message,known.message)
    }
    if(['lab_billing_query','lab_billing_opening_policy','lab_billing_command','lab_billing_receipt_send_demo','lab_billing_batch_service','lab_billing_stripe_test_reserve','lab_billing_stripe_test_attach','lab_billing_stripe_test_settle','lab_billing_stripe_card_query','lab_billing_stripe_card_customer','lab_billing_stripe_card_save','lab_billing_stripe_saved_prepare','lab_billing_stripe_saved_settle','lab_billing_stripe_saved_fail','lab_billing_stripe_checkout_verify','lab_fee_query','lab_fee_quote','lab_fee_server_command'].includes(name)){
      const failure=typeof payload?.message==='string'?payload.message:''
      const status=payload?.code==='42501'?403:payload?.code==='P0002'?404:['40001','40P01','23505'].includes(payload?.code)?409:payload?.code?.startsWith('22')?400:503
      const code=/^(?:BILLING|FEE)_[A-Z_]+$/.test(failure)?failure:status===409?'FINANCE_CONCURRENT_CHANGE':status===403?'FORBIDDEN':'LOCAL_FINANCE_FAILED'
      throw new ClinicalError(status,code,status===403?'Cette opération financière n’est pas autorisée pour cet espace.':status===409?'Les données financières ont changé. Actualisez avant de réessayer ; votre saisie est conservée.':status===400?'Vérifiez les montants, la période et les conditions de cette opération fictive.':'L’opération financière locale n’a pas pu être confirmée.')
    }
    if(name==='lab_mandate_query'||name==='lab_mandate_command'||name==='lab_mandate_preview_pdf'||name==='lab_consent_portal'||name==='lab_mandate_delivery_query'||name==='lab_mandate_delivery_command'){
      const known=typeof payload?.message==='string'&&Object.hasOwn(mandateFailures,payload.message)?mandateFailures[payload.message]:undefined
      if(known&&payload?.code===known.sqlState)throw new ClinicalError(known.status,payload.message,known.message)
      if(['40001','40P01','23505'].includes(payload?.code))throw new ClinicalError(409,'MANDATE_CONCURRENT_CHANGE','Le mandat a changé pendant cette opération. Actualisez avant de poursuivre ; votre saisie est conservée.')
    }
    if (['lab_client_overview','lab_client_document','lab_client_command'].includes(name)) {
      if (payload?.message === 'CLIENT_PAYER_TOTAL' && payload?.code === '22023') throw new ClinicalError(400,'CLIENT_PAYER_TOTAL','Les parts des responsables des honoraires ne peuvent pas dépasser 100 %. Réduisez une part existante avant d’en ajouter une autre.')
      if (payload?.message === 'CLIENT_ENCOUNTER_EXISTS' && payload?.code === '40001') throw new ClinicalError(409,'CLIENT_ENCOUNTER_EXISTS','Ce dossier comprend déjà une rencontre. Rédigez une note de fermeture avant de le fermer.')
      if (payload?.message === 'CLIENT_NO_CLOSURE_SLOT' && payload?.code === '40001') throw new ClinicalError(409,'CLIENT_NO_CLOSURE_SLOT','Aucune place libre pour inscrire la fermeture au calendrier dans les 48 prochaines heures. Réessayez lorsque le calendrier le permet.')
      const status = payload?.code === '42501' ? 403 : ['40001','23505','40P01'].includes(payload?.code) ? 409 : payload?.code === 'P0002' ? 404 : payload?.code?.startsWith('22') ? 400 : 503
      const future=payload?.message==='CLIENT_FUTURE_APPOINTMENTS'
      throw new ClinicalError(status, future?'CLIENT_FUTURE_APPOINTMENTS':status===409?'VERSION_CONFLICT':status===403?'FORBIDDEN':'CLIENT_OPERATION_FAILED',future?'Traitez les rendez-vous futurs avant de fermer ce dossier. Aucun rendez-vous n’a été annulé.':status===403?'Cette action n’est pas autorisée pour ce dossier et cet espace.':status===409?'Ce dossier a changé. Actualisez avant de réessayer ; votre saisie est conservée.':status===400?'Vérifiez les renseignements saisis ou le document choisi.':'L’opération du dossier local n’a pas pu être confirmée.')
    }
    const failure = (name === 'lab_admission_query' || name === 'lab_admission_command') && typeof payload?.message === 'string' && Object.hasOwn(admissionFailures, payload.message) ? admissionFailures[payload.message] : undefined
    if (failure && payload?.code === failure.sqlState) throw new ClinicalError(failure.status, payload.message, failure.message)
    if (name === 'lab_command' && payload?.message === 'CLINICAL_EMPTY_CORRECTION' && payload?.code === '22023') throw new ClinicalError(400, 'CLINICAL_EMPTY_CORRECTION', 'Modifiez ou complétez le texte avant de signer cette correction. La note d’origine reste inchangée.')
    if (name === 'lab_calendar_query' || name === 'lab_calendar_journal' || name === 'lab_calendar_command' || name === 'lab_calendar_financial_query') {
      const known = typeof payload?.message === 'string' && Object.hasOwn(calendarFailures, payload.message) ? calendarFailures[payload.message] : undefined
      if (known && payload?.code === known.sqlState) throw new ClinicalError(known.status, payload.message, known.message)
      if (['23P01','40P01','40001'].includes(payload?.code)) throw new ClinicalError(409, payload.code === '23P01' ? 'CALENDAR_CONFLICT' : payload.code === '40P01' ? 'CALENDAR_CONCURRENT_CHANGE' : 'VERSION_CONFLICT', payload.code === '23P01' ? 'Cette plage n’est pas disponible pour le professionnel, le client ou le bureau. Choisissez une autre plage.' : 'Le calendrier a changé pendant cette opération. Actualisez avant de réessayer ; votre saisie est conservée.')
    }
    const status = payload?.code === '42501' || response.status === 403 ? 403 : payload?.code === '40001' || payload?.code === '23505' ? 409 : payload?.code === 'P0002' ? 404 : payload?.code?.startsWith('22') ? 400 : response.status === 401 ? 401 : 503
    throw new ClinicalError(status, status === 409 ? 'VERSION_CONFLICT' : status === 403 ? 'FORBIDDEN' : 'LOCAL_OPERATION_FAILED', status === 409 ? 'Les données ont changé. Actualisez avant de réessayer ; votre saisie est conservée.' : status === 403 ? 'Cette opération n’est pas autorisée pour ce compte et cet espace.' : 'L’opération locale n’a pas pu être confirmée.')
  }
  return payload as T
}
export async function localIdentity(request: Request): Promise<{ runtime: DurableClinicalRuntime; token: string; actor: FixtureActor }> {
  checkLocalOrigin(request)
  const runtime = readDurableClinicalRuntime()
  const token = sessionToken(request)
  if (!token || token.length > 8192) throw new ClinicalError(401, 'UNAUTHENTICATED', 'Connectez-vous au laboratoire local.')

  const response = await fetch(`${runtime.supabaseUrl}/auth/v1/user`, { redirect: 'error', cache: 'no-store',
    headers: { apikey: runtime.anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new ClinicalError(401, 'UNAUTHENTICATED', 'La session locale a expiré. Reconnectez-vous.')
  const user: unknown = await response.json()
  if (!user || typeof user !== 'object' || typeof (user as {id?: unknown}).id !== 'string') throw new ClinicalError(401, 'UNAUTHENTICATED', 'Session locale non valide.')
  if (isStagingClinicalRuntime() && !stagingAllowedEmails().includes(String((user as {email?: unknown}).email ?? '').toLowerCase())) {
    throw new ClinicalError(403, 'STAGING_ACCOUNT_REFUSED', 'Ce compte n’est pas autorisé pour cet essai.')
  }
  const environment = await localRpc<{projectId:string;fictional:boolean}>(runtime,token,'lab_environment')
  if (environment?.projectId !== runtime.projectId || environment.fictional !== true) throw new ClinicalError(503, 'ENVIRONMENT_REFUSED', 'La base locale attendue n’est pas disponible.')
  const actor = await localRpc<FixtureActor>(runtime, token, 'lab_identity')
  if (actor.id !== (user as {id:string}).id) throw new ClinicalError(403, 'IDENTITY_MISMATCH', 'Le compte local ne correspond pas à la session.')
  return { runtime, token, actor }
}

// Les prototypes des lots ultérieurs ne doivent jamais écrire dans un état mémoire
// lorsque l'utilisateur a choisi le laboratoire connecté à la base locale.
export async function localModuleUnavailable(request: Request): Promise<Response> {
  try {
    await localIdentity(request)
    contextOf(request)
    return localJson({ error: 'Ce module est encore une simulation et sera raccordé à la base locale dans un lot ultérieur.', code: 'MODULE_NOT_DURABLE' }, 501)
  } catch (error) {
    if (error instanceof ClinicalError) return localJson({error:error.message,code:error.code},error.status)
    return localJson({error:'La base fictive locale est indisponible.',code:'LOCAL_UNAVAILABLE'},503)
  }
}


