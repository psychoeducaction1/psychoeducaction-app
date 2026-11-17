'use client'

import { useEffect, useRef, useState } from 'react'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import { Check, CreditCard, FileText, RefreshCw } from 'lucide-react'
import type { BillingLedgerKind, BillingLedgerReason, BillingWorkspace } from '@/lib/clinical-finance/types'
import { createLedgerIntentTracker } from '@/lib/clinical-finance/ledgerIntent'

const field = 'w-full rounded-lg border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820]'
const button = 'rounded-lg border border-[#dfd0bf] bg-white px-3 py-2 text-sm font-medium text-[#5d4a3d] disabled:cursor-not-allowed disabled:opacity-50'
const primary = `${button} !border-[#8a5633] !bg-[#8a5633] !text-white`
const money = (cents: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
const date = (value: string) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const ledgerLabels = { payment: 'Paiement simulé', credit: 'Avoir simulé', refund: 'Remboursement simulé' }
const reasonLabels = { simulation: 'Essai fictif', billing_correction: 'Correction de facturation', service_adjustment: 'Ajustement de service' }
function parseCents(value: string): number {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error('Indiquez un montant positif avec au maximum deux décimales.')
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (result <= 0) throw new Error('Le montant doit être supérieur à zéro.')
  return result
}

export function BillingPanel({ actorId, context }: { actorId: string; context: ClinicalAccessContext }) {
  const actorRef = useRef(actorId)
  useEffect(() => { actorRef.current = actorId }, [actorId])
  const [workspace, setWorkspace] = useState<BillingWorkspace | null>(null)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appointmentId, setAppointmentId] = useState('')
  const [payerId, setPayerId] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [kind, setKind] = useState<BillingLedgerKind>('payment')
  const [reason, setReason] = useState<BillingLedgerReason>('simulation')
  const [amount, setAmount] = useState('50,00')
  const [rate, setRate] = useState('200,00')
  const [effectiveFrom, setEffectiveFrom] = useState('2026-11-01')
  const [page, setPage] = useState(0)
  const [intentTracker] = useState(() => createLedgerIntentTracker())
  const intentVersion = workspace?.kind === 'administrative' ? workspace.invoices.find(value => value.id === invoiceId)?.version ?? 0 : 0
  useEffect(() => { intentTracker.clear() }, [actorId, invoiceId, kind, reason, amount, intentVersion, intentTracker])

  useEffect(() => {
    const controller = new AbortController()
    setWorkspace(null); setError(''); setConfirmation(null); setPending(false); setPage(0)
    fetch('/api/clinical-billing', { cache: 'no-store', signal: controller.signal, headers: { 'X-Clinical-Fixture-Actor': actorId, 'X-Clinical-Context': context } })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Lecture impossible.'); return data.workspace as BillingWorkspace })
      .then(value => {
        if (controller.signal.aborted) return
        setWorkspace(value)
        if (value.kind === 'administrative') {
          setAppointmentId(value.eligibleAppointments[0]?.id ?? '')
          const first = value.eligibleAppointments[0]
          setPayerId(value.clients.find(client => client.id === first?.clientId)?.payers[0]?.id ?? '')
          setInvoiceId(current => value.invoices.some(invoice => invoice.id === current && invoice.status === 'validated') ? current : value.invoices.find(invoice => invoice.status === 'validated')?.id ?? '')
        }
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Lecture impossible.') })
    return () => controller.abort()
  }, [actorId, context, revision])

  async function mutate(body: unknown, success: string, onSuccess?: () => void) {
    const requestedActor = actorId
    setPending(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/clinical-billing', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Clinical-Fixture-Actor': requestedActor, 'X-Clinical-Context': context }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Opération impossible.')
      if (actorRef.current === requestedActor) { onSuccess?.(); setMessage(success); setRevision(value => value + 1) }
    } catch (cause) { if (actorRef.current === requestedActor) setError(cause instanceof Error ? cause.message : 'Opération impossible.') }
    finally { if (actorRef.current === requestedActor) setPending(false) }
  }
  const current = workspace?.actor.id === actorId ? workspace : null
  if (!current) return <div className="rounded-xl border border-[#dfd0bf] bg-white p-5" aria-live="polite">{error || 'Chargement de la simulation financière…'}</div>
  const notice = <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><strong>Simulation financière uniquement.</strong> Aucune facture envoyée, aucun prélèvement, aucune paie réelle modifiée. Données en mémoire, perdues au redémarrage. Horloge fictive : {date(current.currentTime)}.</div>
  const alerts = <>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}</>
  if (current.kind === 'professional') return <section className="space-y-4">{notice}<div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-[#332820]">Mes honoraires simulés</h2><button className={button} onClick={() => setRevision(value => value + 1)}><RefreshCw className="mr-2 inline size-4" aria-hidden="true" />Actualiser</button></div>{alerts}<div className="rounded-xl border border-[#dfd0bf] bg-white p-5"><p className="text-sm text-[#77695e]">Estimation totale</p><p className="mt-1 text-3xl font-semibold text-[#332820]">{money(current.totalFeesCents)}</p><p className="mt-2 text-sm text-[#77695e]">Les estimations utilisent les règles de rémunération existantes et toutes vos rencontres indiquées comme effectuées dans la semaine. Le seuil hebdomadaire et la paie finale restent à confirmer.</p></div><div className="overflow-x-auto rounded-xl border border-[#dfd0bf] bg-white"><table className="w-full text-left text-sm"><thead className="bg-[#f5eee4]"><tr>{['Date du service', 'Client autorisé', 'Durée', 'Mes honoraires estimés'].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody>{current.fees.length ? current.fees.map((fee, index) => <tr className="border-t border-[#eee2d6]" key={`${fee.serviceDate}-${index}`}><td className="px-4 py-3">{fee.serviceDate}</td><td className="px-4 py-3">{fee.clientName}</td><td className="px-4 py-3">{fee.durationMinutes} min</td><td className="px-4 py-3 font-semibold">{money(fee.amountCents)}</td></tr>) : <tr><td colSpan={4} className="px-4 py-6 text-[#77695e]">Aucun honoraire simulé : une facture doit d’abord être préparée et validée par l’administration.</td></tr>}</tbody></table></div></section>

  const appointment = current.eligibleAppointments.find(value => value.id === appointmentId)
  const payers = current.clients.find(value => value.id === appointment?.clientId)?.payers ?? []
  const selectedInvoice = current.invoices.find(value => value.id === invoiceId && value.status === 'validated')
  const visibleKind = canAdmin(current.actor) ? kind : 'payment'
  const operationLimit = selectedInvoice ? visibleKind === 'payment' ? selectedInvoice.balance.dueCents : visibleKind === 'credit' ? selectedInvoice.totalCents - selectedInvoice.balance.creditedCents : selectedInvoice.balance.refundableCents : 0
  const validated = current.invoices.filter(value => value.status === 'validated')
  const sorted = [...current.invoices].reverse()
  const pageCount = Math.max(1, Math.ceil(sorted.length / 10))
  return <section className="space-y-5">{notice}<div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-[#332820]">Facturation et règlements fictifs</h2><p className="mt-1 text-sm text-[#77695e]">Le montant client et les honoraires professionnels sont séparés. Les tarifs sont en dollars canadiens.</p></div><button className={button} disabled={pending} onClick={() => setRevision(value => value + 1)}><RefreshCw className="mr-2 inline size-4" aria-hidden="true" />Actualiser</button></div>{alerts}
    <div className="grid gap-3 sm:grid-cols-3">{[
      ['Brouillons à vérifier', String(current.invoices.filter(value => value.status === 'draft').length)],
      ['Solde à recevoir simulé', money(validated.reduce((total, value) => total + value.balance.dueCents, 0))],
      ['Trop-perçu remboursable', money(validated.reduce((total, value) => total + value.balance.refundableCents, 0))],
    ].map(([label, value]) => <div className="rounded-xl border border-[#dfd0bf] bg-white p-4" key={label}><p className="text-sm text-[#77695e]">{label}</p><p className="mt-1 text-2xl font-semibold text-[#332820]">{value}</p></div>)}</div>
    <form className="space-y-4 rounded-xl border border-[#dfd0bf] bg-white p-5" onSubmit={event => { event.preventDefault(); void mutate({ action: 'draft', input: { appointmentId, payerId } }, 'Brouillon fictif préparé. Relisez-le avant la validation manuelle.') }}>
      <h3 className="font-semibold text-[#332820]"><FileText aria-hidden="true" className="mr-2 inline size-4" />Préparer le brouillon du lendemain</h3><p className="text-sm text-[#77695e]">Une rencontre doit être indiquée comme effectuée. Le brouillon devient disponible le lendemain de sa fin, à Montréal. Cette maquette ne lance aucun traitement automatique.</p>
      <div className="grid gap-3 lg:grid-cols-2"><label className="space-y-1 text-sm">Rencontre admissible<select className={field} value={appointmentId} required onChange={event => { const value = current.eligibleAppointments.find(item => item.id === event.target.value); setAppointmentId(event.target.value); setPayerId(current.clients.find(client => client.id === value?.clientId)?.payers[0]?.id ?? '') }}><option value="">Choisir une rencontre</option>{current.eligibleAppointments.map(value => <option key={value.id} value={value.id}>{value.clientName} — {date(value.startAt)} — {value.professionalName}</option>)}</select></label><label className="space-y-1 text-sm">Payeur de ce client<select className={field} value={payerId} required onChange={event => setPayerId(event.target.value)}><option value="">Choisir un payeur rattaché au client</option>{payers.map(value => <option key={value.id} value={value.id}>{value.name} ({value.type === 'parent' ? 'parent' : value.type === 'organization' ? 'organisme' : 'client'})</option>)}</select></label></div>
      {appointment && !payers.length && <p className="text-sm text-amber-900">Ajoutez d’abord un payeur dans la fiche administrative de ce client.</p>}
      {!current.eligibleAppointments.length && <p className="text-sm text-[#77695e]">Aucune rencontre admissible sans facture existante.</p>}
      <button className={primary} disabled={pending || !appointmentId || !payerId}>Préparer un brouillon fictif</button>
    </form>
    <div className="space-y-3"><h3 className="font-semibold text-[#332820]">Factures simulées — {sorted.length}</h3>{!sorted.length && <p className="rounded-xl border border-[#dfd0bf] bg-white p-5 text-sm text-[#77695e]">Aucun brouillon préparé pour le moment.</p>}{sorted.slice(page * 10, (page + 1) * 10).map(invoice => <article key={invoice.id} className="space-y-3 rounded-xl border border-[#dfd0bf] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-[#332820]">{invoice.number ?? 'Brouillon sans numéro'} — {invoice.clientName}</h4><p className="mt-1 text-sm text-[#77695e]">Service du {invoice.serviceDate} · {invoice.durationMinutes} min · {invoice.professionalName}</p><p className="text-sm text-[#77695e]">Payeur : {invoice.payer.name}</p></div><div className="text-right"><p className="text-xl font-semibold text-[#332820]">{money(invoice.totalCents)}</p><p className="text-xs text-[#77695e]">{invoice.status === 'draft' ? 'À vérifier' : 'Validée en simulation'} · version {invoice.version}</p></div></div><details className="text-sm"><summary className="cursor-pointer text-[#8a5633]">Voir l’instantané et le registre</summary><div className="mt-3 space-y-2 rounded-lg bg-[#faf6ef] p-3"><p className="font-semibold">SIMULATION — aucune valeur fiscale</p><p>Client : {invoice.clientName} · Payeur : {invoice.payer.name} · {invoice.payer.email || 'Courriel non indiqué'}</p><p>Consultation du {date(invoice.appointmentStart)} · {invoice.durationMinutes} minutes au tarif historique de {money(invoice.hourlyClientCents)} / h.</p><p>Total figé : {money(invoice.totalCents)}. Taxes et mentions légales à définir avant toute facturation réelle.</p>{invoice.status === 'validated' && <p>Paiements : {money(invoice.balance.paidCents)} · Avoirs : {money(invoice.balance.creditedCents)} · Remboursements : {money(invoice.balance.refundedCents)} · À recevoir : {money(invoice.balance.dueCents)} · Trop-perçu : {money(invoice.balance.refundableCents)}.</p>}<ul className="space-y-1">{invoice.ledger.map(value => <li key={value.id}>{date(value.at)} — {ledgerLabels[value.kind]} : {money(value.amountCents)} · {reasonLabels[value.reason]}</li>)}</ul><p className="text-xs text-[#77695e]">Les écritures du registre sont conservées. Une correction se fait par une nouvelle écriture.</p></div></details>{invoice.status === 'draft' && (confirmation === invoice.id ? <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>J’ai vérifié le client, le payeur, la rencontre et le montant. Valider attribue un numéro de simulation et conserve le montant historique.</p><div className="flex flex-wrap gap-2"><button className={primary} disabled={pending} onClick={() => void mutate({ action: 'validate', invoiceId: invoice.id, input: { expectedVersion: invoice.version, confirmed: true } }, 'Facture validée en simulation. Aucun envoi effectué.')}><Check aria-hidden="true" className="mr-1 inline size-4" />Je confirme la validation fictive</button><button className={button} disabled={pending} onClick={() => setConfirmation(null)}>Revenir</button></div></div> : <button className={button} disabled={pending} onClick={() => setConfirmation(invoice.id)}>Vérifier puis valider le brouillon</button>)}</article>)}{pageCount > 1 && <div className="flex items-center justify-end gap-3 text-sm"><button className={button} disabled={!page} onClick={() => setPage(value => value - 1)}>Précédent</button><span>Page {page + 1} sur {pageCount}</span><button className={button} disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Suivant</button></div>}</div>
    <form className="space-y-4 rounded-xl border border-[#dfd0bf] bg-white p-5" onSubmit={event => { event.preventDefault(); try { if (!selectedInvoice) throw new Error('Choisissez une facture validée.'); const intent = { actorId, invoiceId: selectedInvoice.id, expectedVersion: selectedInvoice.version, kind: visibleKind, amountCents: parseCents(amount), reason }; void mutate({ action: 'ledger', invoiceId: selectedInvoice.id, input: { expectedVersion: intent.expectedVersion, kind: intent.kind, amountCents: intent.amountCents, reason: intent.reason, requestKey: intentTracker.keyFor(intent) } }, `${ledgerLabels[visibleKind]} ajouté au registre fictif.`, () => intentTracker.acknowledge(intent)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Montant invalide.') } }}>
      <h3 className="font-semibold text-[#332820]"><CreditCard aria-hidden="true" className="mr-2 inline size-4" />Simuler un règlement{canAdmin(current.actor) ? ' ou un ajustement' : ''}</h3><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1 text-sm">Facture validée<select className={field} value={invoiceId} required onChange={event => setInvoiceId(event.target.value)}><option value="">Choisir une facture</option>{validated.map(value => <option key={value.id} value={value.id}>{value.number} — {value.clientName}</option>)}</select></label><label className="space-y-1 text-sm">Opération<select className={field} value={visibleKind} onChange={event => setKind(event.target.value as BillingLedgerKind)}>{Object.entries(ledgerLabels).filter(([value]) => canAdmin(current.actor) || value === 'payment').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1 text-sm">Montant en CAD<input className={field} inputMode="decimal" value={amount} required onChange={event => setAmount(event.target.value)} /></label><label className="space-y-1 text-sm">Motif<select className={field} value={reason} onChange={event => setReason(event.target.value as BillingLedgerReason)}>{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><p className="text-sm text-[#77695e]">Maximum actuellement autorisé : {money(operationLimit)}. Un remboursement exige d’abord un avoir créant un trop-perçu. Les ajustements exigent la même confirmation administrative pour la direction et les adjoints. Les honoraires professionnels estimés restent à confirmer séparément.</p><button className={primary} disabled={pending || !selectedInvoice || operationLimit <= 0}>Ajouter une écriture fictive</button>
    </form>
    <details className="rounded-xl border border-[#dfd0bf] bg-white p-5 text-sm"><summary className="cursor-pointer font-semibold text-[#332820]">Tarifs historisés {canAdmin(current.actor) ? '— administration' : '— consultation'}</summary><ul className="my-3 space-y-1">{[...current.rates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map(value => <li key={value.id}>À partir du {value.effectiveFrom} : {money(value.hourlyClientCents)} / h.</li>)}</ul>{canAdmin(current.actor) && <form className="grid items-end gap-3 md:grid-cols-3" onSubmit={event => { event.preventDefault(); try { void mutate({ action: 'rate', input: { effectiveFrom, hourlyClientCents: parseCents(rate) } }, 'Nouveau tarif fictif historisé. Les montants déjà préparés sont conservés.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tarif invalide.') } }}><label className="space-y-1">Entrée en vigueur<input className={field} type="date" value={effectiveFrom} required onChange={event => setEffectiveFrom(event.target.value)} /></label><label className="space-y-1">Tarif client en CAD / h<input className={field} inputMode="decimal" value={rate} required onChange={event => setRate(event.target.value)} /></label><button className={button} disabled={pending}>Ajouter ce tarif fictif</button></form>}</details>
  </section>
}
export default BillingPanel
