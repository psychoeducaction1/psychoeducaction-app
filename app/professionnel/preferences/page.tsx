'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { buttonClass } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  arrayToTextareaValue,
  englishLanguagePreference,
  frenchLanguagePreference,
  nullableText,
  otherLanguagePreference,
  textareaValueToArray,
  type PreferenceField,
  type ProfessionalPreferences,
  type ProfilePreferencesRow,
} from '../shared'

export default function ProfessionnelPreferencesPage() {
  const router = useRouter()
  const [preferences, setPreferences] = useState<ProfessionalPreferences>({
    pref_languages: frenchLanguagePreference,
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
        .select(
          'role, pref_languages, pref_client_types, pref_modalities, pref_followup_types, pref_notes'
        )
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

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
        pref_languages:
          arrayToTextareaValue(currentPreferences.pref_languages) ||
          frenchLanguagePreference,
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

  const getLanguageValues = (value = preferences.pref_languages) =>
    textareaValueToArray(value)

  const getOtherLanguageDetails = (value = preferences.pref_languages) => {
    const otherLanguage = getLanguageValues(value).find((language) =>
      language.startsWith(`${otherLanguagePreference} :`)
    )

    return otherLanguage?.slice(`${otherLanguagePreference} :`.length).trim() ?? ''
  }

  const hasOtherLanguage = (value = preferences.pref_languages) =>
    getLanguageValues(value).some(
      (language) =>
        language === otherLanguagePreference ||
        language.startsWith(`${otherLanguagePreference} :`)
    )

  const updateLanguagePreference = (language: string, checked: boolean) => {
    const currentLanguages = getLanguageValues().filter(
      (currentLanguage) =>
        currentLanguage !== language &&
        !(
          language === otherLanguagePreference &&
          (currentLanguage === otherLanguagePreference ||
            currentLanguage.startsWith(`${otherLanguagePreference} :`))
        )
    )

    if (checked) {
      currentLanguages.push(language)
    }

    updatePreferenceField('pref_languages', currentLanguages.join(', '))
  }

  const updateOtherLanguageDetails = (details: string) => {
    const currentLanguages = getLanguageValues().filter(
      (language) =>
        language !== otherLanguagePreference &&
        !language.startsWith(`${otherLanguagePreference} :`)
    )
    const trimmedDetails = details.trim()

    currentLanguages.push(
      trimmedDetails
        ? `${otherLanguagePreference} : ${trimmedDetails}`
        : otherLanguagePreference
    )

    updatePreferenceField('pref_languages', currentLanguages.join(', '))
  }

  const handleSavePreferences = async () => {
    setSavingPreferences(true)
    setPreferencesMessage('')
    setPreferencesError('')

    if (hasOtherLanguage() && !getOtherLanguageDetails()) {
      setPreferencesError('Veuillez préciser la langue lorsque vous sélectionnez Autre.')
      setSavingPreferences(false)
      return
    }

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
          pref_languages: textareaValueToArray(preferences.pref_languages),
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
        pref_languages:
          textareaValueToArray(currentPreferences.pref_languages).join(', ') ||
          frenchLanguagePreference,
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
            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Préférences d&apos;assignation
              </h2>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4 md:col-span-2">
                  <p className="text-sm font-medium text-[#5d4a3d]">
                    Langues d&apos;intervention
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-[#5d4a3d]">
                      <input
                        type="checkbox"
                        checked={getLanguageValues().includes(
                          frenchLanguagePreference
                        )}
                        onChange={(event) =>
                          updateLanguagePreference(
                            frenchLanguagePreference,
                            event.target.checked
                          )
                        }
                        className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                      />
                      Français
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#5d4a3d]">
                      <input
                        type="checkbox"
                        checked={getLanguageValues().includes(
                          englishLanguagePreference
                        )}
                        onChange={(event) =>
                          updateLanguagePreference(
                            englishLanguagePreference,
                            event.target.checked
                          )
                        }
                        className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                      />
                      Anglais
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#5d4a3d]">
                      <input
                        type="checkbox"
                        checked={hasOtherLanguage()}
                        onChange={(event) =>
                          updateLanguagePreference(
                            otherLanguagePreference,
                            event.target.checked
                          )
                        }
                        className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                      />
                      Autre
                    </label>
                  </div>
                  {hasOtherLanguage() && (
                    <label className="mt-3 block text-sm font-medium text-[#5d4a3d]">
                      Préciser la langue
                      <input
                        type="text"
                        value={getOtherLanguageDetails()}
                        onChange={(event) =>
                          updateOtherLanguageDetails(event.target.value)
                        }
                        placeholder="Ex. espagnol, arabe, portugais..."
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>
                  )}
                </div>

                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Clientèles souhaitées
                  <textarea
                    value={preferences.pref_client_types ?? ''}
                    onChange={(event) =>
                      updatePreferenceField('pref_client_types', event.target.value)
                    }
                    rows={3}
                    placeholder="Ex. enfants, adolescents, adultes, familles, fournisseurs CNESST, IVAC"
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
                    placeholder="Ex. présentiel, télépratique, domicile, école"
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
                    placeholder="Ex. suivi individuel, coaching parental, évaluation, intervention familiale"
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
                    placeholder="Ex. disponibilités particulières, secteurs desservis, exclusions ou limites cliniques"
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
