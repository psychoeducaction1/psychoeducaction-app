'use client'

import { Badge, buttonClass } from '@/components/Ui'
import type { DurableBillingCommand } from '@/lib/clinical-finance/durableTypes'
import type { BillingUi } from './InvoiceDetail'
import { BillingForm, Fold, clinicalCard } from './primitives'
import { dateLabel, money } from './model'
import { localDateTime } from '@/lib/clinical-calendar/time'

export function PreparationPanel({ ui }: { ui: BillingUi }) {
  const current = ui.data, candidates = current.openingCandidates
  return <div className="grid min-w-0 gap-4">
    <section className="rounded-xl border border-[#eadfd2] bg-white p-4"><h3 className="font-semibold">Factures des rencontres terminées</h3><p className="mt-2 text-sm">Les rencontres facturables sont préparées à partir du lendemain, selon les tarifs et les payeurs du mandat. Relancer la préparation reprend les rencontres admissibles sans les facturer une deuxième fois. Aucun courriel ni paiement n’est déclenché.</p><div className="mt-3"><BillingForm build={() => ({ action: 'batch.prepare', data: { throughDate: current.currentDate } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy} submitLabel="Relancer la préparation"><span className="sr-only">Relancer la préparation jusqu’au {current.currentDate}</span></BillingForm></div></section>
    {current.mode === 'isolated_local' && <Fold title={'Premier rendez-vous et ouverture unique · ' + money(6000)}>
      <p className="mb-4 text-sm">Confirmez explicitement le premier rendez-vous. Les frais d’ouverture sont de 60 $ par client, une seule fois, répartis selon le mandat. Ils ne génèrent aucun honoraire professionnel.</p>
      <div className="grid gap-4">{candidates.map(candidate => <article key={candidate.appointmentId} className="rounded-xl border border-[#eadfd2] p-3"><div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-semibold">{candidate.clientName}</h4><p className="mt-1 text-sm">{dateLabel(candidate.startAt)} · {candidate.professionalName}</p></div><Badge tone={candidate.confirmed ? 'success' : 'warning'}>{candidate.confirmed ? 'Confirmation conservée' : 'À confirmer'}</Badge></div>
        {candidate.confirmed ? <p className="mt-3 text-sm">Les frais d’ouverture ont déjà été créés. Aucune seconde ouverture n’est proposée.</p> : <div className="mt-3"><BillingForm build={() => ({ action: 'opening.confirm', data: { appointmentId: candidate.appointmentId, expectedAppointmentVersion: candidate.appointmentVersion, confirmed: true } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy} submitLabel="Confirmer le premier rendez-vous et les frais uniques" confirmation="Confirmer ce premier rendez-vous et créer les frais uniques de 60 $ selon le mandat fictif ?" confirmationDetails={() => <p>{candidate.clientName} · {dateLabel(candidate.startAt)} · {candidate.professionalName} · total unique de {money(6000)} réparti selon le mandat</p>}><label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" />J’ai vérifié qu’il s’agit du premier rendez-vous à confirmer pour cette identité permanente. Aucune facture n’est envoyée.</label></BillingForm></div>}
        <button className={buttonClass('ghost') + ' mt-3'} onClick={() => void ui.openModule('calendar', { client: candidate.clientId, scope: 'client', view: 'day', day: localDateTime(candidate.startAt).slice(0, 10), appointment: candidate.appointmentId })}>Voir le calendrier du client</button>
      </article>)}{!candidates.length && <p className="text-sm">Aucun premier rendez-vous à confirmer dans cette projection.</p>}</div>
    </Fold>}
    {current.mode === 'isolated_unified' && <section className={clinicalCard}><h3 className="font-semibold">Frais d’ouverture</h3><p className="mt-2 text-sm">Les frais d’ouverture sont ajoutés une seule fois à la première rencontre facturée d’un nouveau dossier, selon la décision enregistrée dans sa fiche. Pour un dossier existant ou migré, vérifiez cette décision avant de facturer afin de ne pas refacturer une ancienne ouverture.</p></section>}
  </div>
}
