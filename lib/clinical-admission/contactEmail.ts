/** Same first-contact wording as the assignment application; no delivery occurs here. */
export function firstContactEmail(firstName: string) {
  return {
    subject: 'Nous avons tenté de vous joindre – Clinique PsychoÉducAction',
    message: [
      `Bonjour ${firstName.trim() || 'Bonjour'},`,
      '',
      'Nous avons tenté de vous joindre concernant votre demande de service auprès de la Clinique PsychoÉducAction, mais nous n’avons pas réussi à vous parler.',
      '',
      'Un professionnel est actuellement disponible pour vous offrir le service. Veuillez nous rappeler au (438) 500-1388 afin que nous puissions finaliser votre assignation et planifier votre premier rendez-vous.',
      '',
      'Nos heures d’ouverture sont du lundi au vendredi, de 8 h à 18 h 30, ainsi que le samedi, de 12 h à 16 h.',
      '',
      'Merci,',
      'Clinique PsychoÉducAction',
      '(438) 500-1388',
      'contact@psychoeducaction.com',
    ].join('\n'),
  }
}
