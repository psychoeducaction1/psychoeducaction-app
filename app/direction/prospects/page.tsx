import { ProspectsWorkspace } from '@/components/intake/ProspectsWorkspace'
import { prospectsTab } from '@/lib/prospectsWorkspace'

export default async function ProspectsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  return <ProspectsWorkspace initialTab={prospectsTab(typeof params.tab === 'string' ? params.tab : undefined)} hasExplicitTab={typeof params.tab === 'string'} initialProspectId={typeof params.prospect === 'string' ? params.prospect : undefined} />
}
