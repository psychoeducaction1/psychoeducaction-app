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
  const [fileError, setFileError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  const [eligibles, setEligibles] = useState<EligibleRow[]>([])
  const [currentImportLabel, setCurrentImportLabel] = useState('')
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

      if (profileError || profile?.role !== 'direction') {
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
    return { total, enAttente, envoyes, sansEmail }
  }, [eligibles])

  const handleFileChange = async (file: File | null) => {
    setFileError('')
    setAnalyzeError('')
    setEligibles([])
    setCurrentImportLabel('')

    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: false,
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
          periodStart,
          periodEnd,
          fileName,
        }),
      })
      const body = (await response.json()) as {
        eligibles?: EligibleRow[]
        missingEmailCount?: number
        import?: { id: string }
        error?: string
      }

      if (!response.ok) {
        setAnalyzeError(body.error ?? "Erreur pendant l'analyse.")
        return
      }

      setEligibles(body.eligibles ?? [])
      setMissingEmailCount(body.missingEmailCount ?? 0)
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
    setActionMessage('')
    setActionError('')

    try {
      const response = await authedFetch(
        `/api/satisfaction/import?importId=${encodeURIComponent(importId)}`
      )
      const body = (await response.json()) as {
        eligibles?: EligibleRow[]
        error?: string
      }

      if (!response.ok) {
        setActionError(body.error ?? 'Erreur pendant le chargement.')
        return
      }

      setEligibles(body.eligibles ?? [])
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
    }
  }

  const previewEmail = (row: EligibleRow) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://app.psychoeducaction.com'
    return buildSatisfactionEmail({
      destinatairePrenom: getFirstName(row.destinataire_nom),
      lienReponse: `${origin}/satisfaction/reponse/${row.jeton_reponse}`,
      lienDesabonnement: `${origin}/api/satisfaction/unsubscribe?token=${row.jeton_desabonnement}`,
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
      <main className="flex-1 p-4 sm:p-6 lg:ml-72">
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
            <div className="flex-1">
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
            </div>
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

        {eligibles.length > 0 && (
          <div className="mt-6">
            <SectionCard
              title={`2. Vérifier et envoyer ${currentImportLabel ? `— ${currentImportLabel}` : ''}`}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Éligibles" value={String(stats.total)} />
                <StatCard label="En attente" value={String(stats.enAttente)} />
                <StatCard label="Envoyés" value={String(stats.envoyes)} />
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
                <table className={tableClass}>
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
                    {eligibles.map((row) => {
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
                            <Badge tone={STATUT_TONES[row.statut] ?? 'neutral'}>
                              {STATUT_LABELS[row.statut] ?? row.statut}
                            </Badge>
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
            </SectionCard>
          </div>
        )}

        {eligibles.length === 0 && !analyzing && (
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
                <table className={tableClass}>
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
                            onClick={() =>
                              handleViewImport(
                                item.id,
                                `Import du ${formatDateFr(item.period_start)} au ${formatDateFr(item.period_end)}`
                              )
                            }
                            className={buttonClass('secondary')}
                          >
                            Voir
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
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[#332820]">
                  {previewEmail(previewRow).text}
                </pre>
              </div>
              <p className="mt-3 text-xs text-[#8a6f5d]">
                Aperçu de la version texte. La version envoyée inclut aussi une
                mise en forme HTML avec un bouton « Répondre au sondage ».
              </p>
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
