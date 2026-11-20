'use client'
import { useEffect, useState } from 'react'
import { CircleDollarSign, FileText, LockKeyhole, Send, Sheet } from 'lucide-react'
import { Badge, buttonClass } from '@/components/Ui'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { DurableBillingFilter, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import { billingDocumentDownloadUrl, loadBilling } from '@/lib/clinical-finance/durableClient'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { Field, clinicalCard, inputClass, read } from './primitives'
import { InvoiceDetail, type BillingUi } from './InvoiceDetail'
import { FeesPanel } from './FeesPanel'
import { PreparationPanel } from './PreparationPanel'
import { invoiceStatusLabels, money } from './model'
import { useBillingWorkspace } from './useBillingWorkspace'

function spreadsheetText(value: string) {
  return /^[\s]*[=+@-]/.test(value) ? "'" + value : value
}
function invoiceDay(value: string) {
  return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' }).format(new Date(value))
}
function invoiceDayIso(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Toronto' }).formatToParts(new Date(value))
  const get = (part: string) => parts.find(value => value.type === part)?.value ?? ''
  return get('year') + '-' + get('month') + '-' + get('day')
}

export function ClinicalBillingWorkspace({ actorId, context }: { actorId: string; context: ClinicalAccessContext }) {
  const state = useBillingWorkspace(actorId, context)
  const realApplication = process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE === 'true'
  return <div className="grid min-w-0 gap-5">
    {(context === 'administration' || !realApplication) && <section className={clinicalCard}>{!realApplication && <p className="text-sm text-amber-950">Simulation locale : aucun paiement bancaire ni courriel réel. Les documents ne sont pas validés pour un usage fiscal.</p>}
      {context === 'administration' && <nav className="mt-4 flex flex-wrap gap-2" aria-label="Sections financières">{[['invoices', 'Factures'], ['fees', 'Honoraires']].map(([key, label]) => <button key={key} className={buttonClass(state.tab === key ? 'primary' : 'secondary')} aria-current={state.tab === key ? 'page' : undefined} onClick={() => void state.select({ billingTab: key, invoiceId: null, statement: null })}>{label}</button>)}</nav>}
    </section>}
    {state.message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-950">{state.message}</p>}
    {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{state.error}{state.stale && ' Les écritures restent bloquées jusqu’à une actualisation réussie.'}</p>}
    {state.loading && <p role="status" className="text-sm">Chargement des informations autorisées…</p>}
    {state.tab === 'fees' ? state.activeFees && <FeesPanel workspace={state.activeFees} busy={state.busy} run={state.feeRun} select={state.select} query={state.query} /> : state.active && state.ui && <InvoiceWorkspace data={state.active} ui={state.ui} action={state.query.get('billingAction')} />}
  </div>
}

export function InvoiceWorkspace({ data, ui, action = null }: { data: DurableBillingWorkspace; ui: BillingUi; action?: string | null }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(true)
  const scopedClient = data.selected?.invoice.clientName ?? data.invoices[0]?.clientName ?? data.eligibleActivities[0]?.clientName ?? data.openingCandidates[0]?.clientName
  useEffect(() => {
    if (!data.selected || !action) return
    const timer = window.setTimeout(() => document.getElementById('invoice-action-' + action)?.scrollIntoView({ block: 'center' }), 100)
    return () => window.clearTimeout(timer)
  }, [data.selected, action])
  const selectInvoice = (id: string, nextAction: 'payment' | 'send' | 'close' | 'view') => void ui.select({ invoiceId: id, billingAction: nextAction })
  const resetFilters = () => void ui.select({ search: null, status: 'unpaid', professional: null, clientName: null, invoiceNumber: null, clientNumber: null, dateFrom: null, dateTo: null, recurring: null, page: null, invoiceId: null, billingAction: null })
  const exportExcel = async () => {
    if (exporting || data.total === 0) return
    setExporting(true); setExportError('')
    try {
      if (data.total > 10000) throw new Error('L’export est limité à 10 000 factures. Réduisez la période ou les filtres.')
      const filters: DurableBillingFilter = { ...data.filters, pageSize: 50, page: 1 }
      const rows: (string | number)[][] = [['Date de facture', 'No facture', 'Client', 'Professionnel', 'Payeur', 'État', 'Total ($)', 'À payer ($)', 'Dernier paiement', 'Montant du dernier paiement ($)']]
      const invoiceIds = new Set<string>()
      for (let page = 1; page <= Math.ceil(data.total / 50); page++) {
        const result = await loadBilling({ actorId: data.actor.id, context: 'administration' }, { ...filters, page })
        if (result.total !== data.total) throw new Error('La liste a changé durant l’export. Actualisez et réessayez.')
        for (const invoice of result.invoices) {
          if (invoiceIds.has(invoice.id)) throw new Error('La pagination a changé durant l’export. Actualisez et réessayez.')
          invoiceIds.add(invoice.id)
          rows.push([invoiceDayIso(invoice.issuedAt ?? invoice.createdAt), spreadsheetText(invoice.number ?? 'Ouverte'), spreadsheetText(invoice.clientName), spreadsheetText(invoice.professionalName), spreadsheetText(invoice.payerName), invoice.dueCents === 0 ? 'Payée' : invoice.paidCents > invoice.refundedCents ? 'Partiellement payée' : 'À payer', invoice.totalCents / 100, invoice.dueCents / 100, invoice.lastPaymentAt ? invoiceDayIso(invoice.lastPaymentAt) : '', invoice.lastPaymentCents / 100])
        }
      }
      if (invoiceIds.size !== data.total) throw new Error('L’export ne contient pas toutes les factures filtrées. Actualisez et réessayez.')
      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Factures')
      const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url; link.download = process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE === 'true' ? 'factures.xlsx' : 'factures-laboratoire.xlsx'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : 'Export indisponible.') }
    finally { setExporting(false) }
  }
  return <div className="grid min-w-0 gap-4">
    {(data.filters.clientId || data.filters.activityId) && <section className={clinicalCard}><h2 className="font-semibold">Périmètre sélectionné</h2><div className="mt-3 flex flex-wrap items-center gap-3">
      {data.filters.clientId && <span className="rounded-xl bg-[#f8eee1] p-3 text-sm">Client : {scopedClient ?? 'Dossier sélectionné'}</span>}
      {data.filters.activityId && <span className="rounded-xl bg-[#f8eee1] p-3 text-sm">Activité sélectionnée</span>}
      <button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => void ui.select({ client: null, activity: null, invoiceId: null, page: null })}>Afficher tous les dossiers</button>
    </div></section>}
    <PreparationPanel ui={ui} />
    <section className={clinicalCard}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileText size={19} />Liste des factures</h2><p className="text-sm text-[#8a6f5d]">{data.total} facture{data.total > 1 ? 's' : ''} selon les filtres.</p></div><button type="button" className={buttonClass('secondary')} onClick={() => void exportExcel()} disabled={ui.busy || exporting || data.total === 0} title="Exporter toutes les factures filtrées"><Sheet size={17} /> {exporting ? 'Export en cours…' : 'Excel'}</button></div>
      {exportError && <p role="alert" className="mt-3 text-sm text-red-700">{exportError}</p>}
      <form key={JSON.stringify(data.filters)} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; void ui.select({ search: read(form, 'search') || null, status: read(form, 'status'), professional: read(form, 'professional') || null, clientName: read(form, 'clientName') || null, invoiceNumber: read(form, 'invoiceNumber') || null, clientNumber: read(form, 'clientNumber') || null, dateFrom: read(form, 'dateFrom') || null, dateTo: read(form, 'dateTo') || null, recurring: read(form, 'recurring'), page: null, invoiceId: null, billingAction: null }) }}>
        <Field label="Date de facture — du"><input name="dateFrom" type="date" className={inputClass} defaultValue={data.filters.dateFrom ?? ''} /></Field>
        <Field label="Au"><input name="dateTo" type="date" className={inputClass} defaultValue={data.filters.dateTo ?? ''} /></Field>
        <Field label="Professionnel"><input name="professional" className={inputClass} maxLength={120} defaultValue={data.filters.professional} /></Field>
        <Field label="Client"><input name="clientName" className={inputClass} maxLength={120} defaultValue={data.filters.clientName} /></Field>
        <Field label="Paiement"><select name="status" className={inputClass} defaultValue={data.filters.status}>{Object.entries(invoiceStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Rencontres récurrentes"><select name="recurring" className={inputClass} defaultValue={data.filters.recurring}><option value="all">Toutes</option><option value="yes">Oui</option><option value="no">Non</option></select></Field>
        <Field label="No de facture"><input name="invoiceNumber" className={inputClass} maxLength={80} defaultValue={data.filters.invoiceNumber} /></Field>
        <Field label="No de client"><input name="clientNumber" className={inputClass} maxLength={20} defaultValue={data.filters.clientNumber} /></Field>
        <Field label="Recherche générale"><input name="search" type="search" className={inputClass} maxLength={120} defaultValue={data.filters.search} /></Field>
        <Field label="Factures par page"><select name="pageSize" className={inputClass} defaultValue={data.filters.pageSize} onChange={event => void ui.select({ pageSize: event.target.value, page: null })}>{[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}</select></Field>
        <div className="flex flex-wrap items-end gap-2"><button type="submit" className={buttonClass('primary')} disabled={ui.busy}>Filtrer</button><button type="button" className={buttonClass('secondary')} disabled={ui.busy} onClick={resetFilters}>Réinitialiser</button></div>
      </form>
      <details className="mt-5 rounded-xl border border-[#eadfd2] p-3" open={summaryOpen} onToggle={event => setSummaryOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Sommaire des factures filtrées</summary><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p>Total : <strong>{money(data.summary.totalCents)}</strong></p><p>Payé : <strong>{money(data.summary.paidCents)}</strong></p><p>À payer : <strong>{money(data.summary.dueCents)}</strong></p></div></details>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr className="border-b border-[#d9c5b1] text-[#644d3a]"><th className="p-2">No</th><th className="p-2">Date de facture</th><th className="p-2">Client</th><th className="p-2">Professionnel</th><th className="p-2">Paiement</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">À payer</th><th className="p-2">Dernier paiement</th><th className="p-2 text-right">Montant</th><th className="p-2">Actions</th></tr></thead><tbody>
        {data.invoices.map(invoice => { const pdf = invoice.documents.find(document => document.kind === 'invoice'); return <tr key={invoice.id} className="border-b border-[#eee4d8] hover:bg-[#f8f2e9]"><td className="p-2"><button className="font-semibold underline" onClick={() => selectInvoice(invoice.id, 'view')}>{invoice.number ?? 'Ouverte'}</button></td><td className="p-2 whitespace-nowrap">{invoiceDay(invoice.issuedAt ?? invoice.createdAt)}</td><td className="p-2">{invoice.clientName}<span className="block text-xs text-[#8a6f5d]">Payeur : {invoice.payerName}</span></td><td className="p-2">{invoice.professionalName}</td><td className="p-2"><Badge tone={invoice.dueCents === 0 ? 'success' : invoice.status === 'draft' ? 'warning' : 'neutral'}>{invoice.voidedAt ? 'Annulée' : invoice.dueCents === 0 ? 'Payée' : invoice.paidCents > invoice.refundedCents ? 'Partielle' : 'À payer'}</Badge></td><td className="p-2 text-right whitespace-nowrap">{money(invoice.totalCents)}</td><td className="p-2 text-right whitespace-nowrap">{money(invoice.dueCents)}</td><td className="p-2 whitespace-nowrap">{invoice.lastPaymentAt ? invoiceDay(invoice.lastPaymentAt) : '—'}</td><td className="p-2 text-right whitespace-nowrap">{invoice.lastPaymentAt ? money(invoice.lastPaymentCents) : '—'}</td><td className="p-2"><div className="flex gap-1"><button type="button" className={buttonClass('ghost')} title="Ajouter un paiement" aria-label={'Ajouter un paiement à la facture de ' + invoice.clientName} onClick={() => selectInvoice(invoice.id, 'payment')} disabled={ui.busy || !data.canManagePayments || Boolean(invoice.voidedAt) || invoice.dueCents === 0}><CircleDollarSign size={17} /></button>{pdf || data.mode === 'isolated_unified' ? <a className={buttonClass('ghost')} title="Voir la facture PDF" aria-label={'Voir le PDF de la facture de ' + invoice.clientName} target="_blank" rel="noopener noreferrer" href={data.mode === 'isolated_unified' ? '/api/clinical-workspace/billing/invoices/' + invoice.id + '/pdf?kind=invoice' : billingDocumentDownloadUrl(pdf!.id, 'administration') + '?view=inline'}><FileText size={17} /></a> : <button type="button" className={buttonClass('ghost')} title="Aperçu de la facture ouverte" aria-label={'Aperçu de la facture ouverte de ' + invoice.clientName} onClick={() => selectInvoice(invoice.id, 'view')} disabled={ui.busy}><FileText size={17} /></button>}<button type="button" className={buttonClass('ghost')} title="Envoyer la facture" aria-label={'Envoyer la facture de ' + invoice.clientName} onClick={() => selectInvoice(invoice.id, 'send')} disabled={ui.busy || Boolean(invoice.voidedAt) || !!invoice.sentDemoAt}><Send size={17} /></button><button type="button" className={buttonClass('ghost')} title="Fermer la facture" aria-label={'Fermer la facture de ' + invoice.clientName} onClick={() => selectInvoice(invoice.id, 'close')} disabled={ui.busy || Boolean(invoice.voidedAt) || invoice.status === 'issued'}><LockKeyhole size={17} /></button></div></td></tr> })}
      </tbody></table>{!data.invoices.length && <p className="py-6 text-center text-sm">Aucune facture pour ces filtres.</p>}</div>
      <div className="mt-4 flex items-center justify-between gap-2 text-sm"><button className={buttonClass('ghost')} disabled={ui.busy || data.filters.page <= 1} onClick={() => void ui.select({ page: String(data.filters.page - 1) })}>Précédent</button><span>{data.filters.page} / {Math.max(1, Math.ceil(data.total / data.filters.pageSize))}</span><button className={buttonClass('ghost')} disabled={ui.busy || data.filters.page * data.filters.pageSize >= data.total} onClick={() => void ui.select({ page: String(data.filters.page + 1) })}>Suivant</button></div>
    </section>
    {data.selected && <ProspectDialog compactHeader title={'Facture ' + (data.selected.invoice.number ?? 'ouverte')} onClose={() => void ui.select({ invoiceId: null, billingAction: null })}><InvoiceDetail key={data.selected.invoice.id + ':' + data.selected.invoice.version} ui={ui} /></ProspectDialog>}
  </div>
}
