'use client'

import { type FormEvent, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

const savedEmailKey = 'assignations-login-email'

export default function LoginPage() {
  const [email, setEmail] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : window.localStorage.getItem(savedEmailKey) ?? ''
  )
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [rememberEmail, setRememberEmail] = useState(() =>
    typeof window === 'undefined'
      ? false
      : Boolean(window.localStorage.getItem(savedEmailKey))
  )

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (loading) return

    setErrorMessage('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      setErrorMessage(error.message)
      return
    }

    if (rememberEmail) {
      window.localStorage.setItem(savedEmailKey, email)
    } else {
      window.localStorage.removeItem(savedEmailKey)
    }

    window.location.href = '/'
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.05)] sm:p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-28 w-full max-w-xs items-center justify-center rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4">
            <Image
              src="/psychoeducaction-logo.svg"
              alt="Clinique PsychoÉducAction"
              width={320}
              height={140}
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-semibold text-[#332820]">Connexion</h1>
          <p className="mt-2 text-sm text-[#7a6859]">
            Assignations PsychoÉducAction
          </p>
        </div>

        <form onSubmit={handleLogin} autoComplete="on" className="space-y-4">
          <label htmlFor="email" className="block text-sm font-medium text-[#5d4a3d]">
            Courriel
            <input
              id="email"
              type="email"
              name="email"
              placeholder="Courriel"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              readOnly={loading}
              required
              className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] read-only:cursor-wait read-only:bg-[#f7efe7] read-only:text-[#8a6f5d]"
            />
          </label>

          <label htmlFor="password" className="block text-sm font-medium text-[#5d4a3d]">
            Mot de passe
            <input
              id="password"
              type="password"
              name="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              readOnly={loading}
              required
              className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] read-only:cursor-wait read-only:bg-[#f7efe7] read-only:text-[#8a6f5d]"
            />
          </label>

          <div className="text-right">
            <Link
              href="/auth/mot-de-passe-oublie"
              className="text-sm font-medium text-[#8a5633] underline-offset-4 transition hover:text-[#6f4328] hover:underline"
            >
              Mot de passe oubli&eacute; ?
            </Link>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#6c5a4d]">
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(event) => setRememberEmail(event.target.checked)}
              className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
            />
            Se souvenir de mon courriel
          </label>

          {errorMessage && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-center pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`${buttonClass('primary')} !w-full max-w-xs p-3 disabled:cursor-not-allowed disabled:opacity-70 sm:!w-48`}
            >
              {loading ? 'Connexion...' : 'Connexion'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
