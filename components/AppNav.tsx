'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export function AppNav() {
  const router = useRouter()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link href="/direction" className="text-base font-semibold text-slate-950">
          Assignations PsychoÉducAction
        </Link>

        <nav className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
          <Link
            href="/direction"
            className="font-medium text-slate-700 hover:text-slate-950"
          >
            Dashboard direction
          </Link>
          <Link
            href="/professionnel"
            className="font-medium text-slate-700 hover:text-slate-950"
          >
            Espace professionnel
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white hover:bg-slate-700"
          >
            Déconnexion
          </button>
        </nav>
      </div>
    </header>
  )
}
