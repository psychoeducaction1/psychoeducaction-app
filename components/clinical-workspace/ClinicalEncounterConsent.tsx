'use client'

import { useEffect, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalInput, clinicalLabel } from './styles'
import { usesForAdditionalPerson } from '@/lib/clinical-workspace/consentChoices'
import type { KnownClinicalPerson } from '@/lib/clinical-workspace/deidentify'
import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'

type Participant = { key: string; role: 'parent' | 'guardian' | 'other'; name?: string; roleDescription?: string; decision: 'granted' | 'refused'; recording: boolean; transcription: boolean; drafting: boolean; evidence: 'oral_witnessed' | 'written_reference' }
type ConsentView = { appointmentId: string; recordId: string; ready: boolean; recordingReady: boolean; mandateCovered: boolean; firstEncounter: boolean; signedMandatePresent: boolean; clientRecordingTranscriptionAttested: boolean; noticeVersion: string | null; action: 'attest' | 'withdraw' | null; participants: Participant[]; allAudibleIncluded: boolean }
const withdrawalKey = '70000000-0000-4000-8000-000000000000'
const newPerson = (): Participant => ({ key: crypto.randomUUID(), role: 'other', name: '', roleDescription: '', decision: 'refused', recording: false, transcription: false, drafting: false, evidence: 'oral_witnessed' })

