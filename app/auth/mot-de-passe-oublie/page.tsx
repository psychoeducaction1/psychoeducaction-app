'use client'

import { type FormEvent, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

const genericMessage =
  'Si un compte existe pour ce courriel, un lien de reinitialisation vous sera envoye.'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (loading) return

    setMessage('')
    setErrorMessage('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reinitialisation`,
    })

    setLoading(false)
    setMessage(genericMessage)

    if (error) {
      setErrorMessage(
        "Une erreur technique est survenue. Si le probleme persiste, communiquez avec l'administration."
      )
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.05)] sm:p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-28 w-full max-w-xs items-center justify-center rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4">
            <Image
              src="/psychoeducaction-logo.svg"
              alt="Clinique PsychoEducAction"
              width={320}
              height={140}
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-semibold text-[#332820]">
            Mot de passe oublie
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#7a6859]">
            Entrez votre courriel pour recevoir un lien de reinitialisation.
          </p>
        </div>

        <form onSubmit={handleResetPassword} className="space-y-4">
          <label htmlFor="email" className="block text-sm font-medium text-[#5d4a3d]">
            Courriel
            <input
              id="email"
              type="email"
              name="email"
              placeholder="Courriel"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              readOnly={loading}
              required
              className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] read-only:cursor-wait read-only:bg-[#f7efe7] read-only:text-[#8a6f5d]"
            />
          </label>

          {message && (
            <p className="rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3 text-sm text-[#5f5932]">
              {message}
            </p>
          )}

          {errorMessage && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-center pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`${buttonClass('primary')} !w-full max-w-xs p-3 disabled:cursor-not-allowed disabled:opacity-70 sm:!w-56`}
            >
              {loading ? 'Envoi...' : 'Envoyer le lien'}
            </button>
          </div>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-[#8a5633] underline-offset-4 transition hover:text-[#6f4328] hover:underline"
          >
            Retour a la connexion
          </Link>
        </div>
      </div>
    </main>
  )
}
