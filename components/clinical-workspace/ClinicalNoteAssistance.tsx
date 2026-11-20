'use client'

import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'

import { useCallback, useEffect, useRef, useState } from 'react'
import ClinicalNotesRecorder from '@/components/ClinicalNotesRecorder'
import { buttonClass } from '@/components/Ui'
import { CLINICAL_AUDIO_MAX_BYTES, CLINICAL_TRANSCRIPT_MAX_CHARS } from '@/lib/clinicalNotesAi'
import { parseClinicalEngineResult } from '@/lib/clinicalNoteEngine'
import { CLINICAL_CONTEXT_MAX_CHARS, clinicalSourceSnapshot } from '@/lib/clinicalNoteEngine'
import type { ClinicalAlert, ClinicalEngineResult, ClinicalSources } from '@/lib/clinicalNoteEngine'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { getClinicalNoteTemplate } from '@/lib/clinicalNoteTemplates'
import { canInsertAssistedDraft, canInsertBrowserAssistedDraft, continuousAssistedNote, preparedBrowserAssistanceInput } from '@/lib/clinical-workspace/noteAssistance'
import ClinicalNotesAlerts from '@/components/ClinicalNotesAlerts'
import { ClinicalTranscriptReview } from '@/components/clinical-workspace/ClinicalTranscriptReview'
import { allTranscriptPagesReviewed, LOCAL_NOTE_TRANSCRIPT_MAX_CHARS, timedTranscript } from '@/lib/clinical-workspace/transcriptReview'
import { prepareTranscriptForDraft } from '@/lib/clinical-workspace/transcriptQuality'
import { deidentifyClinicalSources, parseClinicalIdentifiers, reviewedClinicalSources } from '@/lib/clinical-workspace/deidentify'
import { ClinicalEncounterConsent } from '@/components/clinical-workspace/ClinicalEncounterConsent'
import type { LanguageCandidate } from '@/lib/clinical-local/languageEngine'
import type { ReviewedTranscriptSegment } from '@/lib/clinical-workspace/transcriptReview'
import type { KnownClinicalPerson } from '@/lib/clinical-workspace/deidentify'
import { workingDataDeadline, workingDataExpired } from '@/lib/clinical-workspace/workingDataRetention'
import { useEncounterTranscript } from './useEncounterTranscript'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'

type WorkingVersion = { result: ClinicalEngineResult; draft: string; sources: ClinicalSources; rawSources: ClinicalSources; identifiers: string; original: string }
type BrowserPassage = { startMs: number; endMs: number; text: string }
type BrowserImport = { buffer: AudioBuffer; position: number }

const reviewLabels = [
  'J’ai comparé le texte proposé à la transcription et corrigé toute erreur ou omission.',
  'J’ai vérifié les propos, interventions, observations et attributions : aucun fait clinique n’est déduit du silence.',
  'J’ai examiné les points à vérifier et je prends la responsabilité du texte inséré.',
]

