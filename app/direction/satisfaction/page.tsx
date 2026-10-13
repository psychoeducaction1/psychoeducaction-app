'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { AppNav } from '@/components/AppNav'
import {
  AlertBanner,
  Badge,
  buttonClass,
  EmptyState,
  PageHeader,
  SectionCard,
  StatCard,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { isSuperAdmin } from '@/lib/superAdmin'
import { ImportAnalysis } from '@/components/satisfaction/ImportAnalysis'
import { TestEmailPanel } from '@/components/satisfaction/TestEmailPanel'
import { matchesSatisfactionSearch, satisfactionContactIssueLabel, type SatisfactionAnalysis } from '@/lib/satisfactionWorkspace'
import {
  buildSatisfactionEmail,
  detectEncounterPeriod,
  extractSatisfactionRows,
  getFirstName,
  SATISFACTION_MIN_ENCOUNTERS,
  type SatisfactionEncounter,
} from '@/lib/satisfaction'

type EligibleRow = {
  id: string
  import_id?: string
  client_nom: string
  destinataire_nom: string
  destinataire_email: string | null
  destinataire_emails: string[]
  professionnel: string | null
  nb_rencontres: number
  derniere_rencontre: string | null
  statut: string
  jeton_reponse: string
  jeton_desabonnement: string
  reponse?: { note: number; commentaire: string | null; repondu_le: string } | null
  dernier_envoi?: { statut: string; envoye_le: string; erreur: string | null } | null
}

type ImportSummary = {
  id: string
  imported_at: string
  period_start: string
  period_end: string
  row_count: number
  file_name: string | null
  eligible_count: number
  sent_count: number
  response_count: number
}
type ImportInfo = Pick<ImportSummary, 'id' | 'file_name' | 'period_start' | 'period_end' | 'row_count'>

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

const STATUT_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoyé',
  exclu: 'Exclu',
  desabonne: 'Désabonné',
}