export function ClinicalEncounterConsent({ recordId, appointmentId, onReadyChange }: { recordId: string; appointmentId: string; onReadyChange: (recordingReady: boolean, draftingReady: boolean, knownParticipants: KnownClinicalPerson[]) => void }) {
  const noticeVersion = 'ai-encounter-pilot-v1'
  const [people, setPeople] = useState<Participant[]>([])
  const [clientAttested, setClientAttested] = useState(false)
  const [view, setView] = useState<ConsentView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const url = `/api/clinical-workspace/note-assistance/consent?appointmentId=${encodeURIComponent(appointmentId)}`

  useEffect(() => {
    const controller = new AbortController()
    void clinicalSessionFetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Clinical-Context': 'clinical' }, signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Registre indisponible.')
        if (result.appointmentId !== appointmentId || result.recordId !== recordId) throw new Error('Cette attestation ne correspond pas à la rencontre.')
        if (!controller.signal.aborted) { const participants = Array.isArray(result.participants) ? result.participants.filter((item: Participant) => ['parent','guardian','other'].includes(item.role)) : []; setView(result); setPeople(participants); setClientAttested(result.clientRecordingTranscriptionAttested === true && result.noticeVersion === noticeVersion); onReadyChange(result.recordingReady === true, result.ready === true, participants) }
      }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Registre indisponible.'); onReadyChange(false, false, []) } })
    return () => controller.abort()
  }, [url, appointmentId, recordId, onReadyChange, noticeVersion])

  const invalidate = () => { setView(previous => previous ? { ...previous, ready: false, recordingReady: false } : previous); onReadyChange(false, false, people) }
  const update = (key: string, patch: Partial<Participant>) => { setPeople(previous => previous.map(item => item.key === key ? { ...item, ...patch } : item)); invalidate() }
  const coveredByMandate = (person: Participant) => view?.mandateCovered && view.participants.some(saved => saved.key === person.key && (saved.role === 'parent' || saved.role === 'guardian') && saved.evidence === 'written_reference' && saved.decision === 'granted')
  const visiblePeople = people.filter(person => !coveredByMandate(person) && (
    !view?.participants.some(saved => saved.key === person.key)
    || person.decision !== 'granted' || !person.recording || !person.transcription
    || !person.drafting
  ))
  const invalidPerson = visiblePeople.some(person => !person.name?.trim() || person.role === 'other' && !person.roleDescription?.trim())
  const submit = async (action: 'attest' | 'withdraw', participantKey?: string) => {
    if (busy) return
    setBusy(true); setError(''); invalidate()
    try {
      const response = await clinicalSessionFetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Clinical-Context': 'clinical', 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'attest' ? { action, participants: people, allAudibleIncluded: true, clientRecordingTranscriptionAttested: !view?.mandateCovered && clientAttested, noticeVersion } : { action, participantKey }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Les accords n’ont pas été enregistrés.')
      if (result.appointmentId !== appointmentId || result.recordId !== recordId) throw new Error('La confirmation ne correspond pas à la rencontre.')
      setView(result); if (Array.isArray(result.participants)) setPeople(result.participants); setClientAttested(result.clientRecordingTranscriptionAttested === true && result.noticeVersion === noticeVersion); onReadyChange(result.recordingReady === true, result.ready === true, Array.isArray(result.participants) ? result.participants : [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Le registre est indisponible.') }
    finally { setBusy(false) }
  }

  return <section className="rounded-lg border border-[#dfd0bf] bg-white p-3" aria-label="Personnes présentes et consentement">
    {!view?.mandateCovered && <h3 className="font-semibold">Consentement à l’aide IA</h3>}
    {(!view || !view.ready) && <p role="status" className="mt-1 text-sm">{!view ? error ? 'La vérification du consentement n’a pas abouti.' : 'Vérification du mandat…' : view.mandateCovered
      ? 'Accord d’une autre personne à compléter pour cette rencontre.'
      : view?.firstEncounter && !view.signedMandatePresent ? clientAttested
          ? 'Enregistrez l’accord indiqué pour cette rencontre.'
          : 'Attestez l’accord du client ou de son représentant légal pour cette première rencontre.'
        : view?.action === 'withdraw' ? 'Consentement retiré. Faites signer une nouvelle convention avant de poursuivre.'
          : 'Faites signer la convention pour générer la note.'}</p>}
    {view?.firstEncounter && !view.mandateCovered && !view.signedMandatePresent && <label className="mt-3 flex gap-2"><input type="checkbox" checked={clientAttested} onChange={event => { setClientAttested(event.target.checked); invalidate() }} />J’atteste que le client ou son représentant légal a accepté l’enregistrement audio, la transcription et l’aide IA à la rédaction de cette note, y compris l’envoi du texte filtré au fournisseur externe.</label>}
    {(view?.mandateCovered || view?.firstEncounter && !view.signedMandatePresent) && <>
      <div className="mt-3 space-y-3">{visiblePeople.map((person, index) => <div key={person.key} className="rounded-lg border border-[#e7dacd] p-3">
        <div className="flex items-center justify-between gap-2"><strong>{index + 1}. Personne présente</strong>{!view.participants.some(saved => saved.key === person.key) && <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={() => { setPeople(previous => previous.filter(item => item.key !== person.key)); invalidate() }}>Retirer de la liste</button>}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={clinicalLabel}>Nom de la personne<input className={clinicalInput} maxLength={160} value={person.name ?? ''} onChange={event => update(person.key, { name: event.target.value })} /></label>
        <label className={clinicalLabel}>Rôle<select className={clinicalInput} value={person.role} onChange={event => update(person.key, { role: event.target.value as Participant['role'], roleDescription: event.target.value === 'other' ? person.roleDescription : '' })}><option value="parent">Parent</option><option value="guardian">Responsable légal</option><option value="other">Autre personne</option></select></label></div>
        {person.role === 'other' && <label className={`${clinicalLabel} mt-3`}>Préciser le rôle<input className={clinicalInput} maxLength={120} value={person.roleDescription ?? ''} onChange={event => update(person.key, { roleDescription: event.target.value })} placeholder="Ex. : grand-parent, accompagnateur" /></label>}
        <p className="mt-2 text-sm text-[#6c5a4d]">Accord pour l’enregistrement, la transcription et l’aide IA à la note.</p>
        <label className={`${clinicalLabel} mt-3`}>Décision<select className={clinicalInput} value={person.decision === 'granted' && person.recording && person.transcription && person.drafting ? 'granted' : 'refused'} onChange={event => { const decision = event.target.value as Participant['decision']; update(person.key, { decision, ...usesForAdditionalPerson(decision) }) }}><option value="refused">Accord non donné</option><option value="granted">Accord donné</option></select></label>
        {view.ready && <button type="button" className={`${buttonClass('secondary')} mt-3`} disabled={busy} onClick={() => void submit('withdraw', person.key)}>Consigner le retrait de son accord</button>}
      </div>)}</div>
      <button type="button" className={`${buttonClass('secondary')} mt-3`} disabled={busy || people.length >= 6} onClick={() => { setPeople(previous => [...previous, newPerson()]); invalidate() }}>Ajouter une personne présente</button>
      {visiblePeople.length > 0 && <button type="button" className={`${buttonClass('primary')} mt-3`} disabled={busy || invalidPerson || !view.mandateCovered && !clientAttested} onClick={() => void submit('attest')}>{busy ? 'Enregistrement…' : 'Enregistrer les accords des personnes ajoutées'}</button>}
      {visiblePeople.length === 0 && !view.ready && <button type="button" className={`${buttonClass('secondary')} mt-3`} disabled={busy || !view.mandateCovered && !clientAttested} onClick={() => void submit('attest')}>{view.mandateCovered ? 'Confirmer la rencontre' : 'Attester l’accord du client'}</button>}
      {view.mandateCovered && <details className="mt-4 text-sm text-[#6c5a4d]"><summary className="cursor-pointer">Gestion d’un retrait du consentement</summary><p className="mt-2">À utiliser seulement si le consentement prévu au mandat est retiré. Les futurs enregistrements et traitements IA seront suspendus jusqu’à une nouvelle convention signée.</p><button type="button" className={`${buttonClass('secondary')} mt-2`} disabled={busy} onClick={() => void submit('withdraw', withdrawalKey)}>Consigner le retrait du consentement au mandat</button></details>}
    </>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </section>
}
