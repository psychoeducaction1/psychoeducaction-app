import { dateTimeInputToUtcInToronto, dateTimeInputValueInToronto, INTAKE_TIME_ZONE } from '@/lib/publicIntakeSchedule'

export const SERVICE_APPOINTMENT_MODALITIES = {
  telehealth: 'Visioconférence',
  home: 'Présentiel à domicile',
  montreal: 'Présentiel — bureau de Montréal',
  longueuil: 'Présentiel — bureau de Longueuil',
} as const
export type ServiceAppointmentModality = keyof typeof SERVICE_APPOINTMENT_MODALITIES
export type ServiceAppointmentInput = { date: string; time: string; modality: ServiceAppointmentModality }
export type ServiceAppointment = ServiceAppointmentInput & { startsAt: string; timeZone: 'America/Toronto'; address: string | null }
export type ServiceOfficeAddresses = { montreal: string; longueuil: string }

export function validateServiceAppointmentInput(value: unknown): ServiceAppointmentInput {
  const input = value as Partial<ServiceAppointmentInput> | null
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ||
    !Object.hasOwn(SERVICE_APPOINTMENT_MODALITIES, input.modality ?? '')) {
    throw new Error('La date, l’heure et la modalité du premier rendez-vous sont obligatoires.')
  }
  const local = `${input.date}T${input.time}`
  const instant = dateTimeInputToUtcInToronto(local)
  if (dateTimeInputValueInToronto(instant) !== local) throw new Error('La date ou l’heure est invalide dans le fuseau du Québec.')
  if ([-3600000, 3600000].some(delta => dateTimeInputValueInToronto(new Date(instant.getTime() + delta)) === local)) {
    throw new Error('Cette heure est ambiguë lors du changement d’heure au Québec. Choisissez une heure sans ambiguïté.')
  }
  return { date: input.date, time: input.time, modality: input.modality! }
}

export function buildServiceAppointment(value: unknown, offices: ServiceOfficeAddresses): ServiceAppointment {
  const input = validateServiceAppointmentInput(value)
  const address = input.modality === 'montreal' || input.modality === 'longueuil' ? offices[input.modality]?.trim() : null
  if ((input.modality === 'montreal' || input.modality === 'longueuil') && !address) throw new Error(`L’adresse du bureau de ${input.modality === 'montreal' ? 'Montréal' : 'Longueuil'} doit être configurée avant de confirmer ce rendez-vous.`)
  return { ...input, startsAt: dateTimeInputToUtcInToronto(`${input.date}T${input.time}`).toISOString(), timeZone: INTAKE_TIME_ZONE, address: address ?? null }
}

export function readStoredServiceAppointment(value: unknown): ServiceAppointment {
  const input = value as Partial<ServiceAppointment> | null
  if (!input || typeof input.address !== 'string' && input.address !== null) throw new Error('Rendez-vous enregistré incomplet.')
  const appointment = buildServiceAppointment(input, { montreal: input.address ?? '', longueuil: input.address ?? '' })
  if (input.startsAt !== appointment.startsAt || input.timeZone !== appointment.timeZone) throw new Error('Rendez-vous enregistré incohérent.')
  return appointment
}

export function serviceAppointmentSummary(appointment: ServiceAppointment): string[] {
  return [
    `Date : ${new Intl.DateTimeFormat('fr-CA', { dateStyle: 'full', timeZone: INTAKE_TIME_ZONE }).format(new Date(appointment.startsAt))}`,
    `Heure : ${appointment.time.replace(':', ' h ')} (heure du Québec)`,
    `Modalité : ${SERVICE_APPOINTMENT_MODALITIES[appointment.modality]}`,
    ...(appointment.address ? [`Adresse : ${appointment.address}`] : []),
  ]
}

export function serviceAppointmentInstructions(appointment: ServiceAppointment, professionalDesignation = 'Votre professionnel'): string[] {
  if (appointment.modality === 'telehealth') return [
    `Le lien de connexion vous sera envoyé par ${professionalDesignation.toLowerCase()} le jour même du rendez-vous.`,
    'Pensez à vérifier vos courriels indésirables, car le message contenant le lien pourrait s’y retrouver.',
  ]
  if (appointment.modality === 'home') return [`${professionalDesignation} se présentera au domicile convenu pour la rencontre.`]
  if (appointment.modality === 'montreal') return []
  return [
    'Pour cette rencontre en présentiel à nos bureaux, merci de vous présenter à l’heure exacte de votre rendez-vous.',
    `${professionalDesignation} vous ouvrira la porte à l’heure prévue.`,
    'Si vous arrivez en avance, nous vous invitons à patienter dans votre voiture ou à l’extérieur du bâtiment jusqu’à l’heure de votre rendez-vous.',
  ]
}
