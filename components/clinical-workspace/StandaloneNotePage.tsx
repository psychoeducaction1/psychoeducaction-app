'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FixtureActor, WorkspaceView } from '@/lib/clinical-core/types'
import { CLINICAL_NOTE_TEMPLATES } from '@/lib/clinicalNoteTemplates'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { safeWorkspaceReturn } from '@/lib/clinical-workspace/navigation'
import { isDurableIdentity } from '@/lib/clinical-workspace/workspaceIdentity'
import { isUnifiedClinicalClient, loadUnifiedIdentity, UnifiedSessionError } from '@/lib/clinical-unification/authClient'
import { AppointmentNotePage } from './AppointmentNotePage'
import { ClinicalNavigationGuard, useClinicalHistory } from './NavigationGuard'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const noteTypes = CLINICAL_NOTE_TEMPLATES.map(type => ({
  id: type.id, label: type.label,
  sections: CLINICAL_NOTE_BLUEPRINTS[type.id].map(section => ({ id: section.id, title: section.title })),
}))

export function StandaloneNotePage() {
  return <Suspense fallback={<p role="status" className="p-8">Ouverture de la note…</p>}>
    <ClinicalNavigationGuard><NoteScreen /></ClinicalNavigationGuard>
  </Suspense>
}

function NoteScreen() {
  const router = useRouter()
  const params = useSearchParams()
  useClinicalHistory()
  const [identity, setIdentity] = useState<{ actor: FixtureActor; actors: FixtureActor[]; mode: WorkspaceView['mode'] } | null>(null)
  const [error, setError] = useState('')
  const clientId = params.get('client') ?? ''
  const recordId = params.get('record') ?? ''
  const appointmentId = params.get('appointment') ?? ''
  const noteId = params.get('note')
  const requestedActor = params.get('actor')
  const valid = [clientId, recordId, appointmentId].every(id => uuid.test(id)) && (!noteId || uuid.test(noteId))

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        if (isUnifiedClinicalClient()) {
          const resolved = await loadUnifiedIdentity('clinical', controller.signal)
          if (!controller.signal.aborted) setIdentity({ actor: resolved.actor, actors: [resolved.actor], mode: resolved.mode })
          return
        }
        const response = await fetch('/api/lab-auth/session', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        if (response.status === 401) {
          router.replace(`/connexion?retour=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)
          return
        }
        const payload = await response.json().catch(() => null)
        if (response.ok && isDurableIdentity(payload?.mode) && payload?.actor?.id) {
          if (!controller.signal.aborted) setIdentity({ actor: payload.actor, actors: [payload.actor], mode: 'isolated_local' })
          return
        }
        const fixtureResponse = await fetch('/api/clinical-workspace/actors', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        const fixture = await fixtureResponse.json().catch(() => null)
        if (!fixtureResponse.ok || fixture?.mode !== 'isolated_fixture' || !Array.isArray(fixture.actors)) throw new Error('Votre session est indisponible. Reconnectez-vous.')
        const actor = fixture.actors.find((item: FixtureActor) => item.id === requestedActor) ?? fixture.actors.find((item: FixtureActor) => item.capabilities.includes('practice'))
        if (!actor) throw new Error('Aucun professionnel fictif autorisé.')
        if (!controller.signal.aborted) setIdentity({ actor, actors: fixture.actors, mode: 'isolated_fixture' })
      } catch (cause) {
        if (!controller.signal.aborted && cause instanceof UnifiedSessionError && cause.status === 401) {
          router.replace(`/connexion?retour=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)
          return
        }
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'La note ne peut pas être ouverte.')
      }
    })()
    return () => controller.abort()
  }, [router, requestedActor])

  const workspace = useMemo<WorkspaceView | null>(() => identity ? {
    mode: identity.mode, durable: isDurableIdentity(identity.mode), context: 'clinical', actor: identity.actor,
    actors: identity.actors, clients: [], records: [], managedRecords: [], noteTypes, audit: [],
  } : null, [identity])
  const back = () => router.push(safeWorkspaceReturn(params.get('returnTo')) ?? '/clinique/mon-profil?tab=activities')

  return <main className="min-h-screen bg-[#f8f3ec] px-4 py-6 text-[#332820] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-2xl font-semibold">Note clinique</h1>
      {!valid ? <p role="alert">Le lien vers la note est incomplet ou invalide.</p>
        : error ? <p role="alert">{error}</p>
          : workspace && workspace.actor.capabilities.includes('practice')
            ? <AppointmentNotePage workspace={workspace} clientId={clientId} recordId={recordId} appointmentId={appointmentId} noteId={noteId} onBack={back} onUpdated={async () => undefined} />
            : workspace ? <p role="alert">Ce compte ne peut pas rédiger de note clinique.</p>
              : <p role="status">Vérification de la session clinique…</p>}
    </div>
  </main>
}
