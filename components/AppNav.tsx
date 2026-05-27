'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ClipboardList,
  History,
  LayoutDashboard,
  ListChecks,
  Settings,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type UserRole = 'direction' | 'professionnel' | null
type NavLink = {
  href: string
  label: string
  icon: LucideIcon
}

export function AppNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<UserRole>(null)
  const [profileName, setProfileName] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (!cancelled) {
        setRole(data?.role === 'direction' ? 'direction' : 'professionnel')
        setProfileName(data?.full_name?.trim() || data?.email?.trim() || '')
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

  const navLinks: NavLink[] =
    role === 'direction'
      ? [
          { href: '/direction', label: 'Dashboard direction', icon: LayoutDashboard },
          { href: '/direction/assignations', label: 'Assignations', icon: ClipboardList },
          { href: '/direction/liste-attente', label: "Liste d'attente", icon: ListChecks },
          { href: '/direction/professionnels', label: 'Professionnels', icon: Users },
          { href: '/direction/parametres', label: 'Paramètres', icon: Settings },
        ]
      : role === 'professionnel'
        ? [
            { href: '/professionnel', label: 'Tableau de bord', icon: LayoutDashboard },
            { href: '/professionnel/clients', label: 'Mes assignations', icon: UserCheck },
            { href: '/professionnel/demande', label: 'Ma demande', icon: ClipboardList },
            { href: '/professionnel/historique', label: 'Historique', icon: History },
            { href: '/professionnel/preferences', label: 'Mes préférences', icon: Settings },
          ]
        : []

  const brandHref = role === 'professionnel' ? '/professionnel' : '/direction'
  const currentSpaceLabel =
    role === 'direction'
      ? 'Direction'
      : role === 'professionnel'
        ? 'Espace professionnel'
        : ''

  const renderLinks = () =>
    navLinks.map((link) => {
      const Icon = link.icon
      const isActive =
        role === 'direction'
          ? link.href === '/direction'
            ? pathname === '/direction'
            : link.href === '/direction/assignations'
              ? pathname?.startsWith('/direction/assignations')
              : link.href === '/direction/liste-attente'
                ? pathname?.startsWith('/direction/liste-attente')
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
          className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
            isActive
              ? 'bg-[#efe1d2] text-[#6d3f1f]'
              : 'text-[#6c5a4d] hover:bg-[#f5ebe0] hover:text-[#3b2d24]'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {link.label}
        </Link>
      )
    })

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-[#eadfd2] bg-[#fbf7f1]/95 px-5 py-6 lg:flex lg:flex-col">
        <Link href={brandHref} className="block">
          <span className="flex h-20 w-48 items-center justify-start bg-transparent p-0">
            <Image
              src="/psychoeducaction-logo.svg"
              alt="Clinique PsychoÉducAction"
              width={192}
              height={86}
              className="h-full w-full object-contain"
            />
          </span>
          <span className="mt-1 block min-w-0 text-left">
            <span className="block text-sm font-semibold text-[#3b2d24]">
              Assignations
            </span>
            <span className="block text-xs font-medium text-[#8a6f5d]">
              PsychoÉducAction
            </span>
          </span>
        </Link>

        {currentSpaceLabel && (
          <div className="mt-5 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9b6a3d]">
              {currentSpaceLabel}
            </p>
            {role === 'professionnel' && profileName && (
              <p className="mt-1 break-words text-sm font-semibold text-[#332820]">
                {profileName}
              </p>
            )}
          </div>
        )}

        <nav className="mt-7 flex flex-1 flex-col gap-1">{renderLinks()}</nav>

        <button
          type="button"
          onClick={handleSignOut}
          className={buttonClass('secondary')}
        >
          Déconnexion
        </button>
      </aside>

      <header className="sticky top-0 z-30 border-b border-[#eadfd2] bg-[#fbf7f1]/95 backdrop-blur lg:hidden">
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <Link href={brandHref} className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-28 shrink-0 items-center justify-center bg-transparent p-0">
                <Image
                  src="/psychoeducaction-logo.svg"
                  alt="Clinique PsychoÉducAction"
                  width={128}
                  height={52}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#3b2d24]">
                  Assignations PsychoÉducAction
                </span>
                {currentSpaceLabel && (
                  <span className="block truncate text-xs font-medium text-[#8a6f5d]">
                    {role === 'professionnel' && profileName
                      ? profileName
                      : currentSpaceLabel}
                  </span>
                )}
              </span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className={`${buttonClass('secondary')} w-auto shrink-0 px-3 py-2 text-xs`}
            >
              Déconnexion
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
