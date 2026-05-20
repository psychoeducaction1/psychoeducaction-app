'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert(error.message)
      return
    }

    window.location.href = '/'
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#eadfd2] bg-[#fffdf9] p-8 shadow-[0_12px_40px_rgba(72,49,30,0.08)]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#8a5633] text-sm font-semibold text-white">
            PA
          </div>
          <h1 className="text-2xl font-semibold text-[#332820]">Connexion</h1>
          <p className="mt-2 text-sm text-[#7a6859]">
            Assignations PsychoEducAction
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Courriel"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
          />

          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
          />

          <button
            onClick={handleLogin}
            className={`${buttonClass('primary')} w-full p-3`}
          >
            Se connecter
          </button>
        </div>
      </div>
    </main>
  )
}
