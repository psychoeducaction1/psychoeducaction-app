'use client'

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import type { SignatureEvidence } from '@/lib/clinical-mandates/types'
import { signatureStrokes } from './model'
import { Field, inputClass } from './primitives'

type Point = { x: number; y: number }
export function SignatureCapture({ expectedName, documentHash, documentOpened, disabled = false, successMessage = 'Signature fictive confirmée.', onSign }: { expectedName: string; documentHash: string; documentOpened: boolean; disabled?: boolean; successMessage?: string; onSign: (evidence: SignatureEvidence) => Promise<void> }) {
  const [name, setName] = useState(''), [method, setMethod] = useState<'drawn' | 'typed'>('drawn'), [strokes, setStrokes] = useState<Point[][]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [signed, setSigned] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null), pointer = useRef<number | null>(null)
  const guard = useClinicalFormGuard(Boolean(name || strokes.length), busy)
  useEffect(() => {
    const surface = canvas.current, context = surface?.getContext('2d')
    if (!surface || !context) return
    context.clearRect(0, 0, surface.width, surface.height); context.lineWidth = 2; context.lineCap = 'round'; context.strokeStyle = '#332820'
    for (const stroke of strokes) { context.beginPath(); stroke.forEach((point, index) => { const x = point.x * surface.width, y = point.y * surface.height; if (!index) context.moveTo(x, y); else context.lineTo(x, y) }); context.stroke() }
  }, [strokes])
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) }
  }
  return <form className="mt-4 grid gap-4" onSubmit={async event => {
    event.preventDefault(); if (busy || disabled) return
    setError('')
    if (!documentOpened) { setError('Ouvrez la convention avant de confirmer la signature.'); return }
    const normalized = (value: string) => value.trim().toLocaleLowerCase('fr')
    if (method === 'typed' && normalized(name) !== normalized(expectedName)) { setError('Saisissez le nom du signataire désigné : ' + expectedName); return }
    if (method === 'drawn' && !strokes.some(stroke => stroke.length > 1)) { setError('Dessinez votre signature avant de confirmer.'); return }
    guard.markPending(); setBusy(true)
    try { await onSign(method === 'typed' ? { name: expectedName, attested: true } : { name: expectedName, attested: true, strokes: signatureStrokes(strokes) }); guard.markSaved(); setName(''); setStrokes([]); setSigned(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Signature non confirmée. Votre saisie est conservée.') }
    finally { guard.markSettled(); setBusy(false) }
  }}>
    <p className="text-sm">Signature de <strong>{expectedName}</strong></p>
    <fieldset disabled={busy || disabled} className="grid gap-3"><div className="flex gap-2"><button type="button" className={buttonClass(method === 'drawn' ? 'primary' : 'secondary')} aria-pressed={method === 'drawn'} onClick={() => setMethod('drawn')}>Dessiner</button><button type="button" className={buttonClass(method === 'typed' ? 'primary' : 'secondary')} aria-pressed={method === 'typed'} onClick={() => setMethod('typed')}>Au clavier</button></div>
      {method === 'typed' ? <Field label="Nom du signataire"><input required maxLength={200} autoComplete="off" value={name} onChange={event => { setName(event.target.value); setSigned(false) }} className={inputClass} /></Field> : <div><canvas ref={canvas} width={640} height={180} aria-label="Dessiner la signature au pointeur ou au doigt" className="h-40 w-full touch-none rounded-xl border border-[#c5a987] bg-white" onPointerDown={event => {
        if (busy || disabled || strokes.length >= 50) return
        const first = point(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); setStrokes(previous => [...previous, [first]])
      }} onPointerMove={event => {
        if (pointer.current !== event.pointerId || busy || disabled) return
        const next = point(event)
        setStrokes(previous => { if (!previous.length || previous.reduce((sum, stroke) => sum + stroke.length, 0) >= 2000 || previous[previous.length - 1].length >= 128) return previous; return [...previous.slice(0, -1), [...previous[previous.length - 1], next]] })
      }} onPointerUp={event => { if (pointer.current === event.pointerId) pointer.current = null }} onPointerCancel={() => { pointer.current = null }} /><button type="button" className={buttonClass('ghost') + ' mt-2'} onClick={() => { pointer.current = null; setStrokes([]) }}>Effacer le dessin</button></div>}
      <details className="text-xs text-[#8a6f5d]"><summary>Référence du document signé</summary><span className="break-all font-mono">SHA-256 : {documentHash}</span></details>
    </fieldset>
    {!documentOpened && <p className="text-sm text-amber-900">Ouvrez la convention avant de signer.</p>}{error && <p role="alert" className="text-sm text-red-800">{error}</p>}{signed && <p role="status" className="text-sm text-green-800">{successMessage}</p>}
    <button className={buttonClass('primary')} disabled={busy || disabled || !documentOpened}>{busy ? 'Confirmation…' : 'Confirmer la signature'}</button>
  </form>
}
