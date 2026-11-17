'use client'

import { useEffect, useRef, useState } from 'react'
import type { MandatePortalView } from '@/lib/clinical-mandates/types'
import { portalLoad, portalSign } from '@/lib/clinical-mandates/client'
import { ClinicalNavigationGuard } from '@/components/clinical-workspace/NavigationGuard'
import { SignatureCapture } from '@/components/clinical-mandates/SignatureCapture'
import { DocumentPreview } from '@/components/clinical-mandates/DocumentPreview'
import { audienceLabels, roleLabels, signatureFragment, timeLabel } from '@/components/clinical-mandates/model'
import { ClinicalApiError } from '@/lib/clinical-workspace/api'

export default function SignatureDemoPage() { return <ClinicalNavigationGuard><SignaturePortal /></ClinicalNavigationGuard> }
function SignaturePortal() {
  const token = useRef<string | null>(null)
  const [downloadToken, setDownloadToken] = useState<string | null>(null)
  const [view, setView] = useState<MandatePortalView | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [opened, setOpened] = useState<{ id: string; hash: string } | null>(null), [signed, setSigned] = useState(false), [now, setNow] = useState(0)
  useEffect(() => {
    let active = true
    if (!token.current) {
      const value = signatureFragment(window.location.hostname, window.location.hash)
      window.history.replaceState(null, '', window.location.pathname)
      if (!value) { setError('Invitation fictive indisponible. Rouvrez le lien local qui vous a été remis.'); setLoading(false); return }
      token.current = value
    }
    const value = token.current
    setDownloadToken(value)
    void portalLoad(value).then(result => { if (active) { setView(result); setNow(Date.now()); setError('') } }).catch(() => { if (active) { token.current = null; setDownloadToken(null); setError('Cette invitation fictive est indisponible, expirée, révoquée ou déjà utilisée.') } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(interval) }, [])
  const expired = Boolean(view && now && Date.parse(view.expiresAt) <= now)
  const reject = (cause: unknown) => { if (cause instanceof ClinicalApiError && [401, 403, 404, 410].includes(cause.status)) { token.current = null; setDownloadToken(null); setView(null); setOpened(null); setError('Cette invitation fictive n’est plus disponible. Aucun autre document ne peut être consulté.') } }
  return <main className="min-h-screen bg-[#f8f3ec] p-4 text-[#332820] sm:p-8"><div className="mx-auto grid max-w-2xl gap-5"><header className="rounded-2xl border border-[#d8b992] bg-[#fffaf3] p-5"><p className="text-sm font-bold uppercase text-amber-900">Démonstration locale — aucune signature réelle</p><h1 className="mt-2 text-2xl font-semibold">Signature de consentement fictif</h1><p className="mt-3 text-sm">Vous accédez uniquement au document et au signataire ciblés par cette invitation. Aucun compte client général, aucun courriel et aucun paiement.</p><p className="mt-2 text-xs">Le jeton du lien a été retiré de l’adresse et reste uniquement en mémoire. Pour revenir après rechargement, rouvrez le lien original encore valide.</p></header>
    {loading && <p role="status">Vérification de l’invitation locale…</p>}{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {signed ? <section role="status" className="rounded-2xl border border-green-200 bg-green-50 p-5"><h2 className="font-semibold">Signature fictive confirmée</h2><p className="mt-3 text-sm">Cette invitation a été utilisée. Les octets et l’empreinte du document signé sont conservés avec la preuve. Vous pouvez fermer cette page.</p></section> : view && <section className="grid gap-4 rounded-2xl border border-[#eadfd2] bg-white p-5"><div><h2 className="text-xl font-semibold">{view.clientName}</h2><p className="mt-1 text-sm">{view.signer.name} · {roleLabels[view.signer.role]}</p><p className="mt-1 text-sm">{audienceLabels[view.signer.audience]} · version {view.revisionNumber}</p><p className="mt-1 text-xs">Expiration : {timeLabel(view.expiresAt)}</p></div>{expired ? <p role="alert" className="text-red-800">Cette invitation a expiré. Demandez une nouvelle invitation fictive.</p> : <>
      <DocumentPreview document={view.document} downloadFormToken={downloadToken ?? undefined} onOpened={(id, hash) => setOpened({ id, hash })} />
      {view.alreadySigned ? <p className="text-sm">La signature est déjà enregistrée.</p> : <SignatureCapture expectedName={view.signer.name} documentHash={view.document.sha256} documentOpened={opened?.id === view.document.id && opened.hash === view.document.sha256} onSign={async evidence => { if (!token.current) throw new Error('Invitation indisponible.'); try { await portalSign(token.current, { documentId: view.document.id, documentHash: view.document.sha256, evidence }); setSigned(true); token.current = null; setDownloadToken(null); setOpened(null); setView(null) } catch (cause) { reject(cause); throw cause } }} />}
    </>}</section>}
  </div></main>
}