const STATUT_TONES: Record<string, 'warning' | 'success' | 'muted' | 'neutral'> = {
  en_attente: 'warning',
  envoye: 'success',
  exclu: 'muted',
  desabonne: 'neutral',
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatDateTimeFr(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function DirectionSatisfactionPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const [fileName, setFileName] = useState('')
  const [encounters, setEncounters] = useState<SatisfactionEncounter[]>([])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [editingPeriod, setEditingPeriod] = useState(false)
  const [fileError, setFileError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  const [eligibles, setEligibles] = useState<EligibleRow[]>([])
  const [currentImportLabel, setCurrentImportLabel] = useState('')
  const [currentImport, setCurrentImport] = useState<ImportInfo | null>(null)
  const [analysis, setAnalysis] = useState<SatisfactionAnalysis | null>(null)
  const [viewingImport, setViewingImport] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [professionalFilter, setProfessionalFilter] = useState('')
  const [missingEmailCount, setMissingEmailCount] = useState(0)

  const [history, setHistory] = useState<ImportSummary[]>([])
  const [historyError, setHistoryError] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewRow, setPreviewRow] = useState<EligibleRow | null>(null)
  const [sendingId, setSendingId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [editingEmailId, setEditingEmailId] = useState('')
  const [editingEmailValue, setEditingEmailValue] = useState('')

  const authedFetch = async (path: string, options?: RequestInit) => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      router.push('/login')
      throw new Error('Session expirée.')
    }

    return fetch(path, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  const loadHistory = async () => {
    try {
      const response = await authedFetch('/api/satisfaction/import')
      const body = (await response.json()) as {
        imports?: ImportSummary[]
        error?: string
      }

      if (!response.ok) {
        setHistoryError(body.error ?? "Erreur pendant le chargement de l'historique.")
        return
      }

      setHistory(body.imports ?? [])
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message === 'Session expirée.') return
      setHistoryError("Erreur pendant le chargement de l'historique.")
    }
  }

  useEffect(() => {
    const loadData = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (profileError || !profile || !isSuperAdmin(user, profile)) {
        router.push('/direction')
        return
      }

      setAuthorized(true)
      setLoading(false)
      await loadHistory()
    }

    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const total = eligibles.length
    const enAttente = eligibles.filter((row) => row.statut === 'en_attente').length
    const envoyes = eligibles.filter((row) => row.statut === 'envoye').length
    const sansEmail = eligibles.filter(
      (row) => row.statut === 'en_attente' && !row.destinataire_email?.trim()
    ).length
    return { total, enAttente, envoyes, sansEmail, responses: eligibles.filter(row => row.reponse).length }
  }, [eligibles])
  const filteredEligibles = eligibles.filter(row =>
    matchesSatisfactionSearch(search, [row.client_nom, row.destinataire_nom, row.professionnel, row.destinataire_email, ...(row.destinataire_emails ?? [])])
    && (!professionalFilter || row.professionnel === professionalFilter)
    && (!statusFilter || (statusFilter === 'repondu' ? Boolean(row.reponse)
      : statusFilter === 'sans_courriel' ? !row.destinataire_email : row.statut === statusFilter)))
  const professionals = [...new Set([...eligibles.map(row => row.professionnel), ...(analysis?.rows.map(row => row.professionnel) ?? [])].filter((value): value is string => Boolean(value)))].sort()

  const handleFileChange = async (file: File | null) => {
    setFileError('')
    setAnalyzeError('')
    setEligibles([])
    setCurrentImportLabel('')
    setFileName(''); setEncounters([]); setPeriodStart(''); setPeriodEnd('')
    setSelectedIds(new Set())
    setCurrentImport(null)
    setAnalysis(null)
    setEditingPeriod(false)

    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
      }) as unknown[][]

      const parsed = extractSatisfactionRows(rows)

      if (parsed.length === 0) {
        setFileError(
          "Aucune rencontre trouvée dans ce fichier. Vérifiez qu'il s'agit bien d'un export « Activités détaillées »."
        )
        return
      }

      const period = detectEncounterPeriod(parsed)

      setFileName(file.name)
      setEncounters(parsed)
      setPeriodStart(period?.start ?? '')
      setPeriodEnd(period?.end ?? '')
    } catch (caughtError) {
      setFileError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Erreur inconnue pendant la lecture du fichier.'
      )
    }
  }

  const handleAnalyze = async () => {
    setAnalyzeError('')
    setActionMessage('')
    setActionError('')

    if (encounters.length === 0) {
      setAnalyzeError('Veuillez d’abord choisir un fichier Excel à analyser.')
      return
    }
    if (!periodStart || !periodEnd) {
      setAnalyzeError('Veuillez indiquer la période à analyser.')
      return
    }

    setAnalyzing(true)

    try {
      const response = await authedFetch('/api/satisfaction/import', {
        method: 'POST',
        body: JSON.stringify({
          encounters,
          ...(editingPeriod ? { periodStart, periodEnd } : {}),
          fileName,
        }),
      })
      const body = (await response.json()) as {
        eligibles?: EligibleRow[]
        missingEmailCount?: number
        import?: ImportInfo
        analysis?: SatisfactionAnalysis
        error?: string
      }

      if (!response.ok) {
        setAnalyzeError(body.error ?? "Erreur pendant l'analyse.")
        return
      }

      setEligibles(body.eligibles ?? [])
      setMissingEmailCount(body.missingEmailCount ?? 0)
      setAnalysis(body.analysis ?? null)
      setCurrentImport(body.import ?? null)
      setSearch(''); setStatusFilter(''); setProfessionalFilter('')
      setSelectedIds(new Set())
      setCurrentImportLabel(
        `Import du ${formatDateFr(periodStart)} au ${formatDateFr(periodEnd)}`
      )
      await loadHistory()
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message === 'Session expirée.') return
      setAnalyzeError("Erreur pendant l'analyse du fichier.")
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSend = async (row: EligibleRow) => {
    const recipients = (row.destinataire_emails?.length ? row.destinataire_emails : [row.destinataire_email]).filter(Boolean).join(', ')
    if (!window.confirm(`Envoyer le sondage réel pour ${row.client_nom} ?\n\nDestinataire : ${row.destinataire_nom}\nCourriel(s) : ${recipients}\nProfessionnel : ${row.professionnel ?? 'Non renseigné'}\n\nConfirmez que ces coordonnées correspondent au bon dossier.`)) return
    setActionMessage('')
    setActionError('')
    setSendingId(row.id)

    try {
      const response = await authedFetch('/api/satisfaction/send', {
        method: 'POST',
        body: JSON.stringify({ eligibleId: row.id }),
      })
      const body = (await response.json()) as { error?: string }

      if (!response.ok) {
        setActionError(body.error ?? "Erreur pendant l'envoi.")
        return
      }

      setEligibles((previous) =>
        previous.map((item) =>
          item.id === row.id ? { ...item, statut: 'envoye' } : item
        )
      )
      setSelectedIds((previous) => {
        const next = new Set(previous)
        next.delete(row.id)
        return next
      })
      setActionMessage(`Invitation envoyée à ${row.destinataire_nom}.`)
      await loadHistory()
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message === 'Session expirée.') return
      setActionError("Erreur pendant l'envoi.")
    } finally {
      setSendingId('')
    }
  }

  const handleUpdateEligible = async (
    eligibleId: string,
    updates: { statut?: 'exclu' | 'en_attente'; destinataireEmail?: string }
  ) => {
    setActionMessage('')
    setActionError('')

    try {
      const response = await authedFetch('/api/satisfaction/import', {
        method: 'PATCH',
        body: JSON.stringify({ eligibleId, ...updates }),
      })
      const body = (await response.json()) as {
        eligible?: EligibleRow
        error?: string
      }

      if (!response.ok) {
        setActionError(body.error ?? 'Erreur pendant la mise à jour.')
        return
      }

      if (body.eligible) {
        setEligibles((previous) =>
          previous.map((item) =>
            item.id === eligibleId ? { ...item, ...body.eligible } : item
          )
        )
      }
      setEditingEmailId('')
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message === 'Session expirée.') return
      setActionError('Erreur pendant la mise à jour.')
    }
  }

  const handleBatchExclude = async () => {
    const ids = [...selectedIds]
    for (const id of ids) {
      await handleUpdateEligible(id, { statut: 'exclu' })
    }
    setSelectedIds(new Set())
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleViewImport = async (importId: string, label: string) => {
    if (viewingImport) return
    setViewingImport(importId)
    setActionMessage('')
    setActionError('')

    try {
      const response = await authedFetch(
        `/api/satisfaction/import?importId=${encodeURIComponent(importId)}`
      )
      const body = (await response.json()) as {
        eligibles?: EligibleRow[]
        import?: ImportInfo
        analysis?: SatisfactionAnalysis | null
        error?: string
      }

      if (!response.ok) {
        setActionError(body.error ?? 'Erreur pendant le chargement.')
        return
      }

      setEligibles(body.eligibles ?? [])
      setCurrentImport(body.import ?? null)
      setAnalysis(body.analysis ?? null)
      setSearch(''); setStatusFilter(''); setProfessionalFilter('')
      setSelectedIds(new Set())
      setCurrentImportLabel(label)
      setMissingEmailCount(
        (body.eligibles ?? []).filter(
          (row) => row.statut === 'en_attente' && !row.destinataire_email?.trim()
        ).length
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message === 'Session expirée.') return
      setActionError('Erreur pendant le chargement.')
    } finally {
      setViewingImport('')
    }
  }

  const previewEmail = (row: EligibleRow) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://app.psychoeducaction.com'
    return buildSatisfactionEmail({
      destinatairePrenom: getFirstName(row.destinataire_nom),
      lienReponse: `${origin}/satisfaction/reponse/${row.jeton_reponse}`,
      lienDesabonnement: `${origin}/api/satisfaction/unsubscribe?token=${row.jeton_desabonnement}`,
      professionnel: row.professionnel,
    })
  }

  if (loading || !authorized) {
    return (
      <div className="flex min-h-screen bg-[#fbf7f1]">
        <AppNav />
        <main className="flex-1 p-6 lg:ml-72">
          <p className="text-sm text-[#8a6f5d]">Chargement…</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#fbf7f1]">
      <AppNav />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:ml-72">
        <PageHeader
          title="Satisfaction des clients"
          description={`Sondage auprès des clients ayant au moins ${SATISFACTION_MIN_ENCOUNTERS} rencontres sur la période. Aucun envoi automatique : chaque invitation est vérifiée puis envoyée individuellement.`}
        />

        {actionMessage && (
          <div className="mt-4">
            <AlertBanner tone="success" title="Succès" description={actionMessage} />
          </div>
        )}
        {actionError && (
          <div className="mt-4">
            <AlertBanner tone="danger" title="Erreur" description={actionError} />
          </div>
        )}

        <SectionCard title="1. Importer un export Psylog">
          <p className="text-sm text-[#6c5a4d]">
            Fichier « Activités détaillées » (Excel). Les rencontres sont
            regroupées par client, seuls les clients avec au moins{' '}
            {SATISFACTION_MIN_ENCOUNTERS} rencontres sont retenus, et les clients
            déjà sollicités ou désabonnés sont exclus automatiquement.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={buttonClass('secondary')}
              >
                Choisir le fichier Excel
              </button>
            </div>
            <div className="flex-1 text-sm text-[#6c5a4d]">
              <p className="font-medium">{editingPeriod ? 'Période personnalisée' : 'Période détectée automatiquement'}</p>
              <p>{periodStart && periodEnd ? `Du ${formatDateFr(periodStart)} au ${formatDateFr(periodEnd)}` : 'Choisissez le fichier pour détecter ses dates.'}</p>
              <button type="button" className="mt-1 text-[#9b6a3d] underline" disabled={!encounters.length} onClick={() => {
                if (editingPeriod) {
                  const detected = detectEncounterPeriod(encounters)
                  setPeriodStart(detected?.start ?? ''); setPeriodEnd(detected?.end ?? '')
                }
                setEditingPeriod(!editingPeriod)
              }}>{editingPeriod ? 'Revenir à la période du fichier' : 'Modifier la période'}</button>
            </div>
            {editingPeriod && <><div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[#6c5a4d]">
                Début de période
              </label>
              <input
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[#6c5a4d]">
                Fin de période
              </label>
              <input
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                className={inputClass}
              />
            </div></>}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || encounters.length === 0}
              className={buttonClass('primary')}
            >
              {analyzing ? 'Analyse en cours…' : 'Analyser'}
            </button>
          </div>
          {fileName && (
            <p className="mt-3 text-sm text-[#6c5a4d]">
              Fichier : <span className="font-medium">{fileName}</span> —{' '}
              {encounters.length} rencontre(s) détectée(s)
              {periodStart && periodEnd && (
                <>
                  {' '}du {formatDateFr(periodStart)} au {formatDateFr(periodEnd)}
                </>
              )}
              .
            </p>
          )}
          {fileError && (
            <div className="mt-3">
              <AlertBanner tone="danger" title="Erreur" description={fileError} />
            </div>
          )}
          {analyzeError && (
            <div className="mt-3">
              <AlertBanner tone="danger" title="Erreur" description={analyzeError} />
            </div>
          )}
        </SectionCard>

        {currentImport && <div className="mt-6"><SectionCard title={currentImportLabel || 'Détail de l’import'}>
          <p className="text-sm text-[#6c5a4d]">{currentImport.file_name ?? 'Fichier importé'} — {currentImport.row_count} rencontre(s) détectée(s), {eligibles.length} client(s) éligible(s).</p>
          {eligibles.length === 0 && <p className="mt-2 text-sm">Aucun client éligible dans cet import. Consultez le détail de l’analyse ci-dessous pour connaître les raisons.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Rechercher<input type="search" placeholder="Client, destinataire, courriel ou professionnel" className={inputClass} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label className="text-sm">Professionnel<select className={inputClass} value={professionalFilter} onChange={e => setProfessionalFilter(e.target.value)}><option value="">Tous les professionnels</option>{professionals.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="text-sm">Statut des invitations<select className={inputClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(STATUT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="repondu">Répondu</option><option value="sans_courriel">Sans courriel</option></select></label>
          </div>
          <p className="mt-2 text-xs text-[#8a6f5d]">La recherche accepte plusieurs mots, sans distinction de casse ou d’accents. Les invitations et l’analyse sont filtrées par recherche et professionnel.</p>
        </SectionCard><ImportAnalysis analysis={analysis} query={search} professional={professionalFilter} /></div>}

        {eligibles.length > 0 && (
          <div className="mt-6">
            <SectionCard
              title={`2. Vérifier et envoyer ${currentImportLabel ? `— ${currentImportLabel}` : ''}`}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard label="Éligibles" value={String(stats.total)} />
                <StatCard label="En attente" value={String(stats.enAttente)} />
                <StatCard label="Envoyés" value={String(stats.envoyes)} />
                <StatCard label="Réponses" value={String(stats.responses)} />
                <StatCard
                  label="Sans courriel"
                  value={String(stats.sansEmail)}
                />
              </div>

              {missingEmailCount > 0 && (
                <div className="mt-4">
                  <AlertBanner
                    tone="warning"
                    title="Courriels manquants"
                    description={`${missingEmailCount} destinataire(s) sans courriel : complétez le courriel avant l'envoi (l'envoi est bloqué tant qu'il manque).`}
                  />
                </div>
              )}

              {selectedIds.size > 0 && (
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-sm text-[#6c5a4d]">
                    {selectedIds.size} sélectionné(s)
                  </span>
                  <button
                    type="button"
                    onClick={handleBatchExclude}
                    className={buttonClass('secondary')}
                  >
                    Exclure la sélection
                  </button>
                </div>
              )}

              <div className={tableShellClass}>
                <table className={`${tableClass} w-full`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>
                        <span className="sr-only">Sélection</span>
                      </th>
                      <th className={tableHeadCellClass}>Destinataire</th>
                      <th className={tableHeadCellClass}>Client</th>
                      <th className={tableHeadCellClass}>Professionnel</th>
                      <th className={tableHeadCellClass}>Rencontres</th>
                      <th className={tableHeadCellClass}>Dernière</th>
                      <th className={tableHeadCellClass}>Statut</th>
                      <th className={tableHeadCellClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {filteredEligibles.map((row) => {
                      const canAct = row.statut === 'en_attente' || row.statut === 'exclu'
                      const hasEmail = Boolean(row.destinataire_email?.trim())
                      return (
                        <tr key={row.id} className={tableRowClass}>
                          <td className={tableCellClass}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleSelected(row.id)}
                              disabled={!canAct}
                              aria-label={`Sélectionner ${row.destinataire_nom}`}
                              className="h-4 w-4 accent-[#9b6a3d]"
                            />
                          </td>
                          <td className={tableCellClass}>
                            <p className="font-medium text-[#332820]">
                              {row.destinataire_nom}
                            </p>
                            {editingEmailId === row.id ? (
                              <div className="mt-1 flex items-center gap-2">
                                <input
                                  type="email"
                                  value={editingEmailValue}
                                  onChange={(event) =>
                                    setEditingEmailValue(event.target.value)
                                  }
                                  placeholder="courriel@exemple.com"
                                  className={inputClass}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateEligible(row.id, {
                                      destinataireEmail: editingEmailValue,
                                    })
                                  }
                                  className={buttonClass('primary')}
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingEmailId('')}
                                  className={buttonClass('secondary')}
                                >
                                  Annuler
                                </button>
                              </div>
                            ) : hasEmail ? (
                              <p className="text-xs text-[#8a6f5d]">
                                {(row.destinataire_emails?.length
                                  ? row.destinataire_emails
                                  : [row.destinataire_email]
                                ).filter(Boolean).join(', ')}
                              </p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingEmailId(row.id)
                                  setEditingEmailValue('')
                                }}
                                className="mt-1 text-xs font-medium text-[#9b6a3d] underline"
                              >
                                Courriel à compléter
                              </button>
                            )}
                          </td>
                          <td className={tableCellClass}>{row.client_nom}</td>
                          <td className={tableCellClass}>
                            {row.professionnel ?? '-'}
                          </td>
                          <td className={tableCellClass}>{row.nb_rencontres}</td>
                          <td className={tableCellClass}>
                            {formatDateFr(row.derniere_rencontre)}
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone={row.reponse ? 'success' : STATUT_TONES[row.statut] ?? 'neutral'}>
                              {row.reponse ? 'Répondu' : STATUT_LABELS[row.statut] ?? row.statut}
                            </Badge>
                            {row.reponse && <p className="mt-1 text-xs">{row.reponse.note}/5 — {formatDateTimeFr(row.reponse.repondu_le)}</p>}
                            {row.dernier_envoi && <p className="mt-1 text-xs">Dernier envoi : {formatDateTimeFr(row.dernier_envoi.envoye_le)} ({row.dernier_envoi.statut === 'erreur' ? 'Échec' : 'Envoyé'})</p>}
                            {!hasEmail && <p className="mt-1 text-xs text-[#8a5633]">{satisfactionContactIssueLabel(analysis?.rows.find(item => item.clientNom === row.client_nom)?.contactIssue ?? 'missing_email')}</p>}
                          </td>
                          <td className={tableCellClass}>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setPreviewRow(row)}
                                className={buttonClass('secondary')}
                              >
                                Aperçu
                              </button>
                              {row.statut === 'en_attente' && (
                                <button
                                  type="button"
                                  onClick={() => handleSend(row)}
                                  disabled={sendingId === row.id || !hasEmail}
                                  title={
                                    hasEmail
                                      ? undefined
                                      : 'Complétez le courriel avant l’envoi.'
                                  }
                                  className={buttonClass('primary')}
                                >
                                  {sendingId === row.id
                                    ? 'Envoi…'
                                    : 'Envoyer'}
                                </button>
                              )}
                              {row.statut === 'en_attente' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateEligible(row.id, { statut: 'exclu' })
                                  }
                                  className={buttonClass('secondary')}
                                >
                                  Exclure
                                </button>
                              )}
                              {row.statut === 'exclu' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateEligible(row.id, {
                                      statut: 'en_attente',
                                    })
                                  }
                                  className={buttonClass('secondary')}
                                >
                                  Réintégrer
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {filteredEligibles.length === 0 && <p className="mt-3 text-sm">Aucune invitation ne correspond à ces filtres.</p>}
            </SectionCard>
          </div>
        )}

        {!currentImport && !analyzing && (
          <div className="mt-6">
            <EmptyState
              title="Aucune liste à vérifier"
              description="Importez un export Psylog pour générer la liste des clients éligibles, ou sélectionnez un import précédent dans l'historique."
            />
          </div>
        )}

        <div className="mt-6">
          <SectionCard title="Historique des imports">
            {historyError && (
              <div className="mb-3">
                <AlertBanner tone="danger" title="Erreur" description={historyError} />
              </div>
            )}
            {history.length === 0 ? (
              <p className="text-sm text-[#8a6f5d]">Aucun import pour le moment.</p>
            ) : (
              <div className={tableShellClass}>
                <table className={`${tableClass} w-full`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Date</th>
                      <th className={tableHeadCellClass}>Fichier</th>
                      <th className={tableHeadCellClass}>Période</th>
                      <th className={tableHeadCellClass}>Éligibles</th>
                      <th className={tableHeadCellClass}>Envoyés</th>
                      <th className={tableHeadCellClass}>Réponses</th>
                      <th className={tableHeadCellClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {history.map((item) => (
                      <tr key={item.id} className={tableRowClass}>
                        <td className={tableCellClass}>
                          {formatDateTimeFr(item.imported_at)}
                        </td>
                        <td className={tableCellClass}>
                          {item.file_name ?? '-'}
                        </td>
                        <td className={tableCellClass}>
                          {formatDateFr(item.period_start)} →{' '}
                          {formatDateFr(item.period_end)}
                        </td>
                        <td className={tableCellClass}>{item.eligible_count}</td>
                        <td className={tableCellClass}>{item.sent_count}</td>
                        <td className={tableCellClass}>{item.response_count}</td>
                        <td className={tableCellClass}>
                          <button
                            type="button"
                            disabled={Boolean(viewingImport)}
                            onClick={() =>
                              handleViewImport(
                                item.id,
                                `Import du ${formatDateFr(item.period_start)} au ${formatDateFr(item.period_end)}`
                              )
                            }
                            className={buttonClass('secondary')}
                          >
                            {viewingImport === item.id ? 'Chargement…' : 'Voir'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <TestEmailPanel authedFetch={authedFetch} />

        {previewRow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#eadfd2] bg-[#fffdf9] p-6">
              <h2 className="text-lg font-bold text-[#332820]">
                Aperçu du courriel — {previewRow.destinataire_nom}
              </h2>
              <p className="mt-1 text-sm text-[#8a6f5d]">
                Destinataire : {(previewRow.destinataire_emails?.length
                  ? previewRow.destinataire_emails
                  : [previewRow.destinataire_email]
                ).filter(Boolean).join(', ') || 'courriel manquant'}
              </p>
              <div className="mt-4 rounded-2xl border border-[#eadfd2] bg-white p-4">
                <p className="text-sm font-semibold text-[#332820]">
                  Objet : {previewEmail(previewRow).subject}
                </p>
                <iframe title="Aperçu du courriel de satisfaction" sandbox="" srcDoc={previewEmail(previewRow).html} className="mt-3 h-[650px] w-full rounded-xl border" />
              </div>
              <p className="mt-3 text-xs text-[#8a6f5d]">
                Aperçu de la version HTML utilisée pour l’envoi. Vérifiez le destinataire avant d’envoyer une invitation réelle.
              </p>
              {previewRow.reponse && <div className="mt-4 rounded-xl border p-4"><h3 className="font-semibold">Réponse reçue — {previewRow.reponse.note}/5</h3><p className="text-xs">{formatDateTimeFr(previewRow.reponse.repondu_le)}</p><p className="mt-2 whitespace-pre-wrap">{previewRow.reponse.commentaire || 'Aucun commentaire.'}</p></div>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewRow(null)}
                  className={buttonClass('secondary')}
                >
                  Fermer
                </button>
                {previewRow.statut === 'en_attente' && previewRow.destinataire_email && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewRow(null)
                      handleSend(previewRow)
                    }}
                    className={buttonClass('primary')}
                  >
                    Envoyer à ce client
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
