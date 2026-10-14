'use client'
import { buttonClass } from '@/components/ui/index'

export function ListPagination({ page, pageCount, total, from, to, label, onPageChange }: {
  page: number; pageCount: number; total: number; from: number; to: number
  label: string; onPageChange: (page: number) => void
}) {
  if (!total) return null
  return <nav aria-label={label} className="my-3 flex flex-wrap items-center justify-between gap-3">
    <p className="text-sm text-[#7a6859]" aria-live="polite">{from}–{to} sur {total} — Page {page} sur {pageCount}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass('secondary')} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Précédent</button>
      <button type="button" className={buttonClass('secondary')} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Suivant</button>
    </div>
  </nav>
}
