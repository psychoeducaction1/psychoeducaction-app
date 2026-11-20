export function clinicalHomeDestination(role: string | null, realClinical: boolean): string | null {
  if (role === 'direction') return realClinical ? '/administration' : '/direction'
  if (role === 'professionnel') return realClinical ? '/clinique/mon-profil' : '/professionnel'
  return null
}
