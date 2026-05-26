import type { ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  type LucideIcon,
} from 'lucide-react'
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
type VisualPriority = 'default' | 'high' | 'subtle'

const statToneClass: Record<StatTone, string> = {
  neutral: 'bg-[#fbf6ef] text-[#332820]',
  warm: 'bg-[#fbf1e7] text-[#8a5633]',
  success: 'bg-[#f1ead9] text-[#5f5932]',
}

const cardPriorityClass: Record<VisualPriority, string> = {
  default:
    'border-[#eadfd2] bg-[#fffdf9] shadow-[0_1px_2px_rgba(72,49,30,0.05)]',
  high:
    'border-[#d8b992] bg-[#fffaf4] shadow-[0_10px_28px_rgba(138,86,51,0.10)]',
  subtle: 'border-[#efe5da] bg-[#fffdf9]/75 shadow-none',
}

export function StatCard({
  label,
  value,
  helper,
  tone = 'neutral',
  priority = 'default',
  icon: Icon,
}: {
  label: string
  value: ReactNode
  helper?: string
  tone?: StatTone
  priority?: VisualPriority
  icon?: LucideIcon
}) {
  const valueClass =
    priority === 'high'
      ? 'text-3xl sm:text-4xl'
      : priority === 'subtle'
        ? 'text-xl sm:text-2xl'
        : 'text-2xl sm:text-3xl'

  return (
    <div
      className={`min-w-0 rounded-2xl border p-5 ${cardPriorityClass[priority]}`}
    >
      <div className="flex min-h-5 items-center gap-2 text-sm font-semibold text-[#6c5a4d]">
        {Icon && (
          <Icon className="h-4 w-4 shrink-0 text-[#9b6a3d]" aria-hidden="true" />
        )}
        <p>{label}</p>
      </div>
      <div
        className={`mt-3 inline-flex max-w-full rounded-xl px-3 py-1.5 font-semibold ${valueClass} ${statToneClass[tone]}`}
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
  priority = 'default',
  icon: Icon,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
  priority?: VisualPriority
  icon?: LucideIcon
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border p-5 ${cardPriorityClass[priority]} ${className}`}
    >
      <div className="mb-5 min-h-8">
        <h2
          className={`flex items-center gap-2 font-semibold leading-7 text-[#332820] ${
            priority === 'high' ? 'text-xl' : 'text-lg'
          }`}
        >
          {Icon && (
            <Icon className="h-5 w-5 shrink-0 text-[#9b6a3d]" aria-hidden="true" />
          )}
          {title}
        </h2>
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
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-[#dfd0bf] bg-[#fbf6ef] px-5 py-6 text-center">
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
    <div className="mb-6 flex min-w-0 flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-sm font-semibold text-[#9b6a3d]">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#332820] sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>
      )}
    </div>
  )
}

export function AlertBanner({
  title,
  description,
  tone = 'warning',
  priority = 'default',
}: {
  title: string
  description: string
  tone?: BadgeTone
  priority?: VisualPriority
}) {
  const Icon =
    tone === 'success' ? CheckCircle2 : tone === 'muted' ? Clock3 : AlertCircle
  const markerClass =
    tone === 'success'
      ? 'bg-[#f1ead9] text-[#5f5932]'
      : tone === 'muted'
        ? 'bg-[#fffdf9] text-[#8a6f5d]'
        : tone === 'neutral'
          ? 'bg-[#fbf6ef] text-[#6c5a4d]'
          : 'bg-[#fbf1e7] text-[#8a5633]'

  return (
    <div
      className={`flex min-w-0 gap-3 rounded-2xl border p-5 ${cardPriorityClass[priority]}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${markerClass}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#332820]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[#7a6859]">{description}</p>
      </div>
    </div>
  )
}
