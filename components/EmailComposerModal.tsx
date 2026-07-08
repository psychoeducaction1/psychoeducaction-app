'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/ui/index'

export type EmailComposerSection = {
  enabled: boolean
  fromLabel: string
  to: string
  subject: string
  message: string
}

export type EmailComposerDrafts = {
  professional?: EmailComposerSection
  client?: EmailComposerSection
}

type EmailComposerModalProps = {
  open: boolean
  drafts: EmailComposerDrafts | null
  sending?: boolean
  onCancel: () => void
  onSend: (drafts: EmailComposerDrafts) => void
}

const emptySection: EmailComposerSection = {
  enabled: false,
  fromLabel: '',
  to: '',
  subject: '',
  message: '',
}

function cloneSection(section?: EmailComposerSection) {
  return section ? { ...section } : undefined
}

function EmailSection({
  title,
  section,
  onChange,
  disabled,
}: {
  title: string
  section: EmailComposerSection
  onChange: (section: EmailComposerSection) => void
  disabled?: boolean
}) {
  const inputClass =
    'mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#b09c8a] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7] disabled:text-[#8a6f5d]'

  return (
    <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4">
      <label className="flex items-start gap-2 text-sm font-semibold text-[#332820]">
        <input
          type="checkbox"
          checked={section.enabled}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...section, enabled: event.target.checked })
          }
          className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633] disabled:opacity-60"
        />
        {title}
      </label>

      <div className="mt-4 grid gap-3">
        <label className="block text-sm font-medium text-[#5d4a3d]">
          De
          <input
            value={section.fromLabel}
            readOnly
            disabled={!section.enabled || disabled}
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-[#5d4a3d]">
          À
          <input
            type="email"
            value={section.to}
            disabled={!section.enabled || disabled}
            onChange={(event) => onChange({ ...section, to: event.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-[#5d4a3d]">
          Sujet
          <input
            value={section.subject}
            disabled={!section.enabled || disabled}
            onChange={(event) =>
              onChange({ ...section, subject: event.target.value })
            }
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-[#5d4a3d]">
          Message
          <textarea
            value={section.message}
            disabled={!section.enabled || disabled}
            onChange={(event) =>
              onChange({ ...section, message: event.target.value })
            }
            rows={11}
            className={`${inputClass} min-h-48 resize-y leading-6`}
          />
        </label>
      </div>
    </section>
  )
}

export function EmailComposerModal({
  open,
  drafts,
  sending = false,
  onCancel,
  onSend,
}: EmailComposerModalProps) {
  const [professionalDraft, setProfessionalDraft] = useState<
    EmailComposerSection | undefined
  >(() => cloneSection(drafts?.professional))
  const [clientDraft, setClientDraft] = useState<
    EmailComposerSection | undefined
  >(() => cloneSection(drafts?.client))
  const [error, setError] = useState('')

  if (!open || !drafts) return null

  const validateAndSend = () => {
    const nextDrafts: EmailComposerDrafts = {
      professional: professionalDraft,
      client: clientDraft,
    }
    const enabledDrafts = [professionalDraft, clientDraft].filter(
      (section): section is EmailComposerSection => Boolean(section?.enabled)
    )

    for (const section of enabledDrafts) {
      if (!section.to.trim()) {
        setError('Veuillez indiquer un destinataire pour chaque courriel activé.')
        return
      }

      if (!section.subject.trim()) {
        setError('Veuillez indiquer un sujet pour chaque courriel activé.')
        return
      }

      if (!section.message.trim()) {
        setError('Veuillez indiquer un message pour chaque courriel activé.')
        return
      }
    }

    setError('')
    onSend(nextDrafts)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#eadfd2] bg-[#fffaf4] p-5 shadow-xl sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#332820]">
              Envoyer les courriels d’assignation
            </h2>
            <p className="mt-2 text-sm text-[#6c5a4d]">
              L’assignation a été créée. Vous pouvez maintenant envoyer les
              courriels ou fermer cette fenêtre sans envoi.
            </p>
          </div>
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={onCancel}
            disabled={sending}
          >
            Fermer
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-4">
          {professionalDraft && (
            <EmailSection
              title="Courriel au professionnel"
              section={professionalDraft}
              onChange={setProfessionalDraft}
              disabled={sending}
            />
          )}
          {clientDraft && (
            <EmailSection
              title="Courriel au client"
              section={clientDraft}
              onChange={setClientDraft}
              disabled={sending}
            />
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={onCancel}
            disabled={sending}
          >
            Annuler
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            onClick={validateAndSend}
            disabled={sending}
          >
            {sending ? 'Envoi...' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const emptyEmailComposerSection = emptySection
