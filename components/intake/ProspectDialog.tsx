'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { buttonClass } from '@/components/ui/index'

export function ProspectDialog({ title, onClose, children, compactHeader = false }: {
  title: ReactNode
  onClose: () => void
  compactHeader?: boolean
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.showModal()
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return <dialog
    ref={dialogRef}
    aria-labelledby="prospect-dialog-title"
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-0 text-[#332820] shadow-xl backdrop:bg-black/40"
    style={compactHeader ? { minWidth: 0 } : undefined}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}
  >
    <header className={'sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#eadfd2] bg-[#fffdf9] ' + (compactHeader ? 'px-3 py-3 sm:px-5' : 'px-5 py-4')}>
      <h2 id="prospect-dialog-title" className={compactHeader ? 'min-w-0 flex-1 text-lg font-semibold sm:text-xl' : 'text-xl font-semibold'}>{title}</h2>
      <button type="button" autoFocus className={buttonClass('secondary')} style={compactHeader ? { width: 40, minWidth: 40, maxWidth: 40, flex: '0 0 40px', paddingInline: 0 } : undefined} onClick={onClose} aria-label="Fermer la fiche"><X className="h-4 w-4" />{!compactHeader && <span className="hidden sm:inline">Fermer</span>}</button>
    </header>
    <div className={compactHeader ? 'min-w-0 p-3 sm:p-5' : 'p-5'}>{children}</div>
  </dialog>
}
