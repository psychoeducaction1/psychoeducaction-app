'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'
import {
  arrayToTextareaValue,
  nullableText,
  textareaValueToArray,
  type PreferenceField,
  type ProfessionalPreferences,
  type ProfilePreferencesRow,
} from '../shared'

export default function ProfessionnelPreferencesPage() {
  const router = useRouter()
  const [preferences, setPreferences] = useState<ProfessionalPreferences>({
    pref_client_types: '',
    pref_modalities: '',
    pref_followup_types: '',
    pref_notes: '',
  })
  const [loading, setLoading] = useState(true)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [error, setError] = useState('')
  const [preferencesMessage, setPreferencesMessage] = useState('')
  const [preferencesError, setPreferencesError] = useState('')

  useEffect(() => {
    const loadPreferences = async () => {
      setLoading(true)
      setError('')
      setPreferencesMessage('')
      setPreferencesError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role, pref_client_types, pref_modalities, pref_followup_types, pref_notes')
        .eq('id', user.id)
        .single()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      const currentPreferences = profileData as ProfilePreferencesRow

      if (
        currentPreferences.role !== 'professionnel' &&
        currentPreferences.role !== 'direction'
      ) {
        router.push('/')
        return
      }

      setPreferences({
        pref_client_types: arrayToTextareaValue(currentPreferences.pref_client_types),
        pref_modalities: arrayToTextareaValue(currentPreferences.pref_modalities),
        pref_followup_types: arrayToTextareaValue(
          currentPreferences.pref_followup_types
        ),
        pref_notes: currentPreferences.pref_notes ?? '',
      })
      setLoading(false)
    }

    loadPreferences()
  }, [router])

  const updatePreferenceField = (field: PreferenceField, value: string) => {
    setPreferences((currentPreferences) => ({
      ...currentPreferences,
      [field]: value,
    }))
  }

  const handleSavePreferences = async () => {
    setSavingPreferences(true)
    setPreferencesMessage('')
    setPreferencesError('')

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setPreferencesError('Utilisateur introuvable.')
        return
      }

      const { error: saveError } = await supabase
        .from('profiles')
        .update({
          pref_client_types: textareaValueToArray(preferences.pref_client_types),
          pref_modalities: textareaValueToArray(preferences.pref_modalities),
          pref_followup_types: textareaValueToArray(preferences.pref_followup_types),
          pref_notes: nullableText(preferences.pref_notes),
        })
        .eq('id', user.id)

      if (saveError) {
        setPreferencesError(saveError.message)
        return
      }

      setPreferences((currentPreferences) => ({
        pref_client_types: textareaValueToArray(
          currentPreferences.pref_client_types
        ).join(', '),
        pref_modalities: textareaValueToArray(currentPreferences.pref_modalities).join(
          ', '
        ),
        pref_followup_types: textareaValueToArray(
          currentPreferences.pref_followup_types
        ).join(', '),
        pref_notes: nullableText(currentPreferences.pref_notes) ?? '',
      }))
      setPreferencesMessage('Préférences sauvegardées.')
    } catch (caughtError: unknown) {
      setPreferencesError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Une erreur est survenue pendant la sauvegarde.'
      )
    } finally {
      setSavingPreferences(false)
    }
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Espace professionnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Mes préférences
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Indiquez les clientèles, modalités et suivis souhaités.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && (
            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Préférences d&apos;assignation
              </h2>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Clientèles souhaitées
                  <textarea
                    value={preferences.pref_client_types ?? ''}
                    onChange={(event) =>
                      updatePreferenceField('pref_client_types', event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>

                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Modalités souhaitées
                  <textarea
                    value={preferences.pref_modalities ?? ''}
                    onChange={(event) =>
                      updatePreferenceField('pref_modalities', event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>

                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Types de suivis souhaités
                  <textarea
                    value={preferences.pref_followup_types ?? ''}
                    onChange={(event) =>
                      updatePreferenceField('pref_followup_types', event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>

                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Notes / précisions
                  <textarea
                    value={preferences.pref_notes ?? ''}
                    onChange={(event) =>
                      updatePreferenceField('pref_notes', event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  disabled={savingPreferences}
                  className={buttonClass('secondary')}
                >
                  {savingPreferences ? 'Sauvegarde...' : 'Sauvegarder les préférences'}
                </button>

                {preferencesMessage && (
                  <p className="text-sm font-medium text-green-700">
                    {preferencesMessage}
                  </p>
                )}

                {preferencesError && (
                  <p className="text-sm font-medium text-red-700">
                    {preferencesError}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
