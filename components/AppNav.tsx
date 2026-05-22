'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type UserRole = 'direction' | 'professionnel' | null

export function AppNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<UserRole>(null)

  useEffect(() => {
    let cancelled = false

    const loadRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (!cancelled) {
        setRole(data?.role === 'direction' ? 'direction' : 'professionnel')
      }
    }

    loadRole()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navLinks =
    role === 'direction'
      ? [
          { href: '/direction', label: 'Dashboard direction' },
          { href: '/direction/assignations', label: 'Assignations' },
          { href: '/direction/professionnels', label: 'Professionnels' },
          { href: '/direction/parametres', label: 'Parametres' },
        ]
      : role === 'professionnel'
        ? [
            { href: '/professionnel', label: 'Tableau de bord' },
            { href: '/professionnel/clients', label: 'Mes assignations' },
            { href: '/professionnel/demande', label: 'Ma demande' },
            { href: '/professionnel/preferences', label: 'Mes préférences' },
          ]
        : []

  const brandHref = role === 'professionnel' ? '/professionnel' : '/direction'

  const renderLinks = () =>
    navLinks.map((link) => {
      const isActive =
        role === 'direction'
          ? link.href === '/direction'
            ? pathname === '/direction'
            : link.href === '/direction/assignations'
              ? pathname?.startsWith('/direction/assignations')
              : link.href === '/direction/professionnels'
                ? pathname?.startsWith('/direction/professionnels') ||
                  pathname?.startsWith('/professionnel/')
                : pathname?.startsWith('/direction/parametres')
          : link.href === '/professionnel'
            ? pathname === '/professionnel'
            : pathname?.startsWith(link.href)

      return (
        <Link
          key={link.href}
          href={link.href}
          className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
            isActive
              ? 'bg-[#efe1d2] text-[#6d3f1f]'
              : 'text-[#6c5a4d] hover:bg-[#f5ebe0] hover:text-[#3b2d24]'
          }`}
        >
          {link.label}
        </Link>
      )
    })

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-[#eadfd2] bg-[#fbf7f1]/95 px-5 py-6 lg:flex lg:flex-col">
        <Link href={brandHref} className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8a5633] text-sm font-semibold text-white">
            PA
          </span>
          <span>
            <span className="block text-sm font-semibold text-[#3b2d24]">
              Assignations
            </span>
            <span className="block text-xs font-medium text-[#8a6f5d]">
              PsychoEducAction
            </span>
          </span>
        </Link>

        <nav className="mt-10 flex flex-1 flex-col gap-1">{renderLinks()}</nav>

        <button
          type="button"
          onClick={handleSignOut}
          className={buttonClass('secondary')}
        >
          Deconnexion
        </button>
      </aside>

      <header className="sticky top-0 z-30 border-b border-[#eadfd2] bg-[#fbf7f1]/95 backdrop-blur lg:hidden">
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <Link href={brandHref} className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#8a5633] text-xs font-semibold text-white">
                PA
              </span>
              <span className="truncate text-sm font-semibold text-[#3b2d24]">
                Assignations PsychoEducAction
              </span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className={`${buttonClass('secondary')} w-auto shrink-0 px-3 py-2 text-xs`}
            >
              Deconnexion
            </button>
          </div>

          <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4">
            {renderLinks()}
          </nav>
        </div>
      </header>
    </>
  )
}
