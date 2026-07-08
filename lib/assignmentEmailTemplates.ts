export type ProfessionalAssignmentEmailTemplateInput = {
  professionalName?: string | null
  professionalEmail?: string | null
  appUrl: string
}

export type ClientAssignmentEmailTemplateInput = {
  professionalName?: string | null
  professionalEmail?: string | null
  professionalTitle?: string | null
  professionalPhone?: string | null
  professionalLicenseNumber?: string | null
}

export type AssignmentEmailTemplate = {
  to: string
  subject: string
  message: string
}

function cleanText(value?: string | null) {
  return value?.trim() ?? ''
}

function formatOptionalLine(label: string, value?: string | null) {
  const normalizedValue = cleanText(value)

  return normalizedValue ? `${label} : ${normalizedValue}` : null
}

export function buildProfessionalAssignmentEmailTemplate({
  professionalName,
  professionalEmail,
  appUrl,
}: ProfessionalAssignmentEmailTemplateInput): AssignmentEmailTemplate {
  const normalizedName =
    cleanText(professionalName) || cleanText(professionalEmail) || 'Professionnel'

  return {
    to: cleanText(professionalEmail),
    subject: 'Nouvelle assignation disponible',
    message: [
      `Bonjour ${normalizedName},`,
      '',
      'Une ou plusieurs nouvelles assignations ont été ajoutées à votre compte PsychoÉducAction.',
      '',
      'Veuillez vous connecter à la plateforme afin de consulter vos assignations et mettre à jour leur statut.',
      '',
      'Accéder à la plateforme :',
      appUrl.replace(/\/$/, ''),
      '',
      'Merci,',
      'Clinique PsychoÉducAction',
    ].join('\n'),
  }
}

export function buildClientAssignmentEmailTemplate({
  professionalName,
  professionalEmail,
  professionalTitle,
  professionalPhone,
  professionalLicenseNumber,
}: ClientAssignmentEmailTemplateInput): AssignmentEmailTemplate {
  const normalizedProfessionalName =
    cleanText(professionalName) || 'votre professionnel'
  const normalizedProfessionalTitle = cleanText(professionalTitle)
  const professionalNameWithTitle = normalizedProfessionalTitle
    ? `${normalizedProfessionalName}, ${normalizedProfessionalTitle}`
    : normalizedProfessionalName
  const contactLines = [
    formatOptionalLine('Courriel', professionalEmail),
    formatOptionalLine('Téléphone', professionalPhone),
    formatOptionalLine('Numéro de permis', professionalLicenseNumber),
  ].filter(Boolean)

  return {
    to: '',
    subject: 'Assignation de votre dossier - Clinique PsychoÉducAction',
    message: [
      'Bonjour,',
      '',
      'Nous espérons que vous allez bien.',
      '',
      `Nous avons le plaisir de vous informer que votre demande auprès de la Clinique PsychoÉducAction a été assignée à ${professionalNameWithTitle}.`,
      '',
      `${normalizedProfessionalName} communiquera avec vous par courriel ou par téléphone dans les prochains jours afin de convenir d'une première rencontre.`,
      '',
      'Coordonnées du professionnel',
      '',
      ...contactLines,
      '',
      "Si vous avez des questions, n'hésitez pas à nous écrire par courriel ou à communiquer avec la clinique.",
      '',
      'Bien cordialement,',
      '',
      'Fatima Zahra Benlahcen',
      'Agente administrative',
      'Clinique PsychoÉducAction',
      'T : (438) 500-1388',
      'C : contact@psychoeducaction.com',
      'www.psychoeducaction.com',
    ].join('\n'),
  }
}
