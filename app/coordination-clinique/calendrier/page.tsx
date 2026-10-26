'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { ClinicalCoordinationAvailabilityCalendar } from '@/components/ClinicalCoordinationAvailabilityCalendar'
import { PageHeader } from '@/components/ui/index'
import { buttonClass } from '@/components/Ui'
import { loadClinicalCoordinationAccess } from '@/lib/clinicalCoordinationClient'
import { supabase } from '@/lib/supabaseClient'

type Staff = {
  id: string
  full_name: string
}

export default function ClinicalCoordinationCalendarPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isDirection, setIsDirection] = useState(false)
  const [readOnlyPreview, setReadOnlyPreview] = useState(false)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [error, setError] = useState('')

  const loadAccess = useCallback(async () => {
    setLoading(true)
    setError('')
    setStaff(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const access = await loadClinicalCoordinationAccess()
    if (!access.context) { setError(access.error); setLoading(false); return }
    setIsDirection(access.context.isManager)
    setStaff(access.context.staff)
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReadOnlyPreview(
        new URLSearchParams(window.location.search).get('preview') === 'eve'
      )
      void loadAccess()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAccess])

  const updatePreview = (enabled: boolean) => {
    setReadOnlyPreview(enabled)
    window.history.replaceState(
      null,
      '',
      enabled
        ? '/coordination-clinique/calendrier?preview=eve'
        : '/coordination-clinique/calendrier'
    )
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-7">
          <PageHeader
            eyebrow="Coordination clinique"
            title="Calendrier d’Ève"
            description="Disponibilités hebdomadaires prévues pour joindre Ève, coordinatrice clinique, au besoin."
            actions={isDirection ? (
              <button
                type="button"
                onClick={() => updatePreview(!readOnlyPreview)}
                className={buttonClass(readOnlyPreview ? 'primary' : 'secondary')}
              >
                <Eye className="h-4 w-4" />
                {readOnlyPreview ? 'Retour à la vue Direction' : "Voir l’espace d’Ève"}
              </button>
            ) : undefined}
          />

          {readOnlyPreview && (
            <div className="rounded-xl border border-[#d9b591] bg-[#fbf1e7] px-4 py-3 text-sm text-[#6d3f1f]">
              Vue sécurisée en lecture seule. Les disponibilités ne peuvent pas être modifiées dans cet aperçu.
            </div>
          )}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {loading ? (
            <p className="text-sm text-[#7a6859]">Chargement...</p>
          ) : staff ? (
            <ClinicalCoordinationAvailabilityCalendar
              staffId={staff.id}
              canEdit={!readOnlyPreview}
            />
          ) : (
            <p className="text-sm text-[#7a6859]">
              L’espace de coordination clinique n’est pas encore disponible. Contactez la direction.
            </p>
          )}
        </div>
      </main>
    </>
  )
}
