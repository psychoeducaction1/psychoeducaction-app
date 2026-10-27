import { redirect } from 'next/navigation'

// Conserver les anciens favoris et l'aperçu sécurisé dans l'espace regroupé.
export default async function Page({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const params = await searchParams
  redirect(`/coordination-clinique?onglet=calendrier${params.preview === 'eve' ? '&preview=eve' : ''}`)
}
