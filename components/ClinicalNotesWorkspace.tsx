'use client'

import { useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, FilePenLine, Plus, Video } from 'lucide-react'
import { AlertBanner, Badge, buttonClass, SectionCard } from '@/components/ui/index'
import {
  createDemoSession, demoTranscript, getDemoCopyText, transitionDemoNote,
  type DemoNoteAction, type DemoNoteStatus, type DemoSession,
} from '@/lib/clinicalNotesDemo'

const statusLabel: Record<DemoNoteStatus, string> = {
  prepare: 'À préparer', draft: 'À relire', validated: 'Validée pour l’exercice', deposited: 'Dépôt simulé confirmé',
}
const fieldClass = 'w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white px-3 py-2.5 text-sm'

function formatDate(date: string) {
  return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
}

export default function ClinicalNotesWorkspace({ initialSessions }: { initialSessions: DemoSession[] }) {
  const [sessions, setSessions] = useState(initialSessions)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [confirmDeposit, setConfirmDeposit] = useState(false)
  const [copyFallback, setCopyFallback] = useState(false)
  const [copying, setCopying] = useState(false)
  const copyArea = useRef<HTMLTextAreaElement>(null)
  const selected = sessions.find(session => session.id === selectedId)
  const copyText = selected ? getDemoCopyText(selected) : null
  const isDraft = selected?.status === 'draft'
  const isValidated = selected?.status === 'validated'

  const open = (id: string | null) => {
    setSelectedId(id); setMessage(''); setConfirmDeposit(false); setCopyFallback(false)
  }
  const dispatch = (action: DemoNoteAction) => {
    setSessions(previous => previous.map(session => session.id === selectedId
      ? transitionDemoNote(session, action) : session))
    setMessage(''); setConfirmDeposit(false); setCopyFallback(false)
  }
  const create = () => {
    const session = createDemoSession(sessions.length + 1)
    setSessions(previous => [...previous, session]); open(session.id)
  }
  const copy = async () => {
    if (!copyText) return
    setCopying(true)
    setMessage('')
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        navigator.clipboard.writeText(copyText),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Presse-papiers indisponible')), 1500)
        }),
      ])
      setMessage('Note fictive copiée. Aucun dépôt dans PsyLog n’a été effectué.')
    } catch {
      setCopyFallback(true)
      setMessage('La copie automatique est indisponible. Sélectionnez le texte ci-dessous et copiez-le manuellement.')
    } finally { clearTimeout(timeout); setCopying(false) }
  }

  return <div className="space-y-6">
    <AlertBanner title="Démonstration — données fictives uniquement" tone="neutral"
      description="N’entrez aucune information réelle. Aucun audio, aucune IA ni sauvegarde : les essais restent dans cet onglet et disparaissent à son actualisation. Ne collez pas ces exemples dans un vrai dossier PsyLog." />

    {!selected ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Mes séances fictives</h2>
        <button className={buttonClass('primary')} onClick={create}><Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle séance fictive</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((session, index) => <SectionCard key={session.id} title={`Client fictif ${index + 1}`} icon={FilePenLine}>
          <div className="space-y-4">
            <Badge tone={session.status === 'validated' || session.status === 'deposited' ? 'success' : 'neutral'}>{statusLabel[session.status]}</Badge>
            <p className="text-sm leading-6 text-[#7a6859]">{session.id}<br />{formatDate(session.date)} à {session.time}<br />{session.mode} · {session.template === 'suivi' ? 'Note de suivi' : 'Évaluation initiale'}</p>
            <button className={buttonClass('secondary')} onClick={() => open(session.id)}>
              {session.status === 'prepare' ? 'Préparer la séance' : session.status === 'draft' ? 'Relire la note' : 'Voir la note'}
            </button>
          </div>
        </SectionCard>)}
      </div>
    </> : <>
      <button className={buttonClass('ghost')} onClick={() => open(null)}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Toutes les séances</button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-semibold">Séance fictive {selected.id}</h2>
          <p className="mt-1 text-sm text-[#7a6859]">{formatDate(selected.date)} à {selected.time} · {selected.mode}</p></div>
        <Badge tone={isValidated || selected.status === 'deposited' ? 'success' : 'neutral'}>{statusLabel[selected.status]}</Badge>
      </div>
      <ol aria-label="Étapes de la note" className="grid gap-2 text-sm sm:grid-cols-3">
        {['Préparer la séance', 'Relire et valider', 'Copier vers PsyLog'].map((label, index) => {
          const step = selected.status === 'prepare' ? 0 : isDraft ? 1 : 2
          return <li key={label} aria-current={step === index ? 'step' : undefined}
            className={`rounded-xl border px-4 py-3 ${step === index ? 'border-[#c39570] bg-[#efe1d2] font-semibold' : 'border-[#eadfd2] text-[#7a6859]'}`}>{index + 1}. {label}</li>
        })}
      </ol>

      {selected.status === 'prepare' ? <SectionCard title="Préparer la séance" description="Les deux modes utilisent un exemple prédéfini. Aucun fichier n’est importé et aucun son n’est capté.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">Date fictive
            <input className={fieldClass} type="date" value={selected.date} onChange={event => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) dispatch({ type: 'configure', date: event.target.value })
            }} /></label>
          <label className="space-y-2 text-sm font-medium">Heure de Montréal
            <input className={fieldClass} type="time" value={selected.time} onChange={event => {
              if (event.target.value) dispatch({ type: 'configure', time: event.target.value })
            }} /></label>
          <label className="space-y-2 text-sm font-medium">Modalité
            <select className={fieldClass} value={selected.mode} onChange={event => dispatch({ type: 'configure', mode: event.target.value as DemoSession['mode'] })}>
              <option>Teams</option><option>Présentiel</option>
            </select></label>
          <label className="space-y-2 text-sm font-medium">Modèle de note
            <select className={fieldClass} value={selected.template} onChange={event => dispatch({ type: 'configure', template: event.target.value as DemoSession['template'] })}>
              <option value="suivi">Note de suivi</option><option value="evaluation">Évaluation initiale</option>
            </select></label>
        </div>
        <label className="my-5 flex items-start gap-3 text-sm leading-6">
          <input className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]" type="checkbox" checked={selected.consent}
            onChange={event => dispatch({ type: 'configure', consent: event.target.checked })} />
          Pour cet exercice, je simule la vérification du consentement du client fictif.
        </label>
        <div className="flex flex-wrap gap-3">
          <button className={buttonClass('secondary')} disabled={!selected.consent || selected.sourceReady}
            onClick={() => dispatch({ type: 'source' })}><Video className="h-4 w-4" aria-hidden="true" />
            {selected.mode === 'Teams' ? 'Simuler un import Teams' : 'Simuler un enregistrement'}
          </button>
          <button className={buttonClass('primary')} disabled={!selected.consent || !selected.sourceReady}
            onClick={() => dispatch({ type: 'generate' })}>Simuler la génération de la note</button>
        </div>
        {selected.sourceReady && <p className="mt-4 text-sm text-[#5f5932]" role="status">Extrait fictif prêt. Vous pouvez générer le brouillon d’exemple.</p>}
      </SectionCard> : <>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <SectionCard title={isDraft ? 'Relire et corriger la note' : 'Note validée pour l’exercice'}
            description="Vérifiez chaque information avec la source. Le professionnel reste responsable du contenu final.">
            <label className="block text-sm font-medium" htmlFor="clinical-demo-note">Note clinique fictive</label>
            <textarea id="clinical-demo-note" className={`${fieldClass} mt-2 min-h-[34rem] resize-y leading-7`}
              value={selected.text} readOnly={!isDraft} onChange={event => dispatch({ type: 'edit', text: event.target.value })} />
            {isDraft ? <div className="mt-4 space-y-4">
              <label className="flex items-start gap-3 text-sm leading-6">
                <input className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]" type="checkbox" checked={selected.reviewed}
                  onChange={event => dispatch({ type: 'review', checked: event.target.checked })} />
                J’ai relu et corrigé cette note fictive. Les informations à confirmer sont identifiées.
              </label>
              <button className={buttonClass('primary')} disabled={!selected.reviewed || !selected.text.trim()}
                onClick={() => dispatch({ type: 'validate' })}><Check className="h-4 w-4" aria-hidden="true" /> Valider la note fictive</button>
              <p className="text-xs leading-5 text-[#7a6859]">Brouillon conservé dans cet onglet seulement. Toute correction demande une nouvelle validation.</p>
            </div> : isValidated && <button className={`${buttonClass('secondary')} mt-4`} onClick={() => dispatch({ type: 'reopen' })}>Reprendre la correction</button>}
          </SectionCard>
          <SectionCard title="Source fictive" description="Extraits d’une transcription d’exemple, sans audio réel.">
            <div className="space-y-5">{demoTranscript.map(turn => <div key={turn.time} className="border-l-2 border-[#d8b992] pl-4">
              <p className="text-xs font-semibold text-[#8a5633]">{turn.time} · {turn.speaker}</p>
              <p className="mt-1 text-sm leading-6">{turn.text}</p>
            </div>)}</div>
            <p className="mt-5 rounded-xl bg-[#fbf1e7] p-3 text-sm leading-6">À vérifier : la date du prochain rendez-vous n’est pas précisée. Le brouillon ne doit pas en inventer une.</p>
          </SectionCard>
        </div>

        {(isValidated || selected.status === 'deposited') && <SectionCard title="Copie pour PsyLog — exercice" description="Dans la future version, le dépôt restera manuel. Ici, utilisez uniquement un document de test.">
          <div className="flex flex-wrap gap-3">
            <button disabled={copying} className={buttonClass('primary')} onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden="true" />{copying ? 'Copie en cours…' : 'Copier la note fictive'}</button>
            {isValidated && <button className={buttonClass('secondary')} onClick={() => setConfirmDeposit(true)}>Simuler la confirmation du dépôt</button>}
          </div>
          {confirmDeposit && <div className="mt-4 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
            <p className="mb-3 text-sm leading-6">Confirmer la dernière étape de l’exercice ? Aucun logiciel externe ne sera contacté.</p>
            <div className="flex flex-wrap gap-2"><button className={buttonClass('primary')} onClick={() => dispatch({ type: 'deposit' })}>Oui, confirmer la simulation</button>
              <button className={buttonClass('secondary')} onClick={() => setConfirmDeposit(false)}>Pas encore</button></div>
          </div>}
          {selected.status === 'deposited' && <p role="status" className="mt-4 text-sm text-[#5f5932]">Exercice terminé. Le dépôt réel dans PsyLog n’a pas été vérifié ni effectué.</p>}
          {copyFallback && <div className="mt-4 space-y-3">
            <label htmlFor="clinical-demo-copy" className="block text-sm font-medium">Texte à copier manuellement</label>
            <textarea id="clinical-demo-copy" ref={copyArea} readOnly value={copyText ?? ''} className={`${fieldClass} min-h-64`} />
            <button className={buttonClass('secondary')} onClick={() => { copyArea.current?.focus(); copyArea.current?.select() }}>Sélectionner tout le texte</button>
          </div>}
        </SectionCard>}
      </>}
      {message && <p role="status" className="rounded-xl border border-[#dfd0bf] bg-white p-4 text-sm leading-6">{message}</p>}
    </>}
  </div>
}
