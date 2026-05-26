'use client'

import { type FormEvent, useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

export default function InvitationPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    const verifySession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        setErrorMessage(error.message)
        setCheckingSession(false)
        return
      }

      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    }

    verifySession()
  }, [])

  const handleActivateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (saving) return

    setErrorMessage('')
    setSuccessMessage('')

    if (!hasSession) {
      setErrorMessage(
        "Votre lien d'invitation est absent ou expiré. Demandez une nouvelle invitation."
      )
      return
    }

    if (password.length < 8) {
      setErrorMessage('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }

    if (password !== passwordConfirmation) {
      setErrorMessage('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSaving(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setSaving(false)
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage('Compte activé. Redirection vers votre espace professionnel...')
    router.push('/professionnel')
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
          <h1 className="text-2xl font-semibold text-[#332820]">
            Créer votre mot de passe
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#7a6859]">
            Choisissez un mot de passe pour activer votre compte professionnel.
          </p>
        </div>

        {checkingSession ? (
          <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 text-sm text-[#7a6859]">
            Vérification de l&apos;invitation...
          </div>
        ) : (
          <form onSubmit={handleActivateAccount} className="space-y-4">
            {!hasSession && (
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Votre lien d&apos;invitation est absent ou expiré. Demandez une
                nouvelle invitation.
              </p>
            )}

            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#5d4a3d]"
            >
              Mot de passe
              <input
                id="password"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                disabled={!hasSession || saving}
                required
                className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7] disabled:text-[#8a6f5d]"
              />
            </label>

            <label
              htmlFor="password-confirmation"
              className="block text-sm font-medium text-[#5d4a3d]"
            >
              Confirmation
              <input
                id="password-confirmation"
                type="password"
                name="password-confirmation"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                disabled={!hasSession || saving}
                required
                className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7] disabled:text-[#8a6f5d]"
              />
            </label>

            {errorMessage && (
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {errorMessage}
              </p>
            )}

            {successMessage && (
              <p className="rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3 text-sm text-[#5f5932]">
                {successMessage}
              </p>
            )}

            <div className="flex justify-center pt-2">
              <button
                type="submit"
                disabled={!hasSession || saving}
                className={`${buttonClass('primary')} !w-full max-w-xs p-3 disabled:cursor-not-allowed disabled:opacity-70 sm:!w-56`}
              >
                {saving ? 'Activation...' : 'Activer mon compte'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
