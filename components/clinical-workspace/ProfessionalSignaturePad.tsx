'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { signatureStrokes } from '@/components/clinical-mandates/model'

type Point = { x: number; y: number }

export function ProfessionalSignaturePad({ onSave, disabled }: { onSave: (strokes: Point[][]) => Promise<boolean>; disabled: boolean }) {
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<number | null>(null)
  useEffect(() => {
    const surface = canvas.current, context = surface?.getContext('2d')
    if (!surface || !context) return
    context.clearRect(0, 0, surface.width, surface.height)
    context.lineWidth = 2
    context.lineCap = 'round'
    context.strokeStyle = '#332820'
    for (const stroke of strokes) {
      context.beginPath()
      stroke.forEach((point, index) => index ? context.lineTo(point.x * surface.width, point.y * surface.height) : context.moveTo(point.x * surface.width, point.y * surface.height))
      context.stroke()
    }
  }, [strokes])
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) }
  }
  return <div className="mt-3 grid max-w-sm gap-2"><canvas ref={canvas} width={480} height={120} aria-label="Dessiner ma signature au pointeur ou au doigt" className="h-24 w-full touch-none rounded-xl border border-[#c5a987] bg-white"
    onPointerDown={event => { if (disabled || saving || strokes.length >= 50) return; const start = point(event); pointer.current = event.pointerId; try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Continue drawing when pointer capture is unavailable. */ } setStrokes(previous => [...previous, [start]]) }}
    onPointerMove={event => { if (pointer.current !== event.pointerId || disabled || saving) return; const next = point(event); setStrokes(previous => !previous.length || previous.reduce((total, stroke) => total + stroke.length, 0) >= 2000 || previous.at(-1)!.length >= 128 ? previous : [...previous.slice(0, -1), [...previous.at(-1)!, next]]) }}
    onPointerUp={event => { if (pointer.current === event.pointerId) pointer.current = null }} onPointerCancel={() => { pointer.current = null }} />
    <div className="flex gap-2"><button type="button" className={buttonClass('secondary')} disabled={saving} onClick={() => { setStrokes([]); setMessage(''); setSaveError(false) }}>Effacer</button><button type="button" className={buttonClass('primary')} disabled={disabled || saving || !strokes.some(stroke => stroke.length > 1)} onClick={async () => { setSaving(true); setSaveError(false); try { if (await onSave(signatureStrokes(strokes))) { setStrokes([]); setMessage(clinicalUiText("Signature enregistrée dans le laboratoire fictif.","Signature enregistrée.")) } } catch { setSaveError(true); setMessage('La signature n’a pas pu être enregistrée. Vérifiez le tracé et réessayez.') } finally { setSaving(false) } }}>Enregistrer la signature</button></div>{message && <p role={saveError ? 'alert' : 'status'} className={`text-sm ${saveError ? 'text-red-700' : 'text-green-800'}`}>{message}</p>}</div>
}

export function ProfessionalSignaturePreview({ strokes }: { strokes: Point[][] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current, context = surface?.getContext('2d')
    if (!surface || !context) return
    context.clearRect(0, 0, surface.width, surface.height)
    context.lineWidth = 2
    context.lineCap = 'round'
    context.strokeStyle = '#332820'
    for (const stroke of strokes) {
      context.beginPath()
      stroke.forEach((point, index) => index ? context.lineTo(point.x * surface.width, point.y * surface.height) : context.moveTo(point.x * surface.width, point.y * surface.height))
      context.stroke()
    }
  }, [strokes])
  return <canvas ref={canvas} width={480} height={120} aria-label="Signature professionnelle enregistrée" className="mt-2 h-20 w-full max-w-xs rounded-xl border border-[#c5a987] bg-white" />
}
