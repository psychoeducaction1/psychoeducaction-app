import { serviceAppointmentInstructions, serviceAppointmentSummary, type ServiceAppointment } from '@/lib/serviceAppointment'
import { formatProfessionalName, type ProfessionalCivility } from '@/lib/professionalCivility'

export function buildServiceTakenConfirmationEmail({ clientFullName, professionalName, professionalCivility, professionalEmail, professionalPhone, appointment }: {
  clientFullName: string; professionalName: string; professionalCivility?: ProfessionalCivility | null; professionalEmail: string; professionalPhone: string; appointment: ServiceAppointment
}) {
  const designation = professionalCivility === 'Mme' ? 'Votre professionnelle' : professionalCivility === 'M.' ? 'Votre professionnel' : 'La personne responsable de votre suivi'
  const name = formatProfessionalName(professionalName, professionalCivility)
  const text = [
    'Bonjour,', '',
    `Nous avons le plaisir de vous confirmer un rendez-vous avec ${name}, dans le cadre du dossier de ${clientFullName} à la Clinique PsychoÉducAction.`, '',
    ...serviceAppointmentSummary(appointment), '',
    ...serviceAppointmentInstructions(appointment, designation), '',
    professionalCivility ? `Coordonnées de votre ${professionalCivility === 'Mme' ? 'professionnelle' : 'professionnel'} :` : 'Coordonnées pour votre suivi :', '',
    `Courriel : ${professionalEmail}`, `Téléphone : ${professionalPhone}`, '',
    `${designation} est en copie conforme de ce courriel afin de faciliter vos communications concernant le rendez-vous.`, '',
    'Au plaisir de vous accompagner,', '', 'Clinique PsychoÉducAction', 'Tél. : (438) 500-1388',
    'Courriel : contact@psychoeducaction.com', 'www.psychoeducaction.com',
  ].join('\n')
  const html = renderServiceConfirmationHtml(text)
  return {
    subject: 'Confirmation de votre rendez-vous – Clinique PsychoÉducAction',
    text, html,
  }
}

export function renderServiceConfirmationHtml(text: string) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  return text.split('\n\n').filter(Boolean).map(block => `<p>${block.split('\n').map(line =>
    line.startsWith('Pensez à vérifier vos courriels indésirables') ? `<strong>${escape(line)}</strong>` : escape(line)
  ).join('<br>')}</p>`).join('\n')
}
