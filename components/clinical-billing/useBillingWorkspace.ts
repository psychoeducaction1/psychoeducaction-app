'use client'
import { isDurableBillingAck } from '@/lib/clinical-finance/transport'
import { financialErrors } from '@/lib/clinical-finance/errors'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { DurableBillingAck, DurableBillingCommand, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import type { FeeAck, FeeCommand, FeeWorkspace } from '@/lib/clinical-finance/feeTypes'
import { loadBilling, loadFees, runBillingCommand, runFeeCommand } from '@/lib/clinical-finance/durableClient'
import { isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { workspaceHref } from '@/lib/clinical-workspace/navigation'
import { useClinicalFormGuard, useClinicalNavigation } from '@/components/clinical-workspace/NavigationGuard'
import { acknowledgeAndRefresh, billingFiltersFromQuery, billingMatchesRequest } from './model'
import type { BillingUi } from './InvoiceDetail'

export { billingFiltersFromQuery } from './model'
export function useBillingWorkspace(actorId: string, context: ClinicalAccessContext) {
  const params = useSearchParams(), router = useRouter(), navigation = useClinicalNavigation()
  const query = useMemo(() => new URLSearchParams(params.toString()), [params]), actor = useMemo(() => ({ actorId, context }), [actorId, context])
  const tab = context === 'clinical' ? 'fees' : query.get('billingTab') === 'fees' ? 'fees' : 'invoices'
  const filters = useMemo(() => billingFiltersFromQuery(query), [query])
  const [billing, setBilling] = useState<DurableBillingWorkspace | null>(null), [fees, setFees] = useState<FeeWorkspace | null>(null)
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const operation = useRef(false), sequence = useRef(0), guard = useClinicalFormGuard(false, pending)
  const clear = useCallback(() => { setBilling(null); setFees(null) }, [])
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current
    setLoading(true)
    try {
      if (tab === 'fees') {
        const next = await loadFees(actor, signal)
        if (signal?.aborted || sequence.current !== request) return false
        setFees(next); setBilling(null)
      } else {
        const next = await loadBilling(actor, filters, signal)
        if (signal?.aborted || sequence.current !== request) return false
        setBilling(next); setFees(null)
      }
      setError(''); setStale(false); return true
    } catch (cause) {
      if (!signal?.aborted && sequence.current === request) { if (isClinicalAccessDenied(cause)) clear(); setError(cause instanceof Error ? cause.message : 'Projection financière indisponible.'); setStale(true) }
      return false
    } finally { if (!signal?.aborted && sequence.current === request) setLoading(false) }
  }, [actor, clear, filters, tab])
  useEffect(() => { clear(); setMessage(''); const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [clear, load])
  const perform = useCallback(async <A,>(write: () => Promise<A>): Promise<A> => {
    if (operation.current) throw new Error('Une opération est déjà en cours. Attendez sa confirmation.')
    operation.current = true; guard.markPending(); setPending(true); setMessage(''); setError('')
    try {
      const { ack, refreshed } = await acknowledgeAndRefresh(write, () => load(), result => {
        if (isDurableBillingAck(result, 'batch.prepare') && result.preparation) {
          const p = result.preparation
          const reasons = [...new Set(p.blockedCases.map(item => financialErrors[item.code] ?? 'Vérifiez les frais d’ouverture et les conditions financières du dossier.'))]
          setMessage(`${p.reconciledAppointments} rencontre(s) préparée(s). ${p.blockedCases.length} dossier(s) à vérifier. ${reasons.join(' ')} Aucun courriel envoyé.`)
        } else setMessage('Opération enregistrée. Aucun mouvement bancaire ni courriel.')
      })
      if (!refreshed) setMessage('Écriture confirmée. L’actualisation est indisponible : ne réémettez pas cette opération ; utilisez Actualiser.')
      return ack
    } catch (cause) { if (isClinicalAccessDenied(cause)) clear(); throw cause }
    finally { operation.current = false; guard.markSettled(); setPending(false) }
  }, [clear, guard, load])
  const run = useCallback((command: DurableBillingCommand): Promise<DurableBillingAck> => perform(() => runBillingCommand(actor, command)), [actor, perform])
  const feeRun = useCallback((command: FeeCommand): Promise<FeeAck> => perform(() => runFeeCommand(actor, command)), [actor, perform])
  const select = async (patch: Record<string, string | null>) => {
    if (!await navigation.canLeave()) return
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(patch)) if (value === null) next.delete(key); else next.set(key, value)
    router.push(workspaceHref(context, 'billing', Object.fromEntries(next)))
  }
  const openModule: BillingUi['openModule'] = async (module, values) => { if (await navigation.canLeave()) router.push(workspaceHref(context, module, values)) }
  const active = billing?.actor.id === actorId && billing.context === context && billingMatchesRequest(billing, filters) ? billing : null
  const activeFees = fees?.actorId === actorId && fees.context === context ? fees : null
  const busy = pending || loading || stale
  const ui: BillingUi | null = active ? { data: active, busy, run, select, openModule, refresh: async () => { await load() } } : null
  const refresh = async () => { if (await navigation.canLeave()) await load() }
  return { query, tab, active, activeFees, loading, pending, busy, stale, error, message, ui, feeRun, select, openModule, refresh }
}

