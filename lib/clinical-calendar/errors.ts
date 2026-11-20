import { mandateDateFailure } from '../clinical-mandates/dateErrors.ts'
import type { ClinicalAccessContext } from '../clinical-core/types.ts'

/** Fixed messages only: never forward provider details, dates or identities. */
const messages: Record<string, string> = {
  NOT_HELD_PREVIEW_CHANGED: 'La rencontre, sa note ou sa facture a changé. Fermez cette fenêtre, puis ouvrez à nouveau la rencontre pour vérifier l’annulation.',
  NOT_HELD_FUTURE_ABSENCE: 'Vous pourrez déclarer le client absent à partir de l’heure prévue de la rencontre. Pour le moment, vous pouvez annuler le rendez-vous.',
  NOT_HELD_FINAL_FEES_REVIEW_REQUIRED: 'Cette rencontre figure déjà dans des honoraires validés. Demandez à la Direction de vérifier ces honoraires avant de déclarer l’annulation ou l’absence.',
  CALENDAR_CONCURRENT_CHANGE: 'Une autre modification a eu lieu pendant l’enregistrement. Actualisez le calendrier, puis réessayez.',
  CALENDAR_RESERVATION_CONFLICT: 'Ce créneau entre en conflit avec une autre réservation. Choisissez un autre horaire.',
  CALENDAR_DUPLICATE: 'Cette activité ou cette opération existe déjà. Actualisez le calendrier avant de réessayer.',
  CALENDAR_OFFICE_CONFLICT: 'Ce bureau est indisponible à cette heure-là. Choisissez un autre bureau ou un autre horaire.',
  CALENDAR_PATIENT_CONFLICT: 'Ce client a déjà une rencontre à ce moment-là. Choisissez un autre horaire.',
  CALENDAR_VERSION_CONFLICT: 'Cette rencontre a été modifiée entre-temps. Actualisez le calendrier avant de réessayer.',
  CALENDAR_SERIES_CONFLICT: 'La série de rencontres a été modifiée entre-temps. Actualisez le calendrier avant de réessayer.',
  REMOVAL_PREVIEW_CHANGED: 'La rencontre ou ses documents liés ont changé depuis la confirmation. Actualisez avant de confirmer la suppression.',
  CORRECTION_PREVIEW_CHANGED: 'La rencontre ou ses documents liés ont changé. Actualisez avant de confirmer la correction.',
  CALENDAR_INVALID_OFFICE: 'Ce bureau n’est plus disponible. Choisissez un autre bureau.',
  CALENDAR_OFFICE_IN_USE: 'Ce bureau a encore des rencontres planifiées. Déplacez-les avant de le désactiver.',
  CALENDAR_IDEMPOTENCY_CONFLICT: 'Cette action a déjà été utilisée pour un autre enregistrement. Actualisez le calendrier avant de réessayer.',
  CALENDAR_GRANTS_INVALIDATE_EVENT: 'Ce changement d’accès laisserait une rencontre sans bureau autorisé. Déplacez la rencontre avant de modifier les accès.',
  CALENDAR_AVAILABILITY_INVALIDATES_EVENT: 'Ces disponibilités ne couvrent pas une rencontre déjà planifiée. Déplacez-la avant de les modifier.',
  CORRECTION_COMPLETED_DATE_REQUIRED: 'Une rencontre effectuée doit conserver une date et une heure de fin déjà passées.',
}
export function calendarFailure(error: unknown, context: ClinicalAccessContext): { code: string; message: string; status: 409 } | null {
  const mandateDate = mandateDateFailure(error)
  if (mandateDate) return { code: mandateDate.code, message: mandateDate.message, status: 409 }
  if (!error || typeof error !== 'object') return null
  const raw = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  const known = (code: string) => Object.hasOwn(messages, code) || code === 'CALENDAR_PROFESSIONAL_CONFLICT' || code === 'CALENDAR_OFFICE_NOT_GRANTED' || code === 'CALENDAR_PROFESSIONAL_UNAVAILABLE'
  let code = known(raw) ? raw : ['23P01','40001','22023','42501'].includes(raw) && known(message) ? message : ''
  if (!code && raw === '23P01') {
    if (message.includes('"clinical_professional_overlap"')) code = 'CALENDAR_PROFESSIONAL_CONFLICT'
    else if (message.includes('"clinical_office_overlap"')) code = 'CALENDAR_OFFICE_CONFLICT'
  }
  if (code === 'CALENDAR_PROFESSIONAL_CONFLICT') return { code, status: 409, message: context === 'clinical' ? 'Vous avez déjà une rencontre à ce moment-là. Choisissez un autre horaire.' : 'Ce professionnel a déjà une rencontre à ce moment-là. Choisissez un autre horaire.' }
  if (code === 'CALENDAR_OFFICE_NOT_GRANTED') return { code, status: 409, message: context === 'clinical' ? 'Ce bureau ne vous est pas attribué pour cette date. Choisissez un autre bureau.' : 'Ce bureau n’est pas attribué à ce professionnel pour cette date. Choisissez un autre bureau.' }
  if (code === 'CALENDAR_PROFESSIONAL_UNAVAILABLE') return { code, status: 409, message: 'Cet horaire est en dehors des disponibilités du professionnel. Choisissez un autre horaire.' }
  if (code) return { code, status: 409, message: messages[code] }
  if (raw === '40001') return { code: 'CALENDAR_CONCURRENT_CHANGE', status: 409, message: 'Une autre modification a eu lieu pendant l’enregistrement. Actualisez le calendrier, puis réessayez.' }
  if (raw === '23P01') return { code: 'CALENDAR_RESERVATION_CONFLICT', status: 409, message: 'Ce créneau entre en conflit avec une autre réservation. Choisissez un autre horaire.' }
  if (raw === '23505') return { code: 'CALENDAR_DUPLICATE', status: 409, message: 'Cette activité ou cette opération existe déjà. Actualisez le calendrier avant de réessayer.' }
  return null
}
