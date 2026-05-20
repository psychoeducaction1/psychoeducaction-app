import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'muted'
type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-[#dfd0bf] bg-[#fbf6ef] text-[#6c5a4d]',
  success: 'border-[#d6c7aa] bg-[#f1ead9] text-[#5f5932]',
  warning: 'border-[#ead2bd] bg-[#fbf1e7] text-[#8a5633]',
  muted: 'border-[#eadfd2] bg-[#fffdf9] text-[#8a6f5d]',
}

const buttonTones: Record<ButtonTone, string> = {
  primary:
    'bg-[#8a5633] text-white hover:bg-[#6d3f1f] disabled:bg-[#c8b8a8]',
  secondary:
    'border border-[#dfd0bf] bg-white text-[#5d4a3d] hover:border-[#c98b52] hover:text-[#6d3f1f] disabled:text-[#a89686]',
  danger:
    'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:text-red-300',
  ghost:
    'bg-transparent text-[#6c5a4d] hover:bg-[#f5ebe0] hover:text-[#3b2d24] disabled:text-[#a89686]',
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: BadgeTone
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-[#dfd0bf] bg-[#fbf6ef] px-6 py-8 text-center">
      <p className="text-sm font-semibold text-[#5d4a3d]">{title}</p>
      {description && (
        <p className="mt-2 text-sm leading-6 text-[#8a6f5d]">{description}</p>
      )}
    </div>
  )
}

export function buttonClass(tone: ButtonTone = 'primary'): string {
  return `inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed ${buttonTones[tone]}`
}

export function getAssignmentRequestStatus({
  isActive,
  remainingCount,
  requestedCount,
}: {
  isActive: boolean | null | undefined
  remainingCount: number | null | undefined
  requestedCount: number | null | undefined
}): { label: string; tone: BadgeTone } {
  if (!isActive) {
    return { label: 'demande inactive', tone: 'muted' }
  }

  if ((remainingCount ?? 0) === 0 && (requestedCount ?? 0) > 0) {
    return { label: 'demande complétée', tone: 'success' }
  }

  return { label: 'demande en cours', tone: 'warning' }
}

export const tableShellClass =
  'overflow-x-auto rounded-2xl border border-[#eadfd2] bg-[#fffdf9] shadow-[0_1px_2px_rgba(72,49,30,0.06)]'

export const tableClass = 'min-w-full divide-y divide-[#eadfd2] text-sm'

export const tableHeaderClass = 'sticky top-0 z-10 bg-[#f6eee4] text-left'

export const tableHeadCellClass =
  'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]'

export const tableBodyClass = 'divide-y divide-[#f0e5d9]'

export const tableRowClass = 'transition hover:bg-[#fbf6ef]'

export const tableCellClass = 'px-4 py-3 align-top text-[#6c5a4d]'
