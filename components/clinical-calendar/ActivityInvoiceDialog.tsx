'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { InvoiceDetail, type BillingUi } from '@/components/clinical-billing/InvoiceDetail'
import { blockReasonLabel, dateLabel, money } from '@/components/clinical-billing/model'
import { loadBilling, runBillingCommand } from '@/lib/clinical-finance/durableClient'
import type { DurableBillingAck, DurableBillingCommand, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import { isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'

type Actor = { actorId: string; context: 'administration' }
export function ActivityInvoiceDialog({ actorId, clientId, activityId, endAt, onClose, onNavigate, onAccessDenied }: { actorId: string; clientId: string; activityId?: string; endAt?: string; onClose: () => void; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>; onAccessDenied: (cause: unknown) => void }) {
  const actor = useMemo<Actor>(() => ({ actorId, context: 'administration' }), [actorId])
  const [data, setData] = useState<DurableBillingWorkspace | null>(null)
  const [invoiceId, setInvoiceId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fail = useCallback((cause: unknown, fallback: string) => {
    if (isClinicalAccessDenied(cause)) { setData(null); onAccessDenied(cause); return }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [onAccessDenied])
  const load = useCallback(async (selectedId?: string, signal?: AbortSignal) => {
    const next = await loadBilling(actor, { clientId, activityId, invoiceId: selectedId, status: 'all', pageSize: 50 }, signal)
    if (!signal?.aborted) { setData(next); setError('') }
    return next
  }, [actor, clientId, activityId])
  useEffect(() => { if (!activityId) return; const controller = new AbortController(); void load(undefined, controller.signal).catch(cause => { if (!controller.signal.aborted) fail(cause, 'Facturation indisponible.') }); return () => controller.abort() }, [load, activityId, fail])
  const select = async (id?: string) => { setBusy(true); try { await load(id); setInvoiceId(id) } catch (cause) { fail(cause, 'Facture indisponible.') } finally { setBusy(false) } }
  const run = async (command: DurableBillingCommand): Promise<DurableBillingAck> => {
    setBusy(true); setError(''); setMessage('')
    try { const ack = await runBillingCommand(actor, command); setMessage(clinicalUiText("Écriture confirmée dans le laboratoire local. Aucun courriel ni paiement réel.","Enregistrement confirmé. Aucun courriel envoyé ni paiement déclenché.")); try { await load(invoiceId) } catch (cause) { fail(cause, 'Écriture confirmée, mais la relecture a échoué. Actualisez avant une autre opération.') }; return ack }
    catch (cause) { if (isClinicalAccessDenied(cause)) fail(cause, 'Facturation indisponible.'); throw cause }
    finally { setBusy(false) }
  }
  const ui: BillingUi | null = data ? { data, busy, run, select: async patch => { await select(patch.invoiceId ?? undefined) }, openModule: async (section, query) => { onClose(); await onNavigate(section, query) }, refresh: async () => { await load(invoiceId) } } : null
  const blockedReason = data?.eligibleActivities.find(activity => activity.id === activityId)?.blockedReason
  return <ProspectDialog compactHeader title="Facturation de l’activité" onClose={onClose}>
    {!activityId && <p>{endAt && Date.parse(endAt)>Date.now() ? 'La rencontre est à venir. Sa facture apparaîtra dans la liste après la fin du créneau.' : 'La rencontre est passée. Actualisez l’agenda pour voir la facture préparée, ou vérifiez le mandat si elle reste absente.'}</p>}
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">{message}</p>}
    {activityId && !data && !error && <p>Chargement des factures…</p>}
    {data && !invoiceId && <div className="grid gap-3">{data.invoices.map(invoice => <button key={invoice.id} className={buttonClass('secondary') + ' justify-between text-left'} disabled={busy} onClick={() => void select(invoice.id)}><span>{invoice.number ?? 'Facture à envoyer'} · {invoice.payerName}<br /><small>{dateLabel(invoice.serviceDate)}</small></span><strong>{money(invoice.dueCents)}</strong></button>)}{!data.invoices.length && <p>{blockedReason ? blockReasonLabel(blockedReason) : 'Aucune facture n’est encore préparée pour cette activité.'}</p>}</div>}
    {data && !invoiceId && !data.invoices.length && <button type="button" className={buttonClass('secondary') + ' mt-3'} disabled={busy} onClick={async () => { onClose(); await onNavigate('billing', { client: clientId, activity: activityId ?? null, status: 'all', invoiceId: null }) }}>Ouvrir la facturation et les vérifications</button>}
    {ui && invoiceId && <div className="grid gap-3"><button className={buttonClass('ghost')} disabled={busy} onClick={() => void select()}>← Toutes les factures de l’activité</button><InvoiceDetail key={invoiceId + ':' + (data?.selected?.invoice.version ?? 0)} ui={ui} /></div>}
  </ProspectDialog>
}

