'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { loadMandates, runMandateCommand } from '@/lib/clinical-mandates/client'
import type { MandateCommand, MandateWorkspace } from '@/lib/clinical-mandates/types'
import { MandateConfiguration } from '@/components/clinical-mandates/MandateConfiguration'
import { AutomaticBillingSettings, BillingReminderSettings } from '@/components/clinical-billing/AutomaticBillingSettings'
import { loadBilling, runBillingCommand } from '@/lib/clinical-finance/durableClient'
import type { DurableBillingCommand, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import { OfficeDirectory } from './OfficeDirectory'
import { InvoiceEmailSettings } from './InvoiceEmailSettings'
import { clinicalCard } from './styles'
import { useClinicalNavigation } from './NavigationGuard'

export function ClinicSettingsPanel({ workspace, onNavigate }: { workspace: WorkspaceView; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void> }) {
  const navigation = useClinicalNavigation()
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const [tab, setTab] = useState<'services' | 'offices' | 'billing' | 'emails'>('services')
  const [data, setData] = useState<MandateWorkspace | null>(null)
  const [billing, setBilling] = useState<DurableBillingWorkspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const next = await loadMandates(actor, {}, signal); if (!signal?.aborted) { setData(next); setError('') } }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Paramètres indisponibles.') }
  }, [actor])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  const loadBillingSettings = useCallback(async (signal?: AbortSignal) => {
    try { const next = await loadBilling(actor, {}, signal); if (!signal?.aborted) { setBilling(next); setError('') } }
    catch (cause) { if (!signal?.aborted) { setBilling(null); setError(cause instanceof Error ? cause.message : 'Paramètres de facturation indisponibles.') } }
  }, [actor])
  useEffect(() => { if (tab !== 'billing') return; const controller = new AbortController(); void loadBillingSettings(controller.signal); return () => controller.abort() }, [tab, loadBillingSettings])
  const command = async (input: MandateCommand) => {
    setBusy(true)
    try { const result = await runMandateCommand(actor, input); await load(); return result }
    finally { setBusy(false) }
  }
  const billingCommand = async (input: DurableBillingCommand) => {
    setBusy(true)
    try { const result = await runBillingCommand(actor, input); await loadBillingSettings(); return result }
    finally { setBusy(false) }
  }
  if (workspace.context !== 'administration') return null
  return <div className="grid gap-4"><section className={clinicalCard}><h2 className="text-xl font-semibold">Paramètres de la clinique</h2><p className="mt-2 text-sm text-[#765b47]">Choisissez un domaine à configurer. Les gabarits de service alimentent les nouveaux mandats selon le titre du professionnel.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([['services', 'Services individuels', 'Gabarits de convention, tarifs et règles de signature'], ['offices', 'Bureaux partagés', 'Bureaux et disponibilité'], ['billing', 'Facturation', 'Rappels et préparation des factures'], ['emails', 'Courriels', 'Modèle et aperçu des factures']] as const).map(([id, label, description]) => <button key={id} type="button" aria-pressed={tab === id} className={`${buttonClass(tab === id ? 'primary' : 'secondary')} min-h-24 text-left`} onClick={() => void navigation.canLeave().then(allowed => { if (allowed) setTab(id) })}><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs">{description}</span></button>)}</div></section>
    {tab === 'services' && <section className={clinicalCard}><h3 className="mb-4 text-lg font-semibold">Services individuels et conventions</h3>{error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}{data ? <MandateConfiguration ui={{ data, busy, command, select: async () => {}, invalidate: () => setData(null) }} /> : !error && <p role="status">Chargement des paramètres…</p>}</section>}
    {tab === 'emails' && <InvoiceEmailSettings actor={actor} />}
    {tab === 'offices' && <OfficeDirectory workspace={workspace} onNavigate={onNavigate} />}
    {tab === 'billing' && <><BillingReminderSettings actor={actor} />{error && <p role="alert" className="text-sm text-red-800">{error}</p>}{billing ? <AutomaticBillingSettings data={billing} busy={busy} run={billingCommand} /> : !error && <p role="status">Chargement des paramètres de facturation…</p>}</>}
  </div>
}
