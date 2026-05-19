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
    <main className="min-h-screen flex items-center justify-center">
      <p>Chargement...</p>
    </main>
  )
}