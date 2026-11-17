'use client'

import { useEffect, useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'

type PortalDocument = {
  signerName: string
  audience: 'clinical' | 'administrative'
  documentHash: string
  documentBase64: string
  previewBase64: string
  signaturePlacement: Placement
  expiresAt: string
}
type Placement = { page: number; x: number; y: number }
const endpoint = '/api/clinical-workspace/mandates/portal'
async function portal(path: 'open' | 'sign', data: Record<string, unknown>) {
  const response = await fetch(`${endpoint}/${path}`, {
    method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Ce lien est expiré, révoqué ou déjà utilisé.')
  return response.json()
}
function pdfUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}
export default function RealMandatePlacedSignaturePortal() {
  const token = useRef<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pdfHolder = useRef<HTMLDivElement>(null)
  const signatureArea = useRef<HTMLButtonElement>(null)
  const [document, setDocument] = useState<PortalDocument | null>(null)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [rendered, setRendered] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [focusZone, setFocusZone] = useState(false)
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(true)
  const [signing, setSigning] = useState(false)
  const [signedPdf, setSignedPdf] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const value = fragment.get('jeton')
    window.history.replaceState(null, '', window.location.pathname)
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      setError('Lien absent. Rouvrez le courriel d’invitation.'); setBusy(false); return
    }
    token.current = value
    let active = true
    void portal('open', { token: value }).then(result => {
      if (active) setDocument(result.document as PortalDocument)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Lien indisponible.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!document || !canvas.current || !pdfHolder.current) return
    let active = true
    let loading: { destroy(): Promise<void> } | undefined
    setRendered(false)
    void (async () => {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const bytes = Uint8Array.from(atob(document.previewBase64), character => character.charCodeAt(0))
      const task = pdfjs.getDocument({ data: bytes })
      loading = task
      const pdf = await task.promise
      if (!active) return
      setPageCount(pdf.numPages)
      const pdfPage = await pdf.getPage(page)
      if (!active || !canvas.current || !pdfHolder.current) return
      const natural = pdfPage.getViewport({ scale: 1 })
      const width = Math.min(pdfHolder.current.clientWidth, 820)
      const scale = width / natural.width
      const pixelRatio = window.devicePixelRatio || 1
      const viewport = pdfPage.getViewport({ scale: scale * pixelRatio })
      canvas.current.width = Math.round(viewport.width)
      canvas.current.height = Math.round(viewport.height)
      canvas.current.style.width = `${width}px`
      canvas.current.style.height = `${natural.height * scale}px`
      const context = canvas.current.getContext('2d')
      if (!context) throw new Error('Aperçu PDF indisponible.')
      await pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport }).promise
      if (active) setRendered(true)
    })().catch(() => { if (active) setError('Le PDF ne peut pas être affiché ici.') })
    return () => { active = false; void loading?.destroy() }
  }, [document, page])
  useEffect(() => () => { if (signedPdf) URL.revokeObjectURL(signedPdf) }, [signedPdf])
  useEffect(() => {
    if (focusZone && rendered && page === document?.signaturePlacement.page && signatureArea.current) {
      signatureArea.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      signatureArea.current.focus({ preventScroll: true })
      setFocusZone(false)
    }
  }, [focusZone, rendered, page, document])
  function goToSignature() {
    if (!document) return
    setFocusZone(true)
    setPage(document.signaturePlacement.page)
    if (page === document.signaturePlacement.page && rendered) signatureArea.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function choosePlacement() {
    if (!rendered || !document || page !== document.signaturePlacement.page) return
    setPlacement(document.signaturePlacement)
    setError('')
  }
  async function sign() {
    if (!document || !token.current || !placement || !attested || signing) return
    setSigning(true)
    setError('')
    try {
      const result = await portal('sign', { token: token.current, documentHash: document.documentHash,
        mode: 'remote_typed', evidence: {
          name: document.signerName, attested: true, style: 'caveat', placement, renderVersion: 3,
        } })
      if (typeof result.signedPdfBase64 !== 'string') throw new Error('PDF signé indisponible.')
      setSignedPdf(pdfUrl(result.signedPdfBase64))
      token.current = null
      const signedBase64: string = result.signedPdfBase64
      setDocument(previous => previous ? { ...previous, previewBase64: signedBase64 } : previous)
      setPlacement(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Signature indisponible.')
    } finally { setSigning(false) }
  }
  return <main className="min-h-screen bg-[#f8f3ec] p-4 text-[#332820] sm:p-8">
    <style>{`@font-face{font-family:PEACaveat;src:url('/fonts/SignatureCursive.ttf') format('truetype');font-display:swap}`}</style>
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="rounded-2xl border border-[#d8b992] bg-[#fffaf3] p-5">
        <h1 className="text-2xl font-semibold">Convention de consentement</h1>
        <p className="mt-2">{signedPdf ? 'Votre signature est enregistrée. Le document signé reste consultable ci-dessous.' : 'Lisez le PDF, puis cliquez dans la zone de signature indiquée.'}</p>
      </header>
      {busy && <p role="status">Vérification de l’invitation…</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">{error}</p>}
      {signedPdf && <section role="status" className="flex flex-wrap items-center gap-4 rounded-xl border border-green-200 bg-green-50 p-4">
        <p>Signature enregistrée sur le PDF. Ce lien ne peut plus être utilisé.</p>
        <a className={buttonClass()} href={signedPdf} target="_blank" rel="noopener noreferrer">Voir le PDF signé</a>
        <a className={buttonClass()} href={signedPdf} download="convention-signee.pdf">Télécharger le PDF signé</a>
      </section>}
      {document && <section className="space-y-4 rounded-2xl border border-[#d8b992] bg-white p-5">
        <p><strong>{document.signerName}</strong> · {document.audience === 'clinical' ? 'Consentement clinique' : 'Convention administrative'}</p>
        {!signedPdf && <p>Invitation valide jusqu’au {new Date(document.expiresAt).toLocaleString('fr-CA')}.</p>}
        {!signedPdf && <div className="flex flex-wrap items-center gap-3">
          <button className={buttonClass()} type="button" onClick={goToSignature} disabled={!pageCount}>Signer le document</button>
        </div>}
        <div ref={pdfHolder} className="overflow-x-auto rounded-lg border border-[#d8b992] bg-neutral-100">
          <div className="relative mx-auto w-fit">
            <canvas ref={canvas} className="block" aria-label={`Page ${page} du PDF`} />
            {!signedPdf && rendered && page === document.signaturePlacement.page && <button ref={signatureArea} type="button" onClick={choosePlacement}
              aria-label="Apposer ma signature dans la zone réservée"
              className="absolute flex items-center overflow-hidden rounded border-2 border-dashed border-amber-600 bg-amber-100/80 px-2 text-left text-amber-950 hover:bg-amber-200 focus:outline-4 focus:outline-amber-400"
              style={{ left: '10%', top: `${(1 - document.signaturePlacement.y - 0.03) * 100}%`, width: '78%', height: '7%' }}>
              {placement ? <span className="truncate text-[#1f2945]" style={{ fontFamily: 'PEACaveat,cursive', fontSize: 'clamp(16px,3vw,30px)' }}>{document.signerName}</span>
                : <span className="text-xs sm:text-sm">Cliquer ici pour signer</span>}
            </button>}
          </div>
        </div>
        {pageCount > 1 && <nav aria-label="Pages du document" className="flex items-center justify-center gap-4">
          <button type="button" aria-label="Page précédente" title="Page précédente" disabled={page <= 1}
            onClick={() => setPage(value => value - 1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8b992] bg-white text-xl hover:bg-[#f6eadb] disabled:cursor-not-allowed disabled:opacity-40">‹</button>
          <span aria-live="polite" className="text-sm">{page} / {pageCount}</span>
          <button type="button" aria-label="Page suivante" title="Page suivante" disabled={page >= pageCount}
            onClick={() => setPage(value => value + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8b992] bg-white text-xl hover:bg-[#f6eadb] disabled:cursor-not-allowed disabled:opacity-40">›</button>
        </nav>}
        {!signedPdf && <><p>{placement ? 'Signature placée dans la zone indiquée.' : 'La signature se place uniquement dans votre zone jaune.'}</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} />
          J’ai lu le document et je confirme apposer ma signature électronique.
        </label>
        <button className={buttonClass()} type="button" disabled={!placement || !attested || signing}
          onClick={() => void sign()}>{signing ? 'Signature en cours…' : 'Confirmer la signature'}</button></>}
      </section>}
    </div>
  </main>
}