export function ClinicalNoteAssistance({ realClinical = false, actorId, transcriptFlushRef, recordId, appointmentId, noteId, noteType, templateId, templateLabel, currentText, clientName = '', dossierPeople = [], priorContext, priorContextLoading = false, onInsert }: {
  realClinical?: boolean; actorId?: string; transcriptFlushRef?: { current: (() => Promise<void>) | null }; recordId: string; appointmentId: string; noteId?: string; noteType: ClinicalNoteType; templateId?: string; templateLabel?: string; currentText: string; clientName?: string; dossierPeople?: KnownClinicalPerson[]; priorContext?: string; priorContextLoading?: boolean; onInsert: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [consentReady, setConsentReady] = useState(false)
  const [draftingConsentReady, setDraftingConsentReady] = useState(false)
  const [knownParticipants, setKnownParticipants] = useState<KnownClinicalPerson[]>([])
  const consentChanged = useCallback((recordingReady: boolean, draftingReady: boolean, participants: KnownClinicalPerson[]) => {
    setConsentReady(recordingReady); setDraftingConsentReady(draftingReady); setKnownParticipants(participants)
  }, [])
  const [draftingEnabled, setDraftingEnabled] = useState(false)
  const [languageEngineReady, setLanguageEngineReady] = useState(false)
  const [localCandidates, setLocalCandidates] = useState<LanguageCandidate[]>([])
  const [localAnalysisDone, setLocalAnalysisDone] = useState(false)
  const [localLanguageReviewed, setLocalLanguageReviewed] = useState(false)
  const [retainedEntityTerms, setRetainedEntityTerms] = useState<string[]>([])
  const [audioMaxBytes, setAudioMaxBytes] = useState(CLINICAL_AUDIO_MAX_BYTES)
  const [transcriptionEngine, setTranscriptionEngine] = useState<'local' | 'browser' | 'unavailable'>('unavailable')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [reviewAudioFile, setReviewAudioFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [listened, setListened] = useState(false)
  const [fictional, setFictional] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [original, setOriginal] = useState('')
  const [segments, setSegments] = useState<ReviewedTranscriptSegment[]>([])
  const [transcriptionDurationMs, setTranscriptionDurationMs] = useState<number | undefined>()
  const [reviewedPages, setReviewedPages] = useState<ReadonlySet<number>>(new Set())
  const [history, setHistory] = useState('')
  const [sameCase, setSameCase] = useState(false)
  const [metadata, setMetadata] = useState('')
  const [metadataConfirmed, setMetadataConfirmed] = useState(false)
  const [reviewedTranscript, setReviewedTranscript] = useState(false)
  const [identifierText, setIdentifierText] = useState('')
  const [preparedEdits, setPreparedEdits] = useState<ClinicalSources | null>(null)
  const [deidentificationReviewed, setDeidentificationReviewed] = useState(false)
  const [preparedPreviewViewed, setPreparedPreviewViewed] = useState(false)
  const [preparedPreviewOpen, setPreparedPreviewOpen] = useState(false)
  const [result, setResult] = useState<ClinicalEngineResult | null>(null)
  const [generatedTemplateLabel, setGeneratedTemplateLabel] = useState('')
  const [generatedTemplateId, setGeneratedTemplateId] = useState('')
  const [resultSources, setResultSources] = useState<ClinicalSources | null>(null)
  const [resultRawSources, setResultRawSources] = useState<ClinicalSources | null>(null)
  const [resultIdentifiers, setResultIdentifiers] = useState('')
  const [versions, setVersions] = useState<WorkingVersion[]>([])
  const [draft, setDraft] = useState('')
  const [needsCorrection, setNeedsCorrection] = useState(false)
  const [rejectedDraft, setRejectedDraft] = useState('')
  const [correctionsConfirmed, setCorrectionsConfirmed] = useState(false)
  const [checks, setChecks] = useState([false, false, false])
  const [message, setMessage] = useState('')
  const [reviewAlerts, setReviewAlerts] = useState<ClinicalAlert[]>([])
  const [retentionDeadline, setRetentionDeadline] = useState<number | null>(null)
  const retentionDeadlineRef = useRef<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const transcriptFileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const playbackEndRef = useRef<number | null>(null)
  const historyEdited = useRef(false)
  const browserWorker = useRef<Worker | null>(null)
  const deidWorker = useRef<Worker | null>(null)
  const [automaticPrepared, setAutomaticPrepared] = useState<ClinicalSources | null>(null)
  const browserAudio = useRef<File | null>(null)
  const browserImport = useRef<BrowserImport | null>(null)
  const transcriptArchive = useEncounterTranscript({ enabled: realClinical, actorId, recordId, appointmentId, text: transcript, reviewed: reviewedTranscript, restore: (text, reviewed) => { setTranscript(text); setReviewedTranscript(reviewed) } })
  useEffect(() => { if (!transcriptFlushRef) return; transcriptFlushRef.current = transcriptArchive.flush; return () => { transcriptFlushRef.current = null } }, [transcriptFlushRef, transcriptArchive.flush])
  const url = `/api/clinical-workspace/note-assistance?recordId=${encodeURIComponent(recordId)}&appointmentId=${encodeURIComponent(appointmentId)}${noteId ? `&noteId=${encodeURIComponent(noteId)}` : ''}`
  const sources: ClinicalSources = { transcript, history, metadata }
  const transcriptQuality = transcript ? prepareTranscriptForDraft(transcript) : null
  const identifierLines = identifierText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const identifiers = parseClinicalIdentifiers(identifierLines)
  const prepared = identifiers ? deidentifyClinicalSources(sources, identifiers) : null
  const fictionalReady = transcriptionEngine === 'browser' || transcriptionEngine === 'local' || fictional
  const providerSources = automaticPrepared ?? preparedEdits ?? prepared?.sources ?? sources
  const reviewedPrepared = preparedEdits && identifiers ? reviewedClinicalSources(preparedEdits, identifiers, sources) : null
  const stale = Boolean(resultSources && (
    result?.noteType !== noteType || generatedTemplateLabel !== (templateLabel ?? '') || generatedTemplateId !== (templateId ?? noteType)
    ||
    clinicalSourceSnapshot(noteType, providerSources) !== clinicalSourceSnapshot(noteType, resultSources)
    || !resultRawSources || clinicalSourceSnapshot(noteType, sources) !== clinicalSourceSnapshot(noteType, resultRawSources)
    || identifierText !== resultIdentifiers
  ))
  const sourcePermissions = transcriptionEngine === 'browser' || transcriptionEngine === 'local'
    ? draftingConsentReady && Boolean(automaticPrepared)
    : draftingConsentReady && fictional && reviewedTranscript && deidentificationReviewed && Boolean(prepared)
      && (!languageEngineReady || localLanguageReviewed)
      && (!preparedEdits || Boolean(reviewedPrepared))
      && !prepared?.residualDirectIdentifiers && (!history.trim() || sameCase) && (!metadata.trim() || metadataConfirmed)
  const transcriptLimit = transcriptionEngine === 'local' || transcriptionEngine === 'browser' ? LOCAL_NOTE_TRANSCRIPT_MAX_CHARS : CLINICAL_TRANSCRIPT_MAX_CHARS
  const allPagesReviewed = !segments.length || allTranscriptPagesReviewed(segments.length, reviewedPages)
  const changedSections = result?.revision ? result.draft.sections.filter(section =>
    JSON.stringify(section) !== JSON.stringify(result.revision!.initialDraft.sections.find(previous => previous.id === section.id)))
    .map(section => CLINICAL_NOTE_BLUEPRINTS[noteType].find(item => item.id === section.id)?.title ?? section.id) : []
  const importantReviewAlerts = result?.draft.alerts.filter(alert => alert.priority === 'prioritaire'
    || ['ambiguite', 'attribution', 'contradiction', 'fidelite', 'information_manquante', 'risque'].includes(alert.category)) ?? []

  const clearWorkingData = useCallback(() => {
    if (realClinical) {
      if (browserWorker.current) setBusy(false)
      browserWorker.current?.terminate(); browserWorker.current = null; browserAudio.current = null; browserImport.current = null
      retentionDeadlineRef.current = null; setRetentionDeadline(null)
      setFile(null); setReviewAudioFile(null); setAudioUrl(''); playbackEndRef.current = null
      return
    }
    abort.current?.abort(); abort.current = null
    browserWorker.current?.terminate(); browserWorker.current = null; browserAudio.current = null; browserImport.current = null
    deidWorker.current?.terminate(); deidWorker.current = null; setAutomaticPrepared(null)
    retentionDeadlineRef.current = null; setRetentionDeadline(null)
    setBusy(false); setFile(null); setReviewAudioFile(null); setAudioUrl(''); setListened(false); playbackEndRef.current = null
    if (fileRef.current) fileRef.current.value = ''
    setTranscript(''); setOriginal(''); setSegments([]); setTranscriptionDurationMs(undefined); setReviewedPages(new Set())
    setReviewedTranscript(false); setIdentifierText(''); setPreparedEdits(null)
    setDeidentificationReviewed(false); setPreparedPreviewViewed(false); setPreparedPreviewOpen(false)
    setLocalCandidates([]); setLocalAnalysisDone(false); setLocalLanguageReviewed(false); setRetainedEntityTerms([])
    setResult(null); setResultSources(null); setResultRawSources(null); setResultIdentifiers(''); setGeneratedTemplateLabel(''); setGeneratedTemplateId('')
    setVersions([]); setDraft(''); setNeedsCorrection(false); setRejectedDraft('')
    setCorrectionsConfirmed(false); setChecks([false, false, false]); setReviewAlerts([])
    setHistory(''); setMetadata(''); setSameCase(false); setMetadataConfirmed(false); historyEdited.current = false
    setMessage('Les données de travail ont été effacées après 24 heures. La note enregistrée dans le dossier demeure disponible.')
  }, [realClinical])
  const armRetention = () => {
    if (workingDataExpired(retentionDeadlineRef.current, Date.now())) { clearWorkingData(); if (!realClinical) return false }
    if (realClinical) return true
    if (!retentionDeadlineRef.current) {
      const deadline = workingDataDeadline(Date.now())
      retentionDeadlineRef.current = deadline; setRetentionDeadline(deadline)
    }
    return true
  }

  useEffect(() => () => { abort.current?.abort(); browserWorker.current?.terminate(); deidWorker.current?.terminate() }, [])
  useEffect(() => {
    if (!retentionDeadline) return
    const expire = () => { if (workingDataExpired(retentionDeadline, Date.now())) clearWorkingData() }
    const timer = window.setTimeout(expire, Math.max(0, retentionDeadline - Date.now()))
    window.addEventListener('focus', expire); window.addEventListener('pageshow', expire); document.addEventListener('visibilitychange', expire)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', expire); window.removeEventListener('pageshow', expire); document.removeEventListener('visibilitychange', expire) }
  }, [retentionDeadline, clearWorkingData])
  useEffect(() => { setConsentReady(false); setDraftingConsentReady(false); setKnownParticipants([]); setEnabled(null) }, [appointmentId])
  useEffect(() => {
    if (priorContext === undefined || historyEdited.current) return
    setHistory(priorContext); setSameCase(false); setAutomaticPrepared(null)
    setPreparedEdits(null); setDeidentificationReviewed(false); setPreparedPreviewViewed(false); setPreparedPreviewOpen(false)
    setLocalCandidates([]); setLocalAnalysisDone(false); setLocalLanguageReviewed(false); setRetainedEntityTerms([])
    setChecks([false, false, false])
  }, [priorContext])
  useEffect(() => {
    const localAudio = file ?? reviewAudioFile
    if (!localAudio) { setAudioUrl(''); return }
    const objectUrl = URL.createObjectURL(localAudio)
    setAudioUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, reviewAudioFile])
  useEffect(() => {
    if (!open) return
    if (!consentReady) { setEnabled(false); return }
    const controller = new AbortController()
    void clinicalSessionFetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Clinical-Context': 'clinical' }, signal: controller.signal })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Aide indisponible.')
        setEnabled(payload.enabled === true)
        setDraftingEnabled(payload.draftingEnabled === true)
        setLanguageEngineReady(payload.languageEngineReady === true)
        setAudioMaxBytes(Number.isInteger(payload.maxAudioBytes) && payload.maxAudioBytes > 0 ? payload.maxAudioBytes : CLINICAL_AUDIO_MAX_BYTES)
        setTranscriptionEngine(payload.transcriptionEngine === 'local' ? 'local' : payload.transcriptionEngine === 'browser' ? 'browser' : 'unavailable')
      }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Aide indisponible.') })
    return () => controller.abort()
  }, [open, url, consentReady])

  const invalidate = () => { setAutomaticPrepared(null); setPreparedEdits(null); setDeidentificationReviewed(false); setPreparedPreviewViewed(false); setPreparedPreviewOpen(false); setLocalCandidates([]); setLocalAnalysisDone(false); setLocalLanguageReviewed(false); setRetainedEntityTerms([]); setChecks([false, false, false]); setMessage(''); setReviewAlerts([]) }
  const editPrepared = (source: keyof ClinicalSources, value: string) => {
    setPreparedEdits(previous => ({ ...(previous ?? prepared?.sources ?? sources), [source]: value }))
    setDeidentificationReviewed(false); setChecks([false, false, false]); setMessage('')
  }
  const analyzeEntities = async () => {
    if (busy || !enabled || !languageEngineReady || !consentReady || !fictional || !reviewedTranscript || !transcript.trim()) return
    if (!armRetention()) return
    const controller = new AbortController()
    abort.current = controller
    setBusy(true); setMessage('Analyse linguistique locale en cours…')
    try {
      const response = await clinicalSessionFetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Clinical-Context': 'clinical' },
        body: JSON.stringify({ action: 'suggest-identifiers', fictional: true, ...sources }), signal: controller.signal })
      const payload = await response.json()
      if (workingDataExpired(retentionDeadlineRef.current, Date.now())) { clearWorkingData(); return }
      if (!response.ok || !Array.isArray(payload.candidates)) throw new Error(payload.error || 'Le moteur local est indisponible.')
      const candidates = payload.candidates as LanguageCandidate[]
      invalidate()
      setLocalCandidates(candidates)
      setLocalAnalysisDone(true)
      setIdentifierText(previous => [...new Set([...previous.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
        ...candidates.map(candidate => `${candidate.role}|${candidate.term}`)])].join('\n'))
      setMessage(`${candidates.length} suggestion(s) locales à vérifier. Corrigez les rôles et les faux positifs avant de confirmer.`)
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Le moteur local est indisponible.') }
    finally { if (!controller.signal.aborted) setBusy(false); if (abort.current === controller) abort.current = null }
  }
  const retainCandidate = (candidate: LanguageCandidate, retain: boolean) => {
    setRetainedEntityTerms(previous => retain ? [...previous, candidate.term] : previous.filter(term => term !== candidate.term))
    const line = `${candidate.role}|${candidate.term}`
    setIdentifierText(previous => {
      const lines = previous.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      return (retain ? lines.filter(item => item !== line) : [...new Set([...lines, line])]).join('\n')
    })
    setLocalLanguageReviewed(false); setDeidentificationReviewed(false); setChecks([false, false, false])
  }
  const chooseAudio = (selected: File | null) => {
    browserWorker.current?.terminate(); browserWorker.current = null; browserAudio.current = null; browserImport.current = null
    if (selected && !armRetention()) return
    setFile(selected); setReviewAudioFile(null); playbackEndRef.current = null; setListened(false); setReviewedTranscript(false); setTranscript(''); setOriginal(''); setSegments([]); setTranscriptionDurationMs(undefined); setReviewedPages(new Set()); invalidate()
  }
  async function generateBrowserDraft(rawText: string) {
    if (!draftingConsentReady || !draftingEnabled || priorContextLoading || realClinical && !reviewedTranscript) {
      setBusy(false); setMessage(realClinical && !reviewedTranscript ? 'Relisez et confirmez la transcription avant de générer la note.' : priorContextLoading ? 'La dernière note se charge encore. Réessayez après son chargement.' : 'Transcription prête. Vérifiez que l’accord pour l’aide IA est enregistré avant de générer la note.'); return
    }
    if (realClinical) { try { await transcriptArchive.flush() } catch { setMessage('La transcription doit être enregistrée au dossier avant de générer la note.'); return } }
    const quality = prepareTranscriptForDraft(rawText)
    if (!quality.text) {
      setMessage('La transcription contient seulement un passage répétitif suspect. Réécoutez ou corrigez ce passage avant de générer la note.'); return
    }
    // The original remains visible and editable; only the probable decoder loop is excluded from the draft request.
    const rawSources: ClinicalSources = { transcript: quality.text, history: priorContext ?? '', metadata: '' }
    if (rawSources.history.length > CLINICAL_CONTEXT_MAX_CHARS || !armRetention()) {
      setBusy(false); setMessage('La dernière note dépasse la limite; aucune donnée n’a été envoyée.'); return
    }
    setBusy(true); setMessage('Filtrage local des identifiants avant la rédaction…')
    const worker = new Worker(new URL('../../lib/clinical-workspace/browserDeidentify.worker.ts', import.meta.url), { type: 'module' })
    deidWorker.current = worker
    const controller = new AbortController()
    abort.current = controller
    try {
      const preparedSources = await new Promise<ClinicalSources>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Le filtrage local a expiré.')), 600_000)
        worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
          if (deidWorker.current !== worker || controller.signal.aborted) return
          if (event.data.type === 'prepared') { window.clearTimeout(timer); resolve(event.data.sources as ClinicalSources) }
          if (event.data.type === 'error') { window.clearTimeout(timer); reject(new Error(String(event.data.message))) }
        }
        worker.onerror = () => { window.clearTimeout(timer); reject(new Error('Le filtrage local a échoué.')) }
        worker.postMessage({ type: 'prepare', sources: rawSources, clientName, dossierPeople, knownParticipants })
      })
      if (deidWorker.current !== worker || (!realClinical && workingDataExpired(retentionDeadlineRef.current, Date.now()))) return
      setAutomaticPrepared(preparedSources)
      setMessage('Texte préparé. Rédaction et contrôle de fidélité en cours…')
      const response = await clinicalSessionFetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Clinical-Context': 'clinical' },
        body: JSON.stringify({ action: 'generate-browser', formatVersion: 1, fictional: true, noteType, templateId: templateId ?? noteType, sources: preparedSources }), signal: controller.signal })
      const payload = await response.json()
      if ((!realClinical && workingDataExpired(retentionDeadlineRef.current, Date.now()))) { clearWorkingData(); return }
      // The server may filter additional identifiers. Quotes refer to that final,
      // filtered source, while the visible original transcription stays local.
      const checkedSources = payload.sources === undefined ? preparedSources : preparedBrowserAssistanceInput({
        action: 'generate-browser', formatVersion: 1, fictional: true, noteType, sources: payload.sources,
      })?.sources
      const parsed = checkedSources ? parseClinicalEngineResult(payload.result, checkedSources) : null
      if (!parsed || parsed.noteType !== noteType) throw new Error(payload.error || 'Brouillon indisponible. La transcription reste locale.')
      const text = continuousAssistedNote(parsed)
      if (!text) throw new Error('Le brouillon proposé est vide.')
      setResult(parsed); setResultSources(checkedSources!); setResultRawSources({ ...rawSources, transcript: rawText }); setResultIdentifiers(''); setGeneratedTemplateLabel(templateLabel ?? ''); setGeneratedTemplateId(templateId ?? noteType)
      setDraft(text); setChecks([false, false, false]); setNeedsCorrection(payload.requiresCorrection === true)
      setRejectedDraft(payload.requiresCorrection === true ? text : ''); setCorrectionsConfirmed(false)
      if (Array.isArray(payload.alerts)) setReviewAlerts(payload.alerts as ClinicalAlert[])
      setMessage(payload.requiresCorrection === true
        ? 'Le contrôle de fidélité signale un écart. Corrigez le brouillon avant de l’insérer.' : '')
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'La préparation automatique a échoué.')
    } finally {
      worker.terminate(); if (deidWorker.current === worker) deidWorker.current = null
      if (abort.current === controller) abort.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function sendNextBrowserImport() {
    const job = browserImport.current
    const worker = browserWorker.current
    if (!job || !worker) return
    const { buffer } = job
    if (job.position >= buffer.length) { browserImport.current = null; worker.postMessage({ type: 'finish' }); return }
    const start = job.position
    const end = Math.min(start + buffer.sampleRate * 30, buffer.length)
    const samples = new Float32Array(end - start)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel)
      for (let index = start; index < end; index++) samples[index - start] += input[index] / buffer.numberOfChannels
    }
    job.position = end
    worker.postMessage({ type: 'chunk', samples, sampleRate: buffer.sampleRate,
      offsetMs: Math.round(start / buffer.sampleRate * 1000) }, [samples.buffer])
  }
  function startBrowserWorker(audio: File | null) {
    browserWorker.current?.terminate()
    const worker = new Worker(new URL('../../lib/clinical-workspace/browserTranscription.worker.ts', import.meta.url), { type: 'module' })
    browserWorker.current = worker
    browserAudio.current = audio
    browserImport.current = null
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (browserWorker.current !== worker) return
      const payload = event.data
      if (payload.type === 'progress') {
        const seconds = typeof payload.completedMs === 'number' ? Math.floor(payload.completedMs / 1000) : 0
        setMessage(`Transcription sur cet ordinateur : ${Math.floor(seconds / 60)} min ${seconds % 60} s traitées.`)
        if (browserImport.current) sendNextBrowserImport()
      } else if (payload.type === 'complete') {
        const raw = Array.isArray(payload.passages) ? payload.passages as BrowserPassage[] : []
        const valid = raw.length > 0 && raw.length <= 10_000 && raw.every((item, index) =>
          Number.isInteger(item.startMs) && Number.isInteger(item.endMs) && item.startMs >= 0 && item.endMs > item.startMs
          && item.endMs <= 7_200_000 && typeof item.text === 'string' && item.text.length <= 2_000
          && (index === 0 || raw[index - 1].startMs <= item.startMs))
        const text = typeof payload.transcript === 'string' ? payload.transcript : ''
        if (!valid || !text.trim() || text.length > LOCAL_NOTE_TRANSCRIPT_MAX_CHARS) {
          setMessage('La transcription du navigateur est incomplète ou invalide. Le fichier audio reste disponible pour réessayer.')
        } else {
          const reviewed: ReviewedTranscriptSegment[] = raw.map(item => ({ ...item, speaker: 'Non attribué' }))
          // Keep the browser's audio copy for playback after transcription or a later
          // preparation error. It is never uploaded with the note request.
          setReviewAudioFile(browserAudio.current); setFile(null); setListened(false); setOriginal('')
          setSegments([]); setTranscriptionDurationMs(undefined); setReviewedPages(new Set())
          const timed = timedTranscript(reviewed, { includeSpeakers: false })
          setTranscript(timed); setReviewedTranscript(false); invalidate()
          const cleaned = typeof payload.cleanedPassages === 'number' && Number.isInteger(payload.cleanedPassages) ? payload.cleanedPassages : 0
          setMessage(cleaned > 0
            ? `Transcription prête. ${cleaned} passage${cleaned > 1 ? 's' : ''} avec répétition mécanique ${cleaned > 1 ? 'ont été nettoyés' : 'a été nettoyé'}; réécoutez l’audio au besoin avant de générer la note.`
            : 'Transcription prête. Vérifiez-la, puis générez la note.')
        }
        setBusy(false)
        browserWorker.current = null; browserImport.current = null; browserAudio.current = null; worker.terminate()
      } else if (payload.type === 'error') {
        if (typeof payload.detail === 'string') console.warn('Chargement du modèle de transcription :', payload.detail)
        setBusy(false); setMessage(typeof payload.message === 'string' ? payload.message : 'Transcription indisponible.')
        browserWorker.current = null; browserImport.current = null; browserAudio.current = null; worker.terminate()
      }
    }
    worker.onerror = () => {
      if (browserWorker.current !== worker) return
      setBusy(false); setMessage('Le moteur du navigateur a échoué. Votre note actuelle est conservée.')
      browserWorker.current = null; browserImport.current = null; browserAudio.current = null; worker.terminate()
    }
    worker.postMessage({ type: 'start' })
    return worker
  }
  async function transcribeBrowserFile(selected: File) {
    if (!armRetention()) return
    setBusy(true); setMessage('Chargement du modèle et préparation de l’audio sur cet ordinateur…')
    const worker = startBrowserWorker(selected)
    let context: AudioContext | null = null
    try {
      context = new AudioContext({ sampleRate: 16_000 })
      const decoded = await context.decodeAudioData(await selected.arrayBuffer())
      if (browserWorker.current !== worker) return
      if (!decoded.length || decoded.duration > 7_200 || decoded.numberOfChannels > 8) throw new Error('Audio trop long ou non reconnu.')
      browserImport.current = { buffer: decoded, position: 0 }
      sendNextBrowserImport()
    } catch {
      if (browserWorker.current === worker) {
        worker.terminate(); browserWorker.current = null; browserAudio.current = null; browserImport.current = null
        setBusy(false); setMessage('Ce fichier ne peut pas être décodé dans le navigateur. Aucun audio n’a été envoyé.')
      }
    } finally { if (context) await context.close().catch(() => {}) }
  }
  const seekPassage = (startSeconds: number, endSeconds: number) => {
    const player = audioRef.current
    if (!player || !audioUrl) return
    playbackEndRef.current = endSeconds > startSeconds ? endSeconds : null
    player.currentTime = startSeconds
    void player.play().catch(() => setMessage('Lecture locale indisponible. Vérifiez le format audio sélectionné.'))
  }
  const stopAtPassageEnd = () => {
    const player = audioRef.current
    if (player && playbackEndRef.current !== null && player.currentTime >= playbackEndRef.current) {
      player.pause(); playbackEndRef.current = null
    }
  }
  const editSegment = (index: number, change: Partial<Pick<ReviewedTranscriptSegment, 'text' | 'speaker'>>) => {
    const next = segments.map((segment, position) => position === index ? { ...segment, ...change } : segment)
    setSegments(next); setTranscript(timedTranscript(next))
    setReviewedPages(previous => { const updated = new Set(previous); updated.delete(Math.floor(index / 25)); return updated })
    setReviewedTranscript(false); invalidate()
  }
  async function run(action: 'transcribe' | 'generate') {
    if (busy || recording || !enabled || !consentReady || !fictionalReady || (action === 'transcribe' && (!file || (transcriptionEngine !== 'local' && transcriptionEngine !== 'browser')))
      || (action === 'generate' && (!draftingEnabled || !transcript.trim() || !sourcePermissions))) return
    if (action === 'transcribe' && transcriptionEngine === 'browser' && file) { await transcribeBrowserFile(file); return }
    if (!armRetention()) return
    const controller = new AbortController()
    abort.current = controller
    setBusy(true); setReviewAlerts([]); setMessage(action === 'transcribe' && transcriptionEngine === 'local' ? 'Transcription locale en cours. Une rencontre longue peut prendre plusieurs minutes.' : '')
    try {
      let body: BodyInit
      const headers: Record<string, string> = { 'X-Clinical-Context': 'clinical' }
      if (action === 'transcribe') {
        const form = new FormData()
        form.set('fictional', 'true'); form.set('audio', file!)
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({ formatVersion: 3, fictional: true, reviewedTranscript: true, deidentificationReviewed: true,
          identifiers, ...sources, preparedSources: providerSources, retainedLocalEntityTerms: retainedEntityTerms,
          sameFictionalCase: sameCase, metadataConfirmed, noteType })
      }
      const response = await clinicalSessionFetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers, body, signal: controller.signal })
      const payload = await response.json()
      if (workingDataExpired(retentionDeadlineRef.current, Date.now())) { clearWorkingData(); return }
      if (action === 'generate' && payload.requiresCorrection === true && payload.result) {
        const parsed = parseClinicalEngineResult(payload.result, providerSources)
        const text = parsed?.noteType === noteType ? continuousAssistedNote(parsed) : ''
        if (!parsed || !text) throw new Error('Brouillon partiel invalide. Votre note actuelle est conservée.')
        if (result && resultSources && resultRawSources && !needsCorrection) setVersions(previous => [...previous, structuredClone({ result, draft, sources: resultSources, rawSources: resultRawSources, identifiers: resultIdentifiers, original })].slice(-5))
        setResult(parsed); setResultSources({ ...providerSources }); setResultRawSources({ ...sources }); setResultIdentifiers(identifierText); setDraft(text)
        setNeedsCorrection(true); setRejectedDraft(text); setCorrectionsConfirmed(false); setChecks([false, false, false])
        setMessage(parsed.revision ? 'La révision automatique a été effectuée, mais le deuxième contrôle refuse encore le brouillon. Comparez les deux versions, puis corrigez la proposition.' : 'Le contrôle de fidélité a refusé ce brouillon. La première version reste consultable; corrigez-la à partir des sources.')
        return
      }
      if (!response.ok || typeof payload.error === 'string') {
        if (Array.isArray(payload.alerts)) setReviewAlerts(payload.alerts as ClinicalAlert[])
        throw new Error(payload.error || 'L’aide à la rédaction est indisponible.')
      }
      if (action === 'transcribe') {
        if (typeof payload.transcript !== 'string' || !payload.transcript.trim() || payload.transcript.length > transcriptLimit) throw new Error('Transcription invalide.')
        const rawSegments: unknown = payload.segments
        const reviewed: ReviewedTranscriptSegment[] = Array.isArray(rawSegments) ? rawSegments.map((item: unknown) => {
          if (!item || typeof item !== 'object') throw new Error('Passage horodaté invalide.')
          const segment = item as Record<string, unknown>
          if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || typeof segment.text !== 'string') throw new Error('Passage horodaté invalide.')
          return { startMs: segment.startMs as number, endMs: segment.endMs as number, text: segment.text,
            confidence: typeof segment.confidence === 'number' ? segment.confidence : undefined,
            signalLevelDb: typeof segment.signalLevelDb === 'number' ? segment.signalLevelDb : undefined,
            speechCoverage: typeof segment.speechCoverage === 'number' ? segment.speechCoverage : undefined,
            speaker: 'Non attribué' }
        }) : []
        setReviewAudioFile(file); setFile(null); setListened(false); setOriginal(payload.transcript); setSegments(reviewed)
        setTranscriptionDurationMs(Number.isInteger(payload.durationMs) ? payload.durationMs : undefined); setReviewedPages(new Set())
        setTranscript(reviewed.length ? timedTranscript(reviewed) : payload.transcript); setReviewedTranscript(false); invalidate()
        setMessage(reviewed.length ? 'Transcription prête. Le service a effacé sa copie audio; la copie locale de cette page sert à réécouter les passages pendant la relecture.' : 'Transcription prête. Le service a effacé sa copie audio; corrigez et confirmez votre relecture.')
      } else {
        const parsed = parseClinicalEngineResult(payload.result, providerSources)
        if (!parsed || parsed.noteType !== noteType) throw new Error('Brouillon IA invalide. Votre note actuelle est conservée.')
        const text = continuousAssistedNote(parsed)
        if (!text) throw new Error('Aucun texte exploitable n’a été produit. Votre note actuelle est conservée.')
        if (result && resultSources && resultRawSources && !needsCorrection) setVersions(previous => [...previous, structuredClone({ result, draft, sources: resultSources, rawSources: resultRawSources, identifiers: resultIdentifiers, original })].slice(-5))
        if (!original) setOriginal(transcript)
        setResult(parsed); setResultSources({ ...providerSources }); setResultRawSources({ ...sources }); setResultIdentifiers(identifierText); setGeneratedTemplateLabel(templateLabel ?? ''); setGeneratedTemplateId(templateId ?? noteType); setDraft(text); setChecks([false, false, false])
        setNeedsCorrection(false); setRejectedDraft(''); setCorrectionsConfirmed(false)
        setMessage(parsed.revision ? 'Une révision ciblée a passé le deuxième contrôle de fidélité. Comparez les deux versions et relisez la proposition avant insertion.' : 'Brouillon proposé. Relisez-le et corrigez-le avant de l’insérer dans la note.')
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Aide indisponible. Votre note actuelle est conservée.')
    } finally { if (!controller.signal.aborted) setBusy(false); if (abort.current === controller) abort.current = null }
  }

  return <details className="mt-5 rounded-xl border border-[#dfd0bf] bg-[#f8f3ec] p-4" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold text-[#805738]">Aide à la rédaction par IA</summary>
    <div className="mt-4 space-y-4 text-sm">
      <ClinicalEncounterConsent recordId={recordId} appointmentId={appointmentId} onReadyChange={consentChanged} />
      {realClinical && transcriptArchive.error && !transcript && <div role="alert" className="rounded-lg bg-white p-3"><p>{transcriptArchive.error}</p><button type="button" className={buttonClass('secondary')} onClick={transcriptArchive.reload}>Réessayer le chargement de la transcription</button></div>}
      {!realClinical && enabled && transcriptionEngine === 'unavailable' && <p role="status" className="rounded-lg bg-white p-3">Saisissez ou collez votre texte ci-dessous pour préparer un brouillon avec l’IA. La transcription audio n’est pas disponible sur cette version.</p>}
      {enabled === false && consentReady && <p role="status" className="rounded-lg bg-white p-3">Le transcripteur et la rédaction IA sont indisponibles. La rédaction manuelle reste disponible.</p>}
      {enabled && !draftingEnabled && <p role="status" className="rounded-lg bg-white p-3">La transcription contrôlée reste disponible; la rédaction externe attend sa configuration.</p>}
      {enabled && (realClinical || transcriptionEngine === 'browser' || transcriptionEngine === 'local') ? <div className="space-y-4">
        {realClinical && transcriptionEngine === 'unavailable' && <p role="status">L’enregistrement est momentanément indisponible. Actualisez la page avant de réessayer.</p>}
        <p className="text-sm font-medium">Gabarit de rédaction : {templateLabel || getClinicalNoteTemplate(noteType).label}</p>
        <ClinicalNotesRecorder localProcessing disabled={busy || !consentReady || priorContextLoading || transcriptionEngine === 'unavailable' || realClinical && !transcriptArchive.loaded} onRecorded={selected => {
          if (transcriptionEngine === 'local') { chooseAudio(selected); return }
          browserAudio.current = selected; setFile(selected)
          if (browserWorker.current) { browserWorker.current.postMessage({ type: 'finish' }); setBusy(true) }
          else { setBusy(false); setMessage('Le modèle n’a pas démarré. Vous pouvez réessayer avec cet audio sans réenregistrer.') }
        }} onRecordingChange={active => { setRecording(active); if (active && realClinical) { const deadline = workingDataDeadline(Date.now()); retentionDeadlineRef.current = deadline; setRetentionDeadline(deadline) } if (transcriptionEngine === 'browser' && active && armRetention()) startBrowserWorker(null) }}
          onAudioChunk={transcriptionEngine === 'browser' ? (samples, sampleRate, offsetMs) => browserWorker.current?.postMessage({ type: 'chunk', samples, sampleRate, offsetMs }, [samples.buffer]) : undefined}
          onCancelled={() => { browserWorker.current?.terminate(); browserWorker.current = null; browserAudio.current = null; setBusy(false) }} />

        {audioUrl && <div className="space-y-2 rounded-lg border border-[#dfd0bf] bg-white p-3">
          <p className="font-medium">Audio de cette rencontre</p>
          <audio ref={audioRef} controls src={audioUrl} aria-label="Écouter l’audio enregistré sur cet ordinateur" className="w-full" />
          <button type="button" className={buttonClass('secondary')} disabled={busy || recording} onClick={() => { audioRef.current?.pause(); setFile(null); setReviewAudioFile(null); playbackEndRef.current = null }}>Effacer cet audio de la page</button>
        </div>}
        {file && <><p>{file.size > audioMaxBytes ? 'Ce fichier dépasse la limite de 160 Mo.' : 'Le fichier reste sur cet ordinateur pendant la transcription.'}</p><button type="button" className={buttonClass('primary')} disabled={busy || !consentReady || priorContextLoading || !file.size || file.size > audioMaxBytes} onClick={() => void run('transcribe')}>{realClinical ? 'Réessayer la transcription' : 'Transcrire l’audio'}</button></>}
        {transcript && <div className="space-y-3 rounded-lg border border-[#dfd0bf] bg-white p-4">
          <h4 className="font-semibold">Relire la transcription</h4>
          {realClinical && <p role={transcriptArchive.error ? 'alert' : 'status'} className="text-xs">{transcriptArchive.error || (transcriptArchive.saved ? 'Transcription enregistrée au dossier.' : 'Enregistrement de la transcription…')}</p>}
          {realClinical && transcriptArchive.error && <button type="button" className={buttonClass('secondary')} onClick={transcriptArchive.reload}>Recharger la transcription du dossier</button>}
          <label className="block font-medium">Transcription de l’audio<textarea className="mt-2 h-64 w-full rounded-xl border border-[#dfd0bf] p-3 leading-7" maxLength={LOCAL_NOTE_TRANSCRIPT_MAX_CHARS} disabled={busy} value={transcript} onChange={event => { setTranscript(event.target.value); setReviewedTranscript(false); invalidate() }} /></label>
          {transcriptQuality?.suspectPassages.length ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">Répétition probable à {transcriptQuality.suspectPassages.join(', ')}. Ce passage reste visible ici, mais il sera écarté du brouillon. Réécoutez l’audio et corrigez la transcription si des propos utiles manquent.</p> : null}
          {realClinical && <label className="flex items-start gap-2"><input type="checkbox" checked={reviewedTranscript} disabled={busy || recording} onChange={event => setReviewedTranscript(event.target.checked)} />J’ai relu et corrigé la transcription.</label>}
          <button type="button" className={buttonClass('primary')} disabled={busy || recording || realClinical && !reviewedTranscript || !transcriptQuality?.text || !draftingConsentReady || !draftingEnabled || priorContextLoading} onClick={() => void generateBrowserDraft(transcript)}>Générer la note à partir de cette transcription</button>
        </div>}
        {result && <div className="space-y-3 rounded-lg border border-[#dfd0bf] bg-white p-4">
          {stale && <p role="alert" className="rounded-lg bg-amber-50 p-3">La transcription a changé. Actualisez le brouillon avant de l’insérer.</p>}
          <label className="block font-medium">Brouillon clinique à relire<textarea className="mt-2 min-h-64 w-full rounded-xl border border-[#dfd0bf] p-3 leading-7" maxLength={24000} value={draft} onChange={event => setDraft(event.target.value)} /></label>
          {importantReviewAlerts.length > 0 && <details className="rounded-lg border border-[#dfd0bf] bg-[#fbf6ef] p-3" open={importantReviewAlerts.some(alert => alert.priority === 'prioritaire')}>
            <summary className="cursor-pointer font-medium">Points à vérifier séparément de la note ({importantReviewAlerts.length}){importantReviewAlerts.some(alert => alert.priority === 'prioritaire') ? ' · priorité clinique' : ''}</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5">{importantReviewAlerts.map((alert, index) => <li key={`${alert.category}-${index}`}>{alert.text}</li>)}</ul>
          </details>}
          <button type="button" className={buttonClass('primary')} disabled={!canInsertBrowserAssistedDraft({ stale, sourcesReady: sourcePermissions, draft, busy })} onClick={() => { onInsert(draft.trim()); setMessage('Texte inséré dans la note. Vérifiez-le avant la signature.') }}>Insérer le texte dans la note</button>
        </div>}
        {realClinical && <p className="text-xs">L’audio reste temporairement dans cet onglet et est effacé au plus tard après 24 heures, ou à la fermeture de la page. La transcription enregistrée reste au dossier.</p>}
        {!realClinical && retentionDeadline && <p className="text-xs">Les données de travail de cette page sont effacées au plus tard après 24 heures. Fermer l’onglet efface leur copie en mémoire.</p>}
      </div> : !realClinical && enabled && <>
        <p className="rounded-lg border border-[#dfd0bf] bg-white p-3">Parcours sans envoi d’audio : saisissez ou collez une transcription fictive ci-dessous, puis relisez-la avant de demander un brouillon. Seul le texte confirmé sera envoyé pour la rédaction.</p>
        <details className="rounded-lg border border-[#dfd0bf] bg-white p-3"><summary className="cursor-pointer font-medium">Option : enregistrer ou importer un audio fictif</summary>
          <div className="mt-3 space-y-3">
            {transcriptionEngine === 'local'
              ? <p className="rounded-lg bg-[#eef4ee] p-3">L’audio fictif est transcrit par le moteur local du laboratoire, jusqu’à deux heures et 160 Mo. Le service efface sa copie après transcription. Le navigateur conserve temporairement le fichier sélectionné pour réécouter les passages; vous pouvez effacer cette copie locale après relecture. Le fichier original sur votre ordinateur reste sous votre contrôle.</p>
              : transcriptionEngine === 'browser'
                ? <p className="rounded-lg bg-[#eef4ee] p-3">La transcription s’exécute sur cet ordinateur, dans le navigateur. Le modèle se télécharge au premier usage; l’audio n’est pas envoyé au serveur. Gardez cet onglet ouvert pendant l’enregistrement et le traitement.</p>
              : <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3">Le transcripteur contrôlé est indisponible. Vous pouvez saisir une transcription fictive; aucun audio ne sera envoyé à OpenAI en remplacement.</p>}
            <ClinicalNotesRecorder disabled={busy || (transcriptionEngine !== 'local' && transcriptionEngine !== 'browser')}
              onRecorded={selected => {
                if (transcriptionEngine === 'browser') { browserAudio.current = selected; setFile(selected); browserWorker.current?.postMessage({ type: 'finish' }); setBusy(true) }
                else chooseAudio(selected)
              }}
              onRecordingChange={active => { setRecording(active); if (active && transcriptionEngine === 'browser') { if (armRetention()) startBrowserWorker(null) } }}
              onAudioChunk={transcriptionEngine === 'browser' ? (samples, sampleRate, offsetMs) => {
                browserWorker.current?.postMessage({ type: 'chunk', samples, sampleRate, offsetMs }, [samples.buffer])
              } : undefined}
              onCancelled={() => { browserWorker.current?.terminate(); browserWorker.current = null; browserAudio.current = null; browserImport.current = null; setBusy(false) }} />
            <div className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClass('secondary')} disabled={busy || recording || (transcriptionEngine !== 'local' && transcriptionEngine !== 'browser')} onClick={() => fileRef.current?.click()}>Importer un fichier audio fictif</button><span className="text-xs text-[#6c5a4d]">{file?.name ?? 'Aucun fichier choisi · WAV, MP3, M4A ou WebM'}</span><input ref={fileRef} type="file" aria-label="Fichier audio fictif à importer" accept=".wav,.mp3,.m4a,.webm" className="hidden" onChange={event => { chooseAudio(event.target.files?.[0] ?? null); event.target.value = '' }} /></div>
            {file && <audio ref={audioRef} controls src={audioUrl} onTimeUpdate={stopAtPassageEnd} aria-label="Réécouter l’extrait fictif local" className="w-full" />}
            {file && <><p>{file.size > audioMaxBytes ? 'Ce fichier dépasse la limite de ' + Math.round(audioMaxBytes / 1_000_000) + ' Mo.' : 'Vérifiez que le fichier contient seulement des données fictives avant de le transcrire.'}</p>{transcriptionEngine === 'local' && <label className="flex gap-2"><input type="checkbox" checked={listened} onChange={event => setListened(event.target.checked)} />J’ai vérifié que l’audio est entièrement fictif et que les voix sont audibles.</label>}<button type="button" className={buttonClass('secondary')} disabled={!fictional || (transcriptionEngine === 'local' && !listened) || busy || recording || (transcriptionEngine !== 'local' && transcriptionEngine !== 'browser') || !file.size || file.size > audioMaxBytes} onClick={() => void run('transcribe')}>Transcrire l’audio fictif</button></>}
          </div>
        </details>
        {reviewAudioFile && <div className="space-y-2 rounded-lg border border-[#dfd0bf] bg-white p-3"><p className="text-sm">Écoute locale des passages horodatés. La copie côté service a déjà été effacée.</p>
          <audio ref={audioRef} controls src={audioUrl} onTimeUpdate={stopAtPassageEnd} aria-label="Réécouter les passages fictifs" className="w-full" />
          <button type="button" className={buttonClass('secondary')} onClick={() => { audioRef.current?.pause(); setReviewAudioFile(null); playbackEndRef.current = null }}>Effacer la copie audio locale de cette page</button></div>}
        {original && <details className="rounded-lg border border-[#dfd0bf] bg-white p-3"><summary className="cursor-pointer font-medium">Transcription originale</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{original}</p></details>}
        {segments.length > 0 && <ClinicalTranscriptReview segments={segments} durationMs={transcriptionDurationMs} reviewedPages={reviewedPages} disabled={busy || recording} onEdit={editSegment}
          onSeek={reviewAudioFile && audioUrl ? seekPassage : undefined}
          onPageReview={(page, checked) => { setReviewedPages(previous => { const updated = new Set(previous); if (checked) updated.add(page); else updated.delete(page); return updated }); setReviewedTranscript(false); invalidate() }}
          />}
        {segments.length === 0 && <label className="block font-medium">Transcription fictive saisie ou issue de l’audio, à vérifier
          <textarea className="mt-2 min-h-40 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 leading-6" maxLength={transcriptLimit} value={transcript} disabled={busy || recording} onChange={event => { if (event.target.value && !armRetention()) return; setTranscript(event.target.value); setReviewedTranscript(false); invalidate() }} />
        </label>}
        {segments.length > 0 && <details className="rounded-lg border border-[#dfd0bf] bg-white p-3"><summary className="cursor-pointer font-medium">Voir le texte corrigé complet ({transcript.length} caractères)</summary><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{transcript}</p></details>}
        {transcript.length > transcriptLimit && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3">La transcription corrigée dépasse {transcriptLimit.toLocaleString('fr-CA')} caractères. Elle reste disponible pour la relecture, mais ce moteur de rédaction ne peut pas encore traiter tout ce texte en une fois.</p>}
        <label className="flex gap-2"><input type="checkbox" checked={fictional} onChange={event => setFictional(event.target.checked)} />Je confirme que ces sources sont entièrement fictives. L’audio sera transcrit seulement dans le moteur contrôlé; le texte préparé sera envoyé à l’IA uniquement après mon action.</label>
        <label className="flex gap-2"><input type="checkbox" checked={reviewedTranscript} disabled={!allPagesReviewed || transcript.length > transcriptLimit || !transcript.trim()} onChange={event => setReviewedTranscript(event.target.checked)} />J’ai relu et corrigé la transcription; les locuteurs incertains restent non attribués.</label>
        {retentionDeadline && <p className="text-xs text-[#6c5a4d]">Les transcriptions et brouillons de travail de cette page sont effacés au plus tard 24 heures après l’import ou la première saisie. La note enregistrée dans le dossier n’est pas touchée.</p>}
        <details className="rounded-lg border border-[#dfd0bf] bg-white p-3"><summary className="cursor-pointer font-medium">Dernière note et renseignements confirmés (facultatifs)</summary><div className="mt-3 space-y-3">
          {priorContextLoading && <p role="status">Chargement de la dernière note…</p>}
          <label className="block">Contenu de la dernière note<textarea className="mt-2 min-h-24 w-full rounded-xl border border-[#dfd0bf] p-3" value={history} maxLength={CLINICAL_CONTEXT_MAX_CHARS} disabled={busy || recording} onChange={event => { historyEdited.current = true; setHistory(event.target.value); setSameCase(false); invalidate() }} /></label>
          <label className="flex gap-2"><input type="checkbox" checked={sameCase} disabled={busy || recording} onChange={event => { setSameCase(event.target.checked); invalidate() }} />Ce contexte est autorisé et concerne ce même dossier fictif.</label>
          <label className="block">Renseignements confirmés (présences, milieu, date ou durée)<textarea className="mt-2 min-h-24 w-full rounded-xl border border-[#dfd0bf] p-3" value={metadata} maxLength={2_000} disabled={busy || recording} onChange={event => { setMetadata(event.target.value); setMetadataConfirmed(false); invalidate() }} /></label>
          <label className="flex gap-2"><input type="checkbox" checked={metadataConfirmed} disabled={busy || recording} onChange={event => { setMetadataConfirmed(event.target.checked); invalidate() }} />J’ai vérifié ces renseignements; ils sont distincts de la transcription.</label>
        </div></details>
        <div className="space-y-3 rounded-lg border border-[#dfd0bf] bg-white p-3">
          {languageEngineReady && <div className="space-y-2 rounded-lg border border-[#dfd0bf] p-3">
            <button type="button" className={buttonClass('secondary')} disabled={busy || recording || !fictional || !reviewedTranscript || !transcript.trim()}
              onClick={() => void analyzeEntities()}>Repérer localement les noms et leurs liens</button>
            <p className="text-xs">Le modèle français s’exécute sur cette machine. Les noms, lieux, établissements et prénoms répétés proposés ne partent pas vers l’IA externe à cette étape.</p>
            {localCandidates.length > 0 && <ul className="space-y-2">{localCandidates.map(candidate => <li key={candidate.term} className="rounded-lg border border-[#e5d8c9] p-2">
              <strong>{candidate.term}</strong> — {candidate.role}. {candidate.reason}
              {candidate.antecedent && <span> Nom complet proposé : {candidate.antecedent}.</span>}
              <label className="mt-1 flex gap-2 text-sm"><input type="checkbox" checked={retainedEntityTerms.includes(candidate.term)}
                onChange={event => retainCandidate(candidate, event.target.checked)} />Conserver ce terme après vérification : il ne désigne pas ici une personne ou un lieu identifiable.</label>
            </li>)}</ul>}
            {localAnalysisDone && localCandidates.length === 0 && <p className="text-xs">Le modèle n’a proposé aucune entité. Vérifiez aussi les noms qu’il aurait pu manquer.</p>}
            <label className="flex gap-2"><input type="checkbox" checked={localLanguageReviewed} disabled={busy || recording || !reviewedTranscript || !fictional || !localAnalysisDone}
              onChange={event => { setLocalLanguageReviewed(event.target.checked); setDeidentificationReviewed(false); setChecks([false, false, false]) }} />J’ai vérifié les entités proposées, les rôles et les prénoms reliés.</label>
          </div>}
          <label className="block font-medium">Noms, lieux et autres identifiants à masquer (un par ligne)
            <textarea className="mt-2 min-h-24 w-full rounded-xl border border-[#dfd0bf] p-3" value={identifierText}
              disabled={busy || recording} onChange={event => { setIdentifierText(event.target.value); setPreparedEdits(null);
                setDeidentificationReviewed(false); setPreparedPreviewViewed(false); setPreparedPreviewOpen(false);
                setLocalLanguageReviewed(false); setChecks([false, false, false]); setMessage('') }}
              placeholder="Exemple fictif : Camille Tremblay" />
          </label>
           <p className="text-xs">Une ligne peut indiquer un rôle : « client|Camille Tremblay », « mère|Julie Tremblay », « école|École du Lac » ou « employeur|Entreprise X ». Pour un événement rare, fournissez sa reformulation clinique : « événement|incident précis fictif|un événement familial marquant ». Sans rôle, l’identifiant reçoit un marqueur neutre. Les courriels, téléphones, codes postaux, adresses et dates exactes restent masqués automatiquement. Vérifiez les détails indirects.</p>
          {!identifiers && <p role="alert">Au plus 60 lignes : 80 caractères pour un identifiant, 120 pour un événement.</p>}
          {prepared && <p>{prepared.replacementCount} élément(s) masqué(s) ou reformulé(s) dans les sources.</p>}
          {prepared?.residualDirectIdentifiers && <p role="alert">Un identifiant direct demeure dans les sources. L’envoi est bloqué.</p>}
           {preparedEdits && !reviewedPrepared && <p role="alert">Le texte corrigé contient encore un identifiant reconnu ou dépasse les limites. L’envoi est bloqué.</p>}
          <label className="flex gap-2"><input type="checkbox" checked={deidentificationReviewed}
            disabled={!fictional || !reviewedTranscript || !preparedPreviewViewed || !prepared || prepared.residualDirectIdentifiers}
            onChange={event => { setDeidentificationReviewed(event.target.checked); setChecks([false, false, false]) }} />
            J’ai relu les trois sources préparées ci-dessous et vérifié les noms et détails reconnaissables avant l’envoi.
          </label>
        </div>
        {transcript.trim() && <details className="rounded-lg border border-[#dfd0bf] bg-white p-3" open={preparedPreviewOpen} onToggle={event => { setPreparedPreviewOpen(event.currentTarget.open); if (event.currentTarget.open) setPreparedPreviewViewed(true) }}>
           <summary className="cursor-pointer font-medium">Comparer et corriger le texte préparé pour l’IA externe</summary>
          <div className="mt-3 space-y-3">
            <p>Après vos confirmations, l’analyse et la vérification reçoivent ces sources; la rédaction reçoit les faits qui en sont extraits. Le fichier audio n’est pas renvoyé pour rédiger la note.</p>
             {(['transcript', 'history', 'metadata'] as const).filter(source => source === 'transcript' || sources[source].trim()).map(source => <div key={source} className="rounded-lg border border-[#dfd0bf] p-3">
               <strong>{source === 'transcript' ? 'Transcription' : source === 'history' ? 'Dernière note' : 'Renseignements confirmés'}</strong>
               <div className="mt-2 grid gap-3 lg:grid-cols-2">
                 <div><span className="text-xs font-semibold">Texte original</span><p className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8f3ec] p-3">{source === 'transcript' ? original || sources.transcript : sources[source]}</p></div>
                 <label className="block text-xs font-semibold">Version préparée, à corriger avant l’envoi<textarea className="mt-1 min-h-48 w-full rounded-lg border border-[#dfd0bf] p-3 text-sm font-normal leading-6" value={providerSources[source]} disabled={busy || recording} onChange={event => editPrepared(source, event.target.value)} /></label>
               </div>
               {source !== 'transcript' && <button type="button" className={buttonClass('secondary')} disabled={busy || recording} onClick={() => {
                 if (source === 'history') { historyEdited.current = true; setHistory(''); setSameCase(false) }
                 else { setMetadata(''); setMetadataConfirmed(false) }
                 invalidate()
               }}>Retirer cette source de l’envoi</button>}
             </div>)}
             {prepared && <details className="rounded-lg border border-[#dfd0bf] p-3"><summary className="cursor-pointer font-medium">Éléments supprimés ou reformulés ({prepared.transformations.length})</summary>
               <ul className="mt-2 max-h-64 space-y-2 overflow-auto">{prepared.transformations.map((change, index) => <li key={index}><strong>{change.source === 'transcript' ? 'Transcription' : change.source === 'history' ? 'Dernière note' : 'Renseignements confirmés'}</strong> : « {change.original} » → « {change.replacement} » — {change.reason}</li>)}</ul>
               <p className="mt-2 text-xs">Cette liste décrit les règles appliquées. Elle ne repère pas tous les identifiants indirects ni les corrections manuelles; relisez les deux colonnes.</p>
             </details>}
          </div>
        </details>}
        <button type="button" className={buttonClass('secondary')} disabled={!draftingEnabled || !sourcePermissions || !transcript.trim() || transcript.length > transcriptLimit || busy || recording} onClick={() => void run('generate')}>{result ? 'Régénérer explicitement le brouillon' : 'Proposer un brouillon avec l’IA'}</button>
        {result && <div className="space-y-3 rounded-xl border border-[#dfd0bf] bg-white p-4">
          {needsCorrection && <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3">Brouillon partiel non validé par l’IA. Corrigez les éléments signalés ci-dessous et vérifiez toute la note. Aucun texte n’est inséré automatiquement.</p>}
          {stale && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3">Les sources ont changé. Le brouillon et vos corrections sont conservés, mais vous devez régénérer avant de l’insérer.</p>}
          <div className="grid gap-3 lg:grid-cols-2"><details className="rounded-lg border border-[#dfd0bf] p-3" open><summary className="cursor-pointer font-medium">Sources utilisées pour ce brouillon</summary><p className="mt-2 whitespace-pre-wrap">{resultSources?.transcript}</p>{resultSources?.history && <p className="mt-3 whitespace-pre-wrap"><strong>Dernière note :</strong> {resultSources.history}</p>}{resultSources?.metadata && <p className="mt-3 whitespace-pre-wrap"><strong>Renseignements confirmés :</strong> {resultSources.metadata}</p>}</details>
            <details className="rounded-lg border border-[#dfd0bf] p-3"><summary className="cursor-pointer font-medium">Passages cités par l’analyse ({result.analysis.facts.length})</summary><ul className="mt-2 space-y-2">{result.analysis.facts.map(fact => <li key={fact.id}><strong>{fact.id} · {fact.source}</strong> — « {fact.quote} »</li>)}</ul></details></div>
          <ClinicalNotesAlerts alerts={[...result.analysis.alerts, ...result.draft.alerts]} />
          {result.revision && <details className="rounded-lg border border-[#dfd0bf] p-3" open><summary className="cursor-pointer font-medium">Comparer la première version et la révision automatique</summary>
            <p className="mt-2 text-sm">Rubriques modifiées : {changedSections.length ? changedSections.join(', ') : 'aucune modification de rubrique détectée'}. Le deuxième contrôle {needsCorrection ? 'a encore refusé' : 'a accepté'} la version révisée; votre relecture reste nécessaire.</p>
            <ClinicalNotesAlerts alerts={result.revision.initialAlerts} />
            <div className="mt-3 grid gap-3 lg:grid-cols-2"><div><strong>Première version conservée</strong><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8f3ec] p-3 text-sm">{continuousAssistedNote({ ...result, draft: result.revision.initialDraft })}</pre></div>
              <div><strong>Version révisée proposée</strong><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8f3ec] p-3 text-sm">{continuousAssistedNote(result)}</pre></div></div>
          </details>}
          <label className="block font-medium">Brouillon à relire et corriger<textarea className="mt-2 min-h-64 w-full rounded-xl border border-[#dfd0bf] p-3 leading-7" value={draft} maxLength={24000} onChange={event => { setDraft(event.target.value); setChecks([false, false, false]); setCorrectionsConfirmed(false) }} /></label>
          {needsCorrection && <label className="flex gap-2"><input type="checkbox" checked={correctionsConfirmed} disabled={draft.trim() === rejectedDraft.trim()} onChange={event => setCorrectionsConfirmed(event.target.checked)} />J’ai corrigé le brouillon refusé à partir des sources et revu chaque point signalé.</label>}
          {reviewLabels.map((label, index) => <label key={label} className="flex gap-2"><input type="checkbox" checked={checks[index]} onChange={event => setChecks(previous => previous.map((value, i) => i === index ? event.target.checked : value))} />{label}</label>)}
          <button type="button" className={buttonClass('primary')} disabled={!canInsertAssistedDraft({ stale, sourcesConfirmed: sourcePermissions, checks, draft, busy, needsCorrection, rejectedDraft, correctionsConfirmed })} onClick={() => {
            if (currentText.trim() && !window.confirm('Remplacer le texte actuel de la note par le brouillon relu ?')) return
            onInsert(draft.trim()); setMessage('Texte inséré dans le brouillon de la note. Vérifiez-le avant la signature.')
          }}>Insérer le texte relu dans la note</button>
        </div>}
        {versions.length > 0 && <details className="rounded-lg border border-[#dfd0bf] bg-white p-3"><summary className="cursor-pointer font-medium">Brouillons précédents ({versions.length}/5)</summary><p className="mt-2 text-xs">Conservés seulement dans cette page. Restaurer exige une nouvelle vérification avant insertion.</p><div className="mt-3 flex flex-wrap gap-2">{versions.map((version, index) => <button key={index} type="button" className={buttonClass('secondary')} disabled={busy || recording} onClick={() => {
          if (result && resultSources && resultRawSources && !needsCorrection) setVersions(previous => [...previous, structuredClone({ result, draft, sources: resultSources, rawSources: resultRawSources, identifiers: resultIdentifiers, original })].slice(-5))
          const restored = structuredClone(version)
          setResult(restored.result); setResultSources(restored.sources); setResultRawSources(restored.rawSources); setResultIdentifiers(restored.identifiers); setDraft(restored.draft); setOriginal(restored.original)
          setNeedsCorrection(false); setRejectedDraft(''); setCorrectionsConfirmed(false)
          setTranscript(restored.rawSources.transcript); historyEdited.current = true; setHistory(restored.rawSources.history); setMetadata(restored.rawSources.metadata)
          setIdentifierText(restored.identifiers)
          setReviewedTranscript(false); setSameCase(false); setMetadataConfirmed(false); invalidate()
          setMessage('Brouillon restauré. Vérifiez de nouveau les sources et confirmez le contexte avant insertion.')
        }}>Restaurer le brouillon {index + 1}</button>)}</div></details>}
      </>}
      {message && <p role="status" className="rounded-lg bg-white p-3">{message}</p>}
      {transcriptionEngine !== 'browser' && reviewAlerts.length > 0 && <ClinicalNotesAlerts alerts={reviewAlerts} />}
    </div>
  </details>
}


