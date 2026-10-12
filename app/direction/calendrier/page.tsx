import { redirect } from 'next/navigation'
import { legacyCalendarUrl } from '@/lib/prospectsWorkspace'

export default async function LegacyCalendarPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(legacyCalendarUrl(await searchParams))
}
