import type { ReactNode } from 'react'
import { Badge, type BadgeTone } from '@/components/Ui'

export {
  Badge,
  buttonClass,
  getAssignmentRequestStatus,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/Ui'
export type { BadgeTone } from '@/components/Ui'

type StatTone = 'neutral' | 'warm' | 'success'

const statToneClass: Record<StatTone, string> = {
  neutral: 'bg-[#fbf6ef] text-[#332820]',
  warm: 'bg-[#fbf1e7] text-[#8a5633]',
  success: 'bg-[#f1ead9] text-[#5f5932]',
}

export function StatCard({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  helper?: string
  tone?: StatTone
}) {
  return (
    <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
      <p className="text-sm font-medium text-[#7a6859]">{label}</p>
      <div
        className={`mt-3 inline-flex rounded-2xl px-3 py-2 text-3xl font-semibold ${statToneClass[tone]}`}
      >
        {value}
      </div>
      {helper && <p className="mt-2 text-xs text-[#8a6f5d]">{helper}</p>}
    </div>
  )
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: BadgeTone
}) {
  return <Badge tone={tone}>{children}</Badge>
}

export function SectionCard({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)] ${className}`}
    >
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[#332820]">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-[#7a6859]">{description}</p>
        )}
      </div>
      {children}
    </section>
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

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow && (
          <p className="text-sm font-medium text-[#9b6a3d]">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-3xl font-semibold text-[#332820]">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function AlertBanner({
  title,
  description,
  tone = 'warning',
}: {
  title: string
  description: string
  tone?: BadgeTone
}) {
  const markerClass =
    tone === 'success'
      ? 'bg-[#f1ead9] text-[#5f5932]'
      : tone === 'muted'
        ? 'bg-[#fffdf9] text-[#8a6f5d]'
        : tone === 'neutral'
          ? 'bg-[#fbf6ef] text-[#6c5a4d]'
          : 'bg-[#fbf1e7] text-[#8a5633]'

  return (
    <div className="flex gap-3 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${markerClass}`}
      >
        !
      </span>
      <div>
        <p className="text-sm font-semibold text-[#332820]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[#7a6859]">{description}</p>
      </div>
    </div>
  )
}
