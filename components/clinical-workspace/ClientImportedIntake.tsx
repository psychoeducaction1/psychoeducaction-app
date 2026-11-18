import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { ClientFileSection } from './ClientFileIdentity'

export function ClientImportedIntake({ overview }: { overview: ClientOverview }) {
  if (!overview.importedIntake?.length) return null
  return <ClientFileSection title="Renseignements complémentaires">
    {overview.importedIntake.map(({ caseId, facts }) => <dl key={caseId} className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
      {([
        ['Premier appel', facts.initialCallDate], ['Premier rendez-vous', facts.firstAppointmentDate],
        ['Motif de consultation', facts.consultationReason], ['Référé par', facts.referredBy],
        ['Service initial', (facts.originalMandates ?? []).join(' · ')], ['Clientèle', facts.clientele],
        ['Statut initial', facts.sourceActive], ['Responsable des honoraires initial', facts.billingResponsible],
        ['Interlocuteur', facts.interlocutor], ['Lien déclaré', facts.relationship],
      ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[#7a6859]">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
      <div className="sm:col-span-2"><dt className="text-[#7a6859]">Requérants</dt><dd>{(facts.requesters ?? []).map((p, i) => <p key={i} className="break-words">{[p.fullName, p.email, p.city, p.postalCode].filter(Boolean).join(' · ')}</p>)}</dd></div>
    </dl>)}
  </ClientFileSection>
}
