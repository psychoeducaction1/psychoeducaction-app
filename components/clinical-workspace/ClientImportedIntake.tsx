import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { ClientFileSection } from './ClientFileIdentity'

export function ClientImportedIntake({ overview }: { overview: ClientOverview }) {
  if (!overview.importedIntake?.length) return null
  return <ClientFileSection title="Détails de la prise en charge importée">
    {overview.importedIntake.some(item => item.reviewRequired) ? <p className="mb-3 text-sm text-amber-900">Informations de l’Excel à vérifier. Les requérants proposés ne disposent d’aucun droit de consentement automatique.</p> : <p className="mb-3 text-sm">Informations validées lors de la migration. Les consentements et signatures du client sont suivis séparément.</p>}
    {overview.importedIntake.map(({ caseId, facts, financiallyActive }) => <dl key={caseId} className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-[#7a6859]">Prise en charge financière</dt><dd>{financiallyActive ? 'Mandat actif pour la facturation · signatures suivies séparément' : 'Conditions financières à compléter'}</dd></div>
      {([
        ['Premier appel', facts.initialCallDate], ['Premier rendez-vous historique', facts.firstAppointmentDate],
        ['Motif de consultation', facts.consultationReason], ['Référé par', facts.referredBy],
        ['Mandat dans l’export', (facts.originalMandates ?? []).join(' · ')], ['Clientèle', facts.clientele],
        ['Statut dans l’export', facts.sourceActive], ['Responsable des honoraires dans l’export', facts.billingResponsible],
        ['Interlocuteur', facts.interlocutor], ['Lien déclaré', facts.relationship],
      ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[#7a6859]">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
      <div className="sm:col-span-2"><dt className="text-[#7a6859]">Requérants déclarés dans l’export</dt><dd>{(facts.requesters ?? []).map((p, i) => <p key={i} className="break-words">{[p.fullName, p.email, p.city, p.postalCode].filter(Boolean).join(' · ')}</p>)}</dd></div>
    </dl>)}
  </ClientFileSection>
}
