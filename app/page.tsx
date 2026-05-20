'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function HomePage() {
  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = '/login'
        return
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (error || !profile) {
        alert("Profil introuvable dans la table profiles.")
        return
      }

      if (profile.role === 'direction') {
        window.location.href = '/direction'
      } else {
        window.location.href = '/professionnel'
      }
    }

    checkUser()
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] px-6 py-4 text-sm text-[#7a6859] shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
        Chargement...
      </div>
    </main>
  )
}
