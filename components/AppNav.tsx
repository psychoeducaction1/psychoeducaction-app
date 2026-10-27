'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChartNoAxesCombined,
  CalendarDays,
  ClipboardList,
  FilePenLine,
  ChartPie,
  DollarSign,
  History,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  PhoneCall,
  SlidersHorizontal,
  Star,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'
import {
  isAdministrativePayrollAuthorized,
  isPayrollAuthorized,
} from '@/lib/payrollAccess'
import { isSuperAdmin } from '@/lib/superAdmin'
import { isAdministrativeTaskAuthorized } from '@/lib/administrativeTaskAccess'
import { loadClinicalCoordinationAccess } from '@/lib/clinicalCoordinationClient'
import { canAccessClinicalNotes } from '@/lib/clinicalNotesAccess'

type UserRole = 'direction' | 'professionnel' | null
type NavLink = {
  href: string
  label: string
  icon: LucideIcon
}

export function AppNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [coordinationAuthorized, setCoordinationAuthorized] = useState(false)
  const [role, setRole] = useState<UserRole>(null)
  const [profileName, setProfileName] = useState('')
  const [payrollAuthorized, setPayrollAuthorized] = useState(false)
  const [administrativePayrollAuthorized, setAdministrativePayrollAuthorized] =
    useState(false)
  const [budgetAuthorized, setBudgetAuthorized] = useState(false)
  const [clinicalNotesAuthorized, setClinicalNotesAuthorized] = useState(false)
  const [administrativeTasksAuthorized, setAdministrativeTasksAuthorized] =
    useState(false)

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

      if (cancelled) return

      const resolvedRole: UserRole =
        data?.role === 'direction' ||
        data?.role === 'professionnel'
          ? data.role
          : null
      setRole(resolvedRole)
      setProfileName(data?.full_name?.trim() || data?.email?.trim() || '')
      setPayrollAuthorized(isPayrollAuthorized({ email: user.email }, data))
      setAdministrativePayrollAuthorized(
        isAdministrativePayrollAuthorized({ email: user.email }, data)
      )
      setBudgetAuthorized(isSuperAdmin({ email: user.email }, data))
      setClinicalNotesAuthorized(canAccessClinicalNotes(user, data))
      setAdministrativeTasksAuthorized(
        isAdministrativeTaskAuthorized({ email: user.email }, data)
      )
      const coordination = await loadClinicalCoordinationAccess()
      if (!cancelled) setCoordinationAuthorized(Boolean(coordination.context))

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

  const displayRole = role
  const displayProfileName = profileName

  const navLinks: NavLink[] =
    displayRole === 'direction'
      ? [
          { href: '/direction', label: 'Dashboard direction', icon: LayoutDashboard },
          { href: '/direction/liste-attente', label: "Liste d'attente", icon: ListChecks },
          { href: '/direction/prospects', label: 'Prospects et appels', icon: CalendarDays },
          ...(budgetAuthorized
            ? [{ href: '/direction/acquisition', label: 'Acquisition', icon: ChartNoAxesCombined }]
            : []),
          {
            href: '/direction/assignations-en-cours',
            label: 'Assignations en cours',
            icon: PhoneCall,
          },
          {
            href: '/direction/taches-administratives',
            label: 'Tâches administratives',
            icon: ListTodo,
          },
          { href: '/preferences-professionnels', label: 'Préférences des professionnels', icon: SlidersHorizontal },
          ...(budgetAuthorized
            ? [{ href: '/direction/professionnels', label: 'Professionnels', icon: Users }]
            : []),
          ...(budgetAuthorized
            ? [{ href: '/direction/satisfaction', label: 'Satisfaction', icon: Star }]
            : []),
          ...(clinicalNotesAuthorized
            ? [{ href: '/prise-de-notes', label: 'Prise de notes', icon: FilePenLine }]
            : []),
          ...(payrollAuthorized
            ? [{ href: '/direction/paie', label: 'Paie', icon: DollarSign }]
            : []),
          ...(administrativePayrollAuthorized
            ? [
                {
                  href: '/direction/paie-adjointes',
                  label: 'Paie adjointes',
                  icon: CalendarDays,
                },
              ]
            : []),
          ...(budgetAuthorized
            ? [{ href: '/direction/budget', label: 'Budget', icon: ChartPie }]
            : []),
          { href: '/direction/journal-audit', label: "Journal d'audit", icon: History },
        ]
      : displayRole === 'professionnel'
        ? [
            { href: coordinationAuthorized ? '/coordination-clinique/tableau-de-bord' : '/professionnel', label: coordinationAuthorized ? 'Tableau de bord clinique' : 'Tableau de bord', icon: LayoutDashboard },
            { href: '/professionnel/clients', label: 'Mes assignations', icon: UserCheck },
            { href: '/professionnel/demande', label: 'Ma demande', icon: ClipboardList },
            { href: '/professionnel/historique', label: 'Historique', icon: History },
            ...(clinicalNotesAuthorized
              ? [{ href: '/prise-de-notes', label: 'Prise de notes', icon: FilePenLine }]
              : []),
            {
              href: '/professionnel/preferences',
              label: 'Mes préférences',
              icon: SlidersHorizontal,
            },
            ...(administrativePayrollAuthorized
              ? [
                  {
                    href: '/direction/paie-adjointes',
                    label: 'Paie adjointes',
                    icon: CalendarDays,
                  },
                ]
              : []),
            ...(administrativeTasksAuthorized
              ? [
                  {
                    href: '/direction/taches-administratives',
                    label: 'Tâches administratives',
                    icon: ListTodo,
                  },
                ]
              : []),
            ...(coordinationAuthorized
              ? [{ href: '/preferences-professionnels', label: 'Préférences des professionnels', icon: SlidersHorizontal }]
              : []),
          ]
        : []

  if (coordinationAuthorized) {
    navLinks.push({ href: '/coordination-clinique', label: 'Coordination clinique', icon: ListTodo })
    if (displayRole !== 'direction') navLinks.push(
      { href: '/coordination-clinique/liste-attente', label: 'Liste d’attente', icon: ListChecks },
    )
  }

  const brandHref =
    displayRole === 'professionnel'
      ? coordinationAuthorized ? '/coordination-clinique/tableau-de-bord' : '/professionnel'
      : '/direction'
  const currentSpaceLabel =
    displayRole === 'direction'
      ? 'Direction'
      : displayRole === 'professionnel'
        ? 'Espace professionnel'
        : ''

  const renderLinks = () =>
    navLinks.map((link) => {
      const Icon = link.icon
      const isActive =
        link.href.startsWith('/coordination-clinique') || link.href === '/preferences-professionnels'
          ? pathname === link.href
          : link.href === '/prise-de-notes'
          ? pathname === '/prise-de-notes'
          : displayRole === 'direction'
          ? link.href === '/direction'
            ? pathname === '/direction'
            : link.href === '/direction/liste-attente'
                ? pathname?.startsWith('/direction/liste-attente')
              : link.href === '/direction/prospects'
                ? pathname?.startsWith('/direction/prospects') || pathname?.startsWith('/direction/calendrier')
              : link.href === '/direction/acquisition'
                ? pathname?.startsWith('/direction/acquisition')
              : link.href === '/direction/assignations-en-cours'
                ? pathname?.startsWith('/direction/assignations-en-cours')
              : link.href === '/direction/taches-administratives'
                ? pathname?.startsWith('/direction/taches-administratives')
              : link.href === '/direction/professionnels'
                ? pathname?.startsWith('/direction/professionnels') ||
                  pathname?.startsWith('/professionnel/')
                : link.href === '/direction/paie-adjointes'
                  ? pathname?.startsWith('/direction/paie-adjointes')
                : link.href === '/direction/paie'
                  ? pathname === '/direction/paie'
                : link.href === '/direction/budget'
                  ? pathname?.startsWith('/direction/budget')
                : link.href === '/direction/satisfaction'
                  ? pathname?.startsWith('/direction/satisfaction')
                : pathname?.startsWith('/direction/journal-audit')
          : link.href === '/professionnel'
            ? pathname === '/professionnel'
            : pathname?.startsWith(link.href)
      return (
        <Link
          key={link.href}
          href={link.href}
          className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 lg:whitespace-normal ${
            isActive
              ? 'bg-[#efe1d2] text-[#6d3f1f]'
              : 'text-[#6c5a4d] hover:bg-[#f5ebe0] hover:text-[#3b2d24]'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{link.label}</span>
        </Link>
      )
    })

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-[#eadfd2] bg-[#fbf7f1]/95 px-5 py-6 lg:flex lg:flex-col">
        <Link href={brandHref} className="block">
          <span className="flex h-28 w-full items-center justify-start bg-transparent p-0">
            <Image
              src="/psychoeducaction-logo.svg"
              alt="Clinique PsychoÉducAction"
              width={240}
              height={104}
              className="h-full w-full max-w-[240px] object-contain object-left"
            />
          </span>
        </Link>

        {currentSpaceLabel && (
          <div className="mt-5 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9b6a3d]">
              {currentSpaceLabel}
            </p>
            {displayRole === 'professionnel' && displayProfileName && (
              <p className="mt-1 break-words text-sm font-semibold text-[#332820]">
                {displayProfileName}
              </p>
            )}
          </div>
        )}

        <nav className="mt-7 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">{renderLinks()}</nav>

        <button type="button" onClick={handleSignOut} className={`${buttonClass('secondary')} mt-4 shrink-0`}>
          Déconnexion
        </button>
      </aside>

      <header className="sticky top-0 z-30 border-b border-[#eadfd2] bg-[#fbf7f1]/95 backdrop-blur lg:hidden">
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <Link href={brandHref} className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-36 shrink-0 items-center justify-start bg-transparent p-0">
                <Image
                  src="/psychoeducaction-logo.svg"
                  alt="Clinique PsychoÉducAction"
                  width={144}
                  height={62}
                  className="h-full w-full object-contain"
                />
              </span>
              {currentSpaceLabel && (
                <span className="min-w-0 truncate text-xs font-medium text-[#8a6f5d]">
                  {displayRole === 'professionnel' && displayProfileName
                    ? displayProfileName
                    : currentSpaceLabel}
                </span>
              )}
            </Link>
            <button type="button" onClick={handleSignOut} className={`${buttonClass('secondary')} w-auto shrink-0 px-3 py-2 text-xs`}>
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
