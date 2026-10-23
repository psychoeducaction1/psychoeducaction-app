export type PlatformAccessProfile = { platform_access_enabled?: boolean | null }

// Les anciens profils (champ null ou absent) gardent leur accès. La disponibilité
// métier is_active ne détermine pas le droit de se connecter à la plateforme.
export function hasPlatformAccess(profile: PlatformAccessProfile | null | undefined): boolean {
  return Boolean(profile) && profile?.platform_access_enabled !== false
}
