'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { MarketingAvailabilityCalendar } from '@/components/MarketingAvailabilityCalendar'
import { PageHeader } from '@/components/ui/index'
import { buttonClass } from '@/components/Ui'
import { isSuperAdmin } from '@/lib/superAdmin'
import { supabase } from '@/lib/supabaseClient'

type Staff = {
  id: string
  full_name: string
}

export default function MarketingCalendarPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isDirection, setIsDirection] = useState(false)
  const [readOnlyPreview, setReadOnlyPreview] = useState(false)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [error, setError] = useState('')

  const loadAccess = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .maybeSingle()
    const hasDirectionAccess = isSuperAdmin({ email: user.email }, profile)
    if (
      profileError ||
      !profile ||
      (profile.role !== 'marketing' && !hasDirectionAccess)
    ) {
      router.push('/')
      return
    }

    setIsDirection(hasDirectionAccess)
    const { data: staffData, error: staffError } = await supabase
      .from('marketing_staff')
      .select('id, full_name')
      .eq('email', 'camille.payette@psychoeducaction.com')
      .maybeSingle()
    if (staffError) setError(staffError.message)
    else setStaff((staffData as Staff | null) ?? null)
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReadOnlyPreview(
        new URLSearchParams(window.location.search).get('preview') === 'camille'
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
        ? '/marketing/calendrier?preview=camille'
        : '/marketing/calendrier'
    )
  }

  return (
    <>
      <AppNav
        previewRole={readOnlyPreview ? 'marketing' : undefined}
        previewProfileName={readOnlyPreview ? staff?.full_name : undefined}
        onExitPreview={readOnlyPreview ? () => updatePreview(false) : undefined}
      />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-7">
          <PageHeader
            eyebrow="Marketing"
            title="Calendrier de Camille"
            description="Disponibilités hebdomadaires prévues pour joindre Camille au besoin."
            actions={isDirection ? (
              <button
                type="button"
                onClick={() => updatePreview(!readOnlyPreview)}
                className={buttonClass(readOnlyPreview ? 'primary' : 'secondary')}
              >
                <Eye className="h-4 w-4" />
                {readOnlyPreview ? 'Retour à la vue Direction' : "Voir l’espace de Camille"}
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
            <MarketingAvailabilityCalendar
              staffId={staff.id}
              canEdit={!readOnlyPreview}
            />
          ) : (
            <p className="text-sm text-[#7a6859]">
              Le profil marketing de Camille doit d’abord être créé avec le script SQL.
            </p>
          )}
        </div>
      </main>
    </>
  )
}
