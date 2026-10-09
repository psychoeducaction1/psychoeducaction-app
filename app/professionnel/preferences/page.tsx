'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { ProfessionalPreferencesEditor } from '@/components/ProfessionalPreferencesEditor'
import { buttonClass } from '@/components/ui/index'
import {
  emptyStructuredPreferences,
  normalizeStructuredPreferences,
  type ProfessionalStructuredPreferences,
  type ProfessionalStructuredPreferencesRow,
} from '@/lib/professionalPreferences'
import { supabase } from '@/lib/supabaseClient'

const preferencesSelect =
  'role, pref_languages, pref_age_ranges, pref_client_groups, pref_service_types, pref_office_locations, pref_meeting_modes, pref_motifs, pref_exclusions, pref_matching_notes'

export default function ProfessionnelPreferencesPage() {
  const router = useRouter()
  const [preferences, setPreferences] = useState<ProfessionalStructuredPreferences>(
    emptyStructuredPreferences
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadPreferences = async () => {
      setLoading(true)
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(preferencesSelect)
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (data?.role !== 'professionnel' && data?.role !== 'direction') {
        router.push('/')
        return
      }

      setPreferences(
        normalizeStructuredPreferences(data as ProfessionalStructuredPreferencesRow)
      )
      setLoading(false)
    }

    loadPreferences()
  }, [router])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setMessage('')

    const unfinishedOtherLanguage = preferences.pref_languages.some(
      (language) =>
        language.startsWith('Autre :') && !language.slice('Autre :'.length).trim()
    )
    if (unfinishedOtherLanguage) {
      setError('Veuillez préciser la langue sélectionnée dans « Autre ».')
      setSaving(false)
      return
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Utilisateur introuvable.')

      const { data, error: saveError } = await supabase
        .from('profiles')
        .update({
          ...preferences,
          pref_exclusions: preferences.pref_exclusions.trim() || null,
          pref_matching_notes: preferences.pref_matching_notes.trim() || null,
        })
        .eq('id', user.id)
        .select(preferencesSelect)
        .limit(1)
        .maybeSingle()

      if (saveError) throw saveError

      setPreferences(
        normalizeStructuredPreferences(data as ProfessionalStructuredPreferencesRow)
      )
      setMessage('Préférences sauvegardées.')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Une erreur est survenue pendant la sauvegarde.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Espace professionnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">Mes préférences</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7a6859]">
              Ces renseignements servent à proposer des jumelages cohérents. Les notes
              restent visibles à la direction, mais ne sont pas interprétées comme des
              critères automatiques.
            </p>
          </header>

          {loading && (
            <div className="rounded-lg border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          )}

          {!loading && (
            <section className="rounded-lg border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
              <ProfessionalPreferencesEditor value={preferences} onChange={setPreferences} />

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={buttonClass('secondary')}
                >
                  {saving ? 'Sauvegarde...' : 'Sauvegarder les préférences'}
                </button>
                {message && <p className="text-sm font-medium text-green-700">{message}</p>}
                {error && <p className="text-sm font-medium text-red-700">{error}</p>}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
