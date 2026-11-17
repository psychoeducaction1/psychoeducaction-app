'use client'

import { useCallback, useEffect, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'
import { encounterDatesFromPdf, identityFromPdf, isBillingStatement, requesterNamesFromPdf,
  resolveLegacyIdentity, serviceFromPdf,
  type LegacyCandidate, type LegacyIdentity } from '@/lib/clinical-real/legacyBatchMatch'
import { realLegacyImportPdf, type RealDirectoryEntry } from '@/lib/clinical-real/workspaceClient'

type ImportRow = {
  file: File; bytes: Uint8Array; sha256: string; pageCount: number
  identity: LegacyIdentity | null; requesterNames: string[]; dates: string[]; pages: string[]
  target: string; firstName: string; lastName: string; birthDate: string; service: string
  suggestion?: LegacyCandidate
  state: 'ready' | 'unresolved' | 'imported' | 'error'; error?: string; notice?: string
}

const maximumBytes = 5_242_880
const maximumFiles = 10

function asBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
  return btoa(raw)
}

export async function readPdf(file: File, allowFinancialArchive = false): Promise<Omit<ImportRow, 'target' | 'firstName' | 'lastName' | 'birthDate' | 'state'>> {
  if (file.size < 100 || file.size > maximumBytes) throw new Error('Chaque PDF doit faire entre 100 octets et 5 Mo.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Un fichier sélectionné n’est pas un PDF.')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const pages: string[] = []
  let pageCount = 0
  try {
    const pdf = await task.promise
    if (pdf.numPages > 500) throw new Error('Un PDF dépasse 500 pages.')
    pageCount = pdf.numPages
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item
        ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}` : '').join('').trim())
    }
  } finally { await task.destroy() }
  if (!pages.some(Boolean)) throw new Error('Un PDF ne contient pas de texte lisible. Exportez-le avec reconnaissance de texte.')
  if (!allowFinancialArchive && isBillingStatement(pages)) throw new Error('Ce PDF est un relevé de facturation, pas un dossier de notes cliniques.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  return { file, bytes, sha256, pageCount, identity: identityFromPdf(file.name, pages),
    requesterNames: requesterNamesFromPdf(pages),
    dates: encounterDatesFromPdf(pages), pages,
    service: serviceFromPdf(pages) }
}

function labelFor(row: ImportRow): string {
  const initials = `${row.firstName[0] ?? ''}${row.lastName[0] ?? ''}`.toLocaleUpperCase('fr-CA')
  return `${initials} — Notes cliniques historiques`
}

export default function RealLegacyBatchImport({ onImported }: { onImported: () => Promise<void> }) {
  const [candidates, setCandidates] = useState<LegacyCandidate[]>([])
  const [candidatesLoaded, setCandidatesLoaded] = useState(false)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState('')

  const loadCandidates = useCallback(async () => {
      // Same canonical directory RPC as the former API route. The temporary
      // importer shares the authenticated session, without a parallel workspace.
      const [directory, assignments] = await Promise.all([
        supabase.rpc('clinical_workspace_directory', { p_search: '' }),
        supabase.rpc('clinical_my_import_assignments'),
      ])
      if (directory.error || !Array.isArray(directory.data) || assignments.error) throw new Error('Dossiers ou assignations indisponibles.')
      const available: LegacyCandidate[] = [
        ...(directory.data as RealDirectoryEntry[]).filter(item => item.caseId).map(item => ({
          id: item.caseId!, kind: 'case' as const, caseId: item.caseId!,
          firstName: item.firstName, lastName: item.lastName, birthDate: item.birthDate,
          caseStatus: item.caseStatus === 'open' ? 'open' as const : 'closed' as const,
        })),
        ...((assignments.data ?? []) as { id: string; firstName: string; lastName: string;
          birthDate: string | null; caseId: string | null; requesterNames?: string[] }[]).map(item => ({
          id: item.id, kind: 'assignment' as const, caseId: item.caseId ?? undefined,
          firstName: item.firstName, lastName: item.lastName, birthDate: item.birthDate,
          requesterNames: item.requesterNames ?? [] })),
      ]
      setCandidates(available); setCandidatesLoaded(true)
  }, [])

  useEffect(() => {
    void loadCandidates().catch(cause => setError(cause instanceof Error ? cause.message : 'Liste indisponible.'))
  }, [loadCandidates])

  const chooseFiles = async (files: File[]) => {
    if (busy || !candidatesLoaded) return
    setError(''); setMessage(''); setProgress(''); setRows([])
    if (!files.length) return
    if (files.length > maximumFiles) { setError(`Choisissez au plus ${maximumFiles} PDF par lot.`); return }
    setBusy(true)
    try {
      const results = await Promise.allSettled(files.map(file => readPdf(file)))
      const examined = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const rejected = results.flatMap((result, index) => result.status === 'rejected'
        ? [`${files[index].name} : ${result.reason instanceof Error ? result.reason.message : 'Lecture impossible.'}`] : [])
      if (rejected.length) setError(rejected.join(' '))
      if (!examined.length) return
      if (new Set(examined.map(row => row.sha256)).size !== examined.length)
        throw new Error('Le lot contient deux fois le même PDF.')
      const prepared: ImportRow[] = examined.map(row => {
        const resolution = resolveLegacyIdentity(row.identity, candidates, row.requesterNames)
        return { ...row,
          target: resolution.kind === 'matched' ? `${resolution.candidate.kind}:${resolution.candidate.id}`
            : resolution.kind === 'new' ? 'new' : '',
          firstName: row.identity?.firstName ?? '', lastName: row.identity?.lastName ?? '',
          birthDate: row.identity?.birthDate ?? '',
          suggestion: resolution.kind === 'suggested' ? resolution.candidate : undefined,
          state: resolution.kind === 'unresolved' ? 'unresolved' : 'ready',
          error: resolution.kind === 'unresolved' ? resolution.reason === 'ambiguous'
            ? 'Plusieurs dossiers portent ce nom. Ce PDF reste en attente pour éviter un mauvais raccord.'
            : resolution.reason === 'archived'
              ? 'Ce client a déjà un dossier archivé. Ce PDF reste en attente pour éviter de créer un doublon actif.'
              : 'Aucun nom de client fiable n’a été trouvé dans ce PDF. Ce PDF reste en attente.' : undefined }
      })
      const keys = prepared.map(row => row.target === 'new'
        ? `new:${row.firstName} ${row.lastName}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        : row.target).filter(Boolean)
      setRows(prepared.map(row => {
        const key = row.target === 'new'
          ? `new:${row.firstName} ${row.lastName}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          : row.target
        return key && keys.filter(item => item === key).length > 1
          ? { ...row, target: '', state: 'unresolved' as const,
            error: 'Plusieurs PDF correspondent au même client dans ce lot. Regroupez-les en un seul PDF.' }
          : row
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lecture des PDF impossible.') }
    finally { setBusy(false) }
  }

  const update = (index: number, change: Partial<ImportRow>) =>
    setRows(previous => previous.map((row, position) => position === index ? { ...row, ...change } : row))

  const importAll = async () => {
    if (busy || !rows.some(row => row.target && row.state !== 'imported')) return
    setBusy(true); setError(''); setMessage(''); setProgress('')
    let completed = 0
    let failed = 0
    try {
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        if (!row.target || row.state === 'imported') continue
        setProgress(`PDF ${index + 1} sur ${rows.length} : archivage de ${row.file.name}…`)
        try {
          let caseId: string
          if (row.target === 'new') {
            const { data, error: createError } = await supabase.rpc('clinical_import_my_new_case_pdf', {
              p_source_id: `psylog-${row.sha256}`, p_first_name: row.firstName.trim(),
              p_last_name: row.lastName.trim(), p_birth_date: row.birthDate || null,
              p_service: row.service,
              p_label: labelFor(row), p_page_count: row.pageCount, p_sha256: row.sha256,
              p_base64: asBase64(row.bytes),
            })
            if (createError || typeof data?.caseId !== 'string')
              throw new Error('Ce client pourrait déjà exister dans l’historique ou dans un autre dossier. L’import de ce PDF reste en attente : faites vérifier la correspondance par l’administration.')
            caseId = data.caseId
          } else {
            const [kind, id] = row.target.split(':')
            if (kind === 'case') caseId = id
            else {
              const { data, error: linkError } = await supabase.rpc('clinical_link_my_existing_assignment', { p_assignment_id: id })
              if (linkError || typeof data?.caseId !== 'string') throw new Error('Raccord de l’assignation impossible.')
              caseId = data.caseId
            }
          }
          const chosen = candidates.find(candidate => `${candidate.kind}:${candidate.id}` === row.target)
          if (row.target !== 'new') await realLegacyImportPdf({ caseId, sourceId: `psylog-${row.sha256}`,
            label: labelFor(chosen ? { ...row, firstName: chosen.firstName, lastName: chosen.lastName } : row),
            sha256: row.sha256, base64: asBase64(row.bytes), pageCount: row.pageCount })
          const notice = 'PDF archivé. La dernière note sera accessible directement dans le dossier.'
          update(index, { state: 'imported', bytes: new Uint8Array(0), pages: [], error: undefined, notice }); completed++
        } catch (cause) {
          update(index, { state: 'error', error: cause instanceof Error ? cause.message : 'Import interrompu.' })
          failed++
        }
      }
      if (completed) await loadCandidates()
      await onImported()
      if (failed) setError(`${failed} PDF n’ont pas été importés. Ils restent disponibles pour une vérification ciblée.`)
      if (completed) setMessage(`${completed} PDF archivé(s). La dernière note de chaque dossier reste consultable; aucune facture ni rencontre n’a été créée.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import interrompu.') }
    finally { setBusy(false); setProgress('') }
  }

  return <section className="mt-5 rounded-xl border bg-white p-4" aria-label="Import groupé de dossiers">
    <div className="space-y-4">
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</p>}
      {message && <p role="status" className="rounded bg-green-50 p-2 text-green-800">{message}</p>}
      {progress && <p role="status" className="rounded bg-slate-50 p-2 text-slate-800">{progress}</p>}
      <label className="block rounded-lg border-2 border-dashed p-4" onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); void chooseFiles(Array.from(event.dataTransfer.files)) }}>
        {candidatesLoaded ? 'Glisser les PDF ici ou les choisir' : 'Chargement des dossiers accessibles…'}
        <input className="mt-2 block w-full" type="file" accept="application/pdf,.pdf" multiple disabled={!candidatesLoaded || busy}
          onChange={event => void chooseFiles(Array.from(event.target.files ?? []))} />
      </label>
      {!!rows.length && <p role="status" className="text-sm">{rows.filter(row => row.state === 'imported').length} PDF importé(s) · {rows.filter(row => row.target && row.state === 'ready').length} prêt(s) · {rows.filter(row => row.state === 'unresolved' || row.state === 'error').length} à vérifier</p>}
      {rows.filter(row => row.state === 'unresolved' || row.state === 'error' || row.suggestion).map(row => {
        return <div key={row.sha256} className="rounded-lg border p-3 text-sm">
          <strong>{row.file.name}</strong><span className="ml-2">{row.pageCount} page(s)</span>
          <p>Nom repéré : {row.identity ? `${row.identity.firstName} ${row.identity.lastName}` : 'non détecté'} ·
            {row.dates.length ? ` ${row.dates.length} date(s) de rencontre repérée(s)` : ' aucune date de rencontre repérée'}</p>
          {row.suggestion && !row.target && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p>Ce PDF concerne-t-il le même client que « {row.suggestion.firstName} {row.suggestion.lastName} » ?</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={buttonClass('secondary')} onClick={() => update(rows.indexOf(row), {
                target: `${row.suggestion!.kind}:${row.suggestion!.id}`, suggestion: undefined,
                state: 'ready', error: undefined,
              })}>Oui, associer</button>
              <button type="button" className={buttonClass('secondary')} onClick={() => update(rows.indexOf(row), {
                target: row.identity ? 'new' : '', suggestion: undefined,
                state: row.identity ? 'ready' : 'unresolved',
                error: row.identity ? undefined : 'Aucun autre nom fiable : ce PDF reste en attente.',
              })}>Non</button>
            </div>
          </div>}
          {row.state === 'unresolved' && <p className="mt-1 text-amber-800">À rapprocher séparément. Les autres PDF du lot peuvent être importés.</p>}
          {row.state === 'imported' && <p className="text-green-800">Importé</p>}
          {row.notice && <p className="text-amber-800">{row.notice}</p>}
          {row.error && <p className="text-red-800">{row.error}</p>}
        </div>
      })}
      {!!rows.length && <button className={buttonClass('primary')}
        disabled={busy || !rows.some(row => row.target && row.state !== 'imported')}
        onClick={() => void importAll()}>{busy ? 'Import en cours…' : `Importer ${rows.filter(row => row.target && row.state !== 'imported').length} PDF automatiquement`}</button>}
    </div>
  </section>
}
