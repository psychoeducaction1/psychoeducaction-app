'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { defaultInvoiceEmailTemplate, invoiceEmailFields, renderInvoiceEmail, validInvoiceEmailTemplate, type InvoiceEmailTemplateSettings } from '@/lib/clinical-finance/invoiceEmailTemplate'
import { useClinicalFormGuard } from './NavigationGuard'
import { clinicalCard, clinicalInput } from './styles'

const endpoint = '/billing/email-template'
const validSettings = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<InvoiceEmailTemplateSettings>
  return typeof v.canEdit === 'boolean' && Number.isSafeInteger(v.version) && Number(v.version) >= 0 && validInvoiceEmailTemplate(v.template)
}

export function InvoiceEmailSettings({ actor }: { actor: ClinicalActorInput }) {
  const [saved, setSaved] = useState<InvoiceEmailTemplateSettings | null>(null)
  const [draft, setDraft] = useState(defaultInvoiceEmailTemplate)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const dirty = Boolean(saved && (draft.subject !== saved.template.subject || draft.text !== saved.template.text))
  useClinicalFormGuard(dirty, busy)

  useEffect(() => {
    const abort = new AbortController()
    void clinicalRequest<InvoiceEmailTemplateSettings>(actor, endpoint, undefined, 'GET', abort.signal, undefined, validSettings)
      .then(value => { if (!abort.signal.aborted) { setSaved(value); setDraft(value.template); setError('') } })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Le modèle de facture est indisponible.') })
    return () => abort.abort()
  }, [actor, reload])

  const preview = validInvoiceEmailTemplate(draft) ? renderInvoiceEmail(draft, 12345, {
    nom_client: 'Client fictif', nom_payeur: 'Payeur fictif', dates_prestations: '20 novembre 2026', montant_total: '135,00 $',
  }) : null
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!saved?.canEdit || !preview || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const value = await clinicalRequest<InvoiceEmailTemplateSettings>(actor, endpoint, {
        subject: draft.subject, text: draft.text, expectedVersion: saved.version,
      }, 'POST', undefined, undefined, validSettings)
      setSaved(value); setDraft(value.template); setMessage('Le modèle de facture est enregistré.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'L’enregistrement reste à vérifier.')
    } finally { setBusy(false) }
  }

  return <section className={clinicalCard}>
    <h3 className="text-lg font-semibold">Facture au client</h3>
    <p className="mt-2 text-sm">Le champ <code>{'{{numero_facture}}'}</code> insère le numéro dans l’objet et le message. Le PDF de la facture est joint à l’envoi.</p>
    <details className="mt-2 text-sm"><summary className="cursor-pointer">Champs automatiques</summary><dl className="mt-2 grid gap-1">
      {Object.entries(invoiceEmailFields).map(([key, label]) => <div key={key} className="flex flex-wrap gap-2"><dt><code>{'{{' + key + '}}'}</code></dt><dd>{label}</dd></div>)}
    </dl></details>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!saved && (error
      ? <button type="button" className={buttonClass('secondary') + ' mt-3'} onClick={() => { setError(''); setReload(value => value + 1) }}>Réessayer</button>
      : <p role="status" className="mt-3">Chargement du modèle…</p>)}
    {saved && <form className="mt-4 grid gap-4 text-sm" onSubmit={event => void save(event)}>
      <label>Objet<input className={clinicalInput} value={draft.subject} maxLength={200} readOnly={!saved.canEdit} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label>
      <label>Message<textarea className={clinicalInput} value={draft.text} rows={8} maxLength={4000} readOnly={!saved.canEdit} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
      {preview ? <div className="rounded-lg border p-4"><h4 className="mb-2 font-semibold">Aperçu avec une facture fictive</h4><p className="font-medium">{preview.subject}</p><p className="mt-2 whitespace-pre-wrap break-words">{preview.text}</p></div>
        : <p>Conservez le numéro de facture dans l’objet et le message et utilisez les champs automatiques de la liste.</p>}
      {saved.canEdit && <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass('primary')} disabled={!dirty || !preview || busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        {error && <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={() => { if (!dirty || window.confirm('Remplacer la saisie par le modèle enregistré ?')) setReload(value => value + 1) }}>Recharger le modèle enregistré</button>}
      </div>}
    </form>}
  </section>
}
