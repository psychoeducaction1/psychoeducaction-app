'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'

import { createClinicalFormState } from '@/lib/clinical-workspace/navigation'

type Guard = () => Promise<boolean>
type GuardEntry = { guard: Guard; kind: 'note' | 'form' }
type NavigationGuard = { register: (guard: Guard, kind?: GuardEntry['kind']) => () => void; canLeave: (options?: { ignoreForms: boolean }) => Promise<boolean> }
const Context = createContext<NavigationGuard | null>(null)

export function ClinicalNavigationGuard({ children }: { children: ReactNode }) {
  const guards = useRef(new Set<GuardEntry>())
  const context = useMemo<NavigationGuard>(() => ({
    register(guard, kind = 'note') { const entry = { guard, kind }; guards.current.add(entry); return () => { guards.current.delete(entry) } },
    async canLeave(options) { for (const entry of guards.current) if (!(options?.ignoreForms && entry.kind === 'form') && !await entry.guard()) return false; return true },
  }), [])
  return <Context.Provider value={context}>{children}</Context.Provider>
}

export function useClinicalNavigation() {
  const navigation = useContext(Context)
  if (!navigation) throw new Error('La protection de navigation clinique doit être présente.')
  return navigation
}

export function useClinicalFormGuard(dirty: boolean, pending: boolean) {
  const navigation = useClinicalNavigation()
  const state = useRef(createClinicalFormState(dirty, pending))
  useLayoutEffect(() => { state.current.sync(dirty, pending) }, [dirty, pending])
  useEffect(() => navigation.register(async () => state.current.canLeave(() => window.confirm('Ce formulaire contient des modifications non enregistrées. Quitter sans les enregistrer ?')), 'form'), [navigation])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.current.hasUnsaved()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  return useMemo(() => ({
    markPending() { state.current.markPending() },
    markSettled() { state.current.markSettled() },
    markSaved() { state.current.markSaved() },
  }), [])
}

/** Keep the rendered form until Back/Forward has passed its current guards. */
export function useClinicalHistory() {
  const navigation = useClinicalNavigation()
  const committed = useRef<{ href: string; state: unknown }>({ href: '', state: null })
  const pending = useRef(false)
  const remember = useCallback(() => { committed.current = { href: `${window.location.pathname}${window.location.search}`, state: window.history.state } }, [])
  const write = useCallback((href: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', href)
    else window.history.pushState(null, '', href)
    remember()
  }, [remember])
  useEffect(() => {
    remember()
    const handle = (event: PopStateEvent) => {
      event.stopImmediatePropagation()
      const destination = { href: `${window.location.pathname}${window.location.search}`, state: event.state }
      const origin = committed.current
      if (pending.current) { window.history.replaceState(origin.state, '', origin.href); return }
      pending.current = true
      void navigation.canLeave().then(allowed => {
        if (!allowed) { window.history.pushState(origin.state, '', origin.href); return }
        if (!/^\/(?:administration|clinique)(?:\/|\?|$)/.test(destination.href)) { window.location.assign(destination.href); return }
        // Next ignores its own marked history state; null invokes its URL sync.
        window.history.replaceState(null, '', destination.href)
        remember()
      }).catch(() => { window.history.pushState(origin.state, '', origin.href) }).finally(() => { pending.current = false })
    }
    // Next's normal popstate listener is a bubbling listener. Capture prevents
    // it from replacing a dirty editor before the asynchronous save completes.
    window.addEventListener('popstate', handle, true)
    return () => window.removeEventListener('popstate', handle, true)
  }, [navigation, remember])
  return write
}
