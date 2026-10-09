'use client'

import { Plus, Trash2 } from 'lucide-react'
import {
  clientGroupOptions,
  languageOptions,
  meetingModeOptions,
  motifOptions,
  officeLocationOptions,
  serviceTypeOptions,
  type PreferenceOption,
  type ProfessionalStructuredPreferences,
} from '@/lib/professionalPreferences'

type Props = {
  value: ProfessionalStructuredPreferences
  onChange: (value: ProfessionalStructuredPreferences) => void
}

function CheckboxGroup({
  title,
  options,
  values,
  onChange,
}: {
  title: string
  options: PreferenceOption[]
  values: string[]
  onChange: (values: string[]) => void
}) {
  return (
    <fieldset className="rounded-lg border border-[#eadfd2] bg-[#fbf6ef] p-4">
      <legend className="px-1 text-sm font-semibold text-[#5d4a3d]">{title}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-[#5d4a3d]">
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.value]
                    : values.filter((value) => value !== option.value)
                )
              }
              className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ProfessionalPreferencesEditor({ value, onChange }: Props) {
  const update = <K extends keyof ProfessionalStructuredPreferences>(
    field: K,
    nextValue: ProfessionalStructuredPreferences[K]
  ) => onChange({ ...value, [field]: nextValue })

  const hasOtherLanguage = value.pref_languages.some((language) =>
    language.startsWith('Autre :')
  )
  const otherLanguage =
    value.pref_languages
      .find((language) => language.startsWith('Autre :'))
      ?.slice('Autre :'.length)
      .trim() ?? ''

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <CheckboxGroup
          title="Langues d’intervention"
          options={languageOptions}
          values={value.pref_languages.filter(
            (language) => !language.startsWith('Autre :')
          )}
          onChange={(values) =>
            update('pref_languages', [
              ...values,
              ...value.pref_languages.filter((language) => language.startsWith('Autre :')),
            ])
          }
        />
        <label className="mt-3 flex items-center gap-2 text-sm text-[#5d4a3d]">
          <input
            type="checkbox"
            checked={hasOtherLanguage}
            onChange={(event) =>
              update(
                'pref_languages',
                event.target.checked
                  ? [...value.pref_languages, 'Autre : ']
                  : value.pref_languages.filter((language) => !language.startsWith('Autre :'))
              )
            }
            className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
          />
          Autre langue
        </label>
        {hasOtherLanguage && (
          <input
            type="text"
            value={otherLanguage}
            onChange={(event) =>
              update('pref_languages', [
                ...value.pref_languages.filter((language) => !language.startsWith('Autre :')),
                `Autre : ${event.target.value}`,
              ])
            }
            placeholder="Préciser la langue"
            className="mt-2 w-full rounded-lg border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
          />
        )}
      </div>

      <fieldset className="rounded-lg border border-[#eadfd2] bg-[#fbf6ef] p-4 md:col-span-2">
        <legend className="px-1 text-sm font-semibold text-[#5d4a3d]">Âges acceptés</legend>
        <div className="mt-2 space-y-3">
          {value.pref_age_ranges.map((range, index) => (
            <div key={`${index}-${range.min}-${range.max}`} className="grid grid-cols-[1fr_1fr_40px] gap-2">
              <label className="text-xs font-medium text-[#7a6859]">
                Âge minimum
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={range.min}
                  onChange={(event) => {
                    const ranges = [...value.pref_age_ranges]
                    ranges[index] = { ...range, min: Number(event.target.value) }
                    update('pref_age_ranges', ranges)
                  }}
                  className="mt-1 w-full rounded-lg border border-[#dfd0bf] bg-white p-2 text-sm text-[#332820]"
                />
              </label>
              <label className="text-xs font-medium text-[#7a6859]">
                Âge maximum
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={range.max ?? ''}
                  placeholder="Aucun"
                  onChange={(event) => {
                    const ranges = [...value.pref_age_ranges]
                    ranges[index] = {
                      ...range,
                      max: event.target.value === '' ? null : Number(event.target.value),
                    }
                    update('pref_age_ranges', ranges)
                  }}
                  className="mt-1 w-full rounded-lg border border-[#dfd0bf] bg-white p-2 text-sm text-[#332820]"
                />
              </label>
              <button
                type="button"
                title="Retirer cette plage d’âge"
                onClick={() =>
                  update(
                    'pref_age_ranges',
                    value.pref_age_ranges.filter((_, rangeIndex) => rangeIndex !== index)
                  )
                }
                className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update('pref_age_ranges', [...value.pref_age_ranges, { min: 0, max: null }])}
            className="inline-flex items-center gap-2 rounded-lg border border-[#dfd0bf] bg-white px-3 py-2 text-sm font-medium text-[#6f452b] hover:bg-[#f8efe5]"
          >
            <Plus size={16} aria-hidden="true" />
            Ajouter une plage d’âge
          </button>
        </div>
      </fieldset>

      <CheckboxGroup title="Clientèles" options={clientGroupOptions} values={value.pref_client_groups} onChange={(values) => update('pref_client_groups', values)} />
      <CheckboxGroup title="Services" options={serviceTypeOptions} values={value.pref_service_types} onChange={(values) => update('pref_service_types', values)} />
      <CheckboxGroup title="Bureaux" options={officeLocationOptions} values={value.pref_office_locations} onChange={(values) => update('pref_office_locations', values)} />
      <CheckboxGroup title="Modalités" options={meetingModeOptions} values={value.pref_meeting_modes} onChange={(values) => update('pref_meeting_modes', values)} />
      <div className="md:col-span-2">
        <CheckboxGroup title="Motifs et champs d’intérêt" options={motifOptions} values={value.pref_motifs} onChange={(values) => update('pref_motifs', values)} />
      </div>

      <label className="block text-sm font-medium text-[#5d4a3d]">
        Exclusions ou limites cliniques
        <textarea
          value={value.pref_exclusions}
          onChange={(event) => update('pref_exclusions', event.target.value)}
          rows={5}
          placeholder="Ex. aucun dossier IVAC, ne prend pas les dossiers DI-TSA..."
          className="mt-2 w-full rounded-lg border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
        />
      </label>

      <label className="block text-sm font-medium text-[#5d4a3d]">
        Notes et précisions
        <textarea
          value={value.pref_matching_notes}
          onChange={(event) => update('pref_matching_notes', event.target.value)}
          rows={5}
          placeholder="Disponibilités, approches, exceptions et autres renseignements utiles."
          className="mt-2 w-full rounded-lg border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
        />
      </label>
    </div>
  )
}
