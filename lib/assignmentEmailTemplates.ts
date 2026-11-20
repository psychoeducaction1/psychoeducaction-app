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
  appointment?: { date: string; time: string; modality: 'telehealth' | 'home' | 'montreal' | 'longueuil' } | null
}

export type AssignmentEmailTemplate = {
  to: string
  subject: string
  message: string
  cc?: string[]
}

// Cas particulier : Rim El Bassit pratique sous supervision clinique — sa
// superviseure doit être en copie conforme du courriel envoyé au client, avec
// un texte mentionnant explicitement cette supervision.
const RIM_EL_BASSIT_EMAIL = 'rim.elbassit.pea@outlook.com'
const RIM_EL_BASSIT_SUPERVISOR_CC = 'nancy.alkayal.pea@outlook.com'

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

export type PendingReminderClient = {
  firstName: string
  lastName: string
  assignedDate: string
}

export type ProfessionalPendingReminderEmailTemplateInput = {
  professionalName?: string | null
  professionalEmail?: string | null
  appUrl: string
  pendingClients: PendingReminderClient[]
}

export function buildProfessionalPendingReminderEmailTemplate({
  professionalName,
  professionalEmail,
  appUrl,
  pendingClients,
}: ProfessionalPendingReminderEmailTemplateInput): AssignmentEmailTemplate {
  const normalizedName =
    cleanText(professionalName) || cleanText(professionalEmail) || 'Professionnel'
  const count = pendingClients.length
  const plural = count > 1

  return {
    to: cleanText(professionalEmail),
    subject: plural
      ? "Petit rappel – quelques clients n'ont pas encore été contactés"
      : "Petit rappel – un client n'a pas encore été contacté",
    message: [
      `Bonjour ${normalizedName},`,
      '',
      `Petit rappel concernant ${
        plural
          ? 'certaines assignations qui vous ont été transmises'
          : 'une assignation qui vous a été transmise'
      } il y a quelques jours.`,
      '',
      `Selon les informations actuellement inscrites dans la plateforme, ${
        plural
          ? 'les clients ci-dessous sont toujours identifiés comme n\'ayant pas encore été contactés'
          : 'le client ci-dessous est toujours identifié comme n\'ayant pas encore été contacté'
      } :`,
      '',
      ...pendingClients.map((client) => `- ${client.firstName} ${client.lastName}`),
      '',
      "Si vous avez déjà communiqué avec l'un de ces clients, il est possible que son statut n'ait simplement pas encore été mis à jour dans la plateforme.",
      '',
      'Dans le cas contraire, nous vous invitons à communiquer avec lui lorsque vous en aurez l\'occasion.',
      '',
      'Accéder à la plateforme :',
      appUrl.replace(/\/$/, ''),
      '',
      'Merci et bonne journée !',
      '',
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
  appointment,
}: ClientAssignmentEmailTemplateInput): AssignmentEmailTemplate {
  const appointmentPlace = appointment && {
    telehealth: 'Visioconférence', home: 'À domicile', montreal: 'Au bureau de Montréal', longueuil: 'Au bureau de Longueuil',
  }[appointment.modality]
  const appointmentLines = appointment ? [
    'Votre premier rendez-vous est confirmé :',
    `Date : ${appointment.date}`,
    `Heure : ${appointment.time} (heure du Québec)`,
    `Modalité : ${appointmentPlace}`,
    ...(appointment.modality === 'telehealth' ? [
      '', 'Le lien de visioconférence vous sera communiqué avant la rencontre. Vérifiez aussi vos courriels indésirables. Si vous ne recevez pas le lien, communiquez avec la clinique.',
    ] : appointment.modality === 'montreal' || appointment.modality === 'longueuil' ? [
      '', "Pour la rencontre au bureau, présentez-vous à l’heure exacte du rendez-vous. Si vous arrivez en avance, patientez dans votre voiture ou à l’extérieur jusqu’à l’heure prévue.",
    ] : []),
  ] : null
  if (cleanText(professionalEmail).toLowerCase() === RIM_EL_BASSIT_EMAIL) {
    return {
      to: '',
      subject: appointment ? 'Votre assignation et votre premier rendez-vous - Clinique PsychoÉducAction' : 'Assignation de votre dossier - Clinique PsychoÉducAction',
      cc: [RIM_EL_BASSIT_SUPERVISOR_CC],
      message: [
        'Bonjour,',
        '',
        'Nous espérons que vous allez bien.',
        '',
        "Nous avons le plaisir de vous informer que votre dossier à la Clinique PsychoÉducAction a été assigné à Rim El Bassit, clinicienne et praticienne en psychologie.",
        '',
        'Rim El Bassit offrira les services sous la supervision clinique de Nancy Al Kayal, psychologue et psychothérapeute.',
        '',
        ...(appointmentLines ?? [
          'Rim communiquera avec vous par courriel ou par téléphone dans les prochains jours afin de convenir d’une première rencontre.',
          '',
          'Pour les rencontres en visioconférence, le lien de connexion vous sera envoyé par le professionnel le jour même de votre rendez-vous.',
          'Pensez à vérifier vos courriels indésirables, car le message contenant le lien pourrait s’y retrouver.',
          '',
          "Pour les rencontres en présentiel à nos bureaux, merci de vous présenter à l'heure exacte de votre rendez-vous.",
          "Le professionnel vous ouvrira la porte à l'heure prévue.",
          "Si vous arrivez en avance, nous vous invitons à patienter dans votre voiture ou à l'extérieur du bâtiment jusqu'à l'heure de votre rendez-vous.",
        ]),
        '',
        'Merci!',
        '',
        'Au plaisir,',
      ].join('\n'),
    }
  }

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
    subject: appointment ? 'Votre assignation et votre premier rendez-vous - Clinique PsychoÉducAction' : 'Assignation de votre dossier - Clinique PsychoÉducAction',
    message: [
      'Bonjour,',
      '',
      'Nous espérons que vous allez bien.',
      '',
      `Nous avons le plaisir de vous informer que votre dossier à la Clinique PsychoÉducAction a été assigné à ${professionalNameWithTitle}.`,
      '',
      ...(appointmentLines ?? [
        `${normalizedProfessionalName} communiquera avec vous par courriel ou par téléphone dans les prochains jours afin de convenir d’une première rencontre.`,
        '',
        'Pour les rencontres en visioconférence, le lien de connexion vous sera envoyé par le professionnel le jour même de votre rendez-vous.',
        'Pensez à vérifier vos courriels indésirables, car le message contenant le lien pourrait s’y retrouver.',
        '',
        "Pour les rencontres en présentiel à nos bureaux, merci de vous présenter à l'heure exacte de votre rendez-vous.",
        "Le professionnel vous ouvrira la porte à l'heure prévue.",
        "Si vous arrivez en avance, nous vous invitons à patienter dans votre voiture ou à l'extérieur du bâtiment jusqu'à l'heure de votre rendez-vous.",
      ]),
      '',
      'Merci!',
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
