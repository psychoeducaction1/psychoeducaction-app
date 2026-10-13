import { SatisfactionSurvey } from '@/components/satisfaction/SatisfactionSurvey'

export default async function SatisfactionTestPage({ searchParams }: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view } = await searchParams
  if (view !== 'google' && view !== 'unsubscribe') return <SatisfactionSurvey demo />
  return <div className="flex min-h-screen items-center justify-center bg-[#fbf7f1] px-4 py-10">
    <main className="w-full max-w-xl rounded-3xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-lg sm:p-10">
      <p className="text-sm font-semibold text-[#9b6a3d]">CLINIQUE PSYCHOÉDUCACTION — MODE TEST</p>
      <h1 className="mt-3 text-2xl font-bold">{view === 'google' ? 'Un avis public sur Google' : 'Désabonnement de démonstration'}</h1>
      <p className="mt-4 text-sm leading-relaxed">{view === 'google'
        ? 'Dans un courriel réel, ce bouton ouvre la fiche Google de la clinique pour laisser une note et un commentaire public. Ce test ne publie aucun avis.'
        : 'Dans un courriel réel, ce lien permet de confirmer votre désabonnement. Ce test ne change aucune préférence.'}</p>
      <a href="/satisfaction/test" className="mt-6 inline-block rounded-xl bg-[#9b6a3d] px-6 py-3 text-sm font-semibold text-white">Tester le sondage privé</a>
    </main>
  </div>
}
