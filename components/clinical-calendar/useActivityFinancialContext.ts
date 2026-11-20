'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CalendarFinancialContext, DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { loadCalendarFinancialContext } from '@/lib/clinical-calendar/durableClient'
import { validCalendarDate, localDateTime } from '@/lib/clinical-calendar/time'
import { isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { initialActivityFinancialDraft, type ActivityFinancialDraft } from './activityForm'
import type { CalendarUi } from './primitives'

type FinancialState = { key: string; context: CalendarFinancialContext | null; draft: ActivityFinancialDraft; touched: boolean; needsReview: boolean; loading: boolean; error: string }
export function useActivityFinancialContext(ui: CalendarUi, episodeId: string, professionalId: string, day: string, editing?: DurableCalendarEvent) {
  const actor = useMemo(() => ({ actorId: ui.data.actorId, context: ui.data.context }), [ui.data.actorId, ui.data.context])
  const key = [episodeId, professionalId, day].join(':'), invalidate = ui.invalidate
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<FinancialState>(() => ({ key: '', context: null, draft: initialActivityFinancialDraft(null), touched: false, needsReview: false, loading: false, error: '' }))
  useEffect(() => {
    const controller = new AbortController()
    const begin = (previous: FinancialState, loading: boolean): FinancialState => {
      if (previous.key === key) return { ...previous, loading, error: '' }
      const preserve = previous.touched || Boolean(previous.context?.financialOptions && (previous.context.financialOptions.reason || previous.context.financialOptions.hourlyOverrideCents !== null))
      return { key, context: null, draft: preserve ? previous.draft : initialActivityFinancialDraft(null), touched: preserve, needsReview: preserve, loading, error: '' }
    }
    if (!episodeId || !professionalId || !validCalendarDate(day)) {
      setState(previous => begin(previous, false))
      return () => controller.abort()
    }
    const receive = (context: CalendarFinancialContext) => setState(previous => {
      const next = begin(previous, false)
      return { ...next, context, draft: next.touched ? next.draft : initialActivityFinancialDraft(context.financialOptions), loading: false, error: '' }
    })
    if (!revision && editing && episodeId === editing.episodeId && professionalId === editing.professionalId && day === localDateTime(editing.startAt).slice(0, 10)) {
      receive({ episodeId, professionalId, serviceDate: day, billable: editing.billable, financialOptions: editing.financialOptions, absenceDecision: editing.absenceDecision })
      return () => controller.abort()
    }
    setState(previous => begin(previous, true))
    void loadCalendarFinancialContext(episodeId, professionalId, day, actor, controller.signal).then(context => { if (!controller.signal.aborted) receive(context) }).catch(cause => {
      if (controller.signal.aborted) return
      if (isClinicalAccessDenied(cause)) invalidate?.(cause)
      setState(previous => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : 'Les conditions de cette activité ne sont pas disponibles.' }))
    })
    return () => controller.abort()
  }, [actor, day, editing, episodeId, professionalId, key, revision, invalidate])
  const current = state.key === key
  const pendingReview = state.needsReview || (!current && (state.touched || Boolean(state.context?.financialOptions && (state.context.financialOptions.reason || state.context.financialOptions.hourlyOverrideCents !== null))))
  const reset = () => setState(previous => ({ ...previous, draft: initialActivityFinancialDraft(previous.context?.financialOptions ?? null), touched: false, needsReview: false }))
  const keep = () => setState(previous => ({ ...previous, draft: { ...previous.draft, acceptConditions: false, attested: false, evidenceId: '', conditionsReason: '' }, touched: true, needsReview: false }))
  return { context: current ? state.context : null, draft: current || pendingReview ? state.draft : initialActivityFinancialDraft(null), touched: state.touched,
    needsReview: pendingReview, reset, keep,
    canKeep: current && Boolean(state.context?.financialOptions && state.context.financialOptions.payers.every(payer => Object.hasOwn(state.draft.shares, payer.personId))),
    loading: Boolean(episodeId && professionalId) && (!current || state.loading), error: current ? state.error : '',
    change: (draft: ActivityFinancialDraft) => setState(previous => ({ ...previous, key, draft, touched: true })),
    reload: () => setRevision(value => value + 1) }
}
