import { notFound, redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RealMandatePage({ searchParams }: {
  searchParams: Promise<{ case?: string }>
}) {
  if (process.env.PEA_CLINICAL_RUNTIME !== 'real-db') notFound()
  const caseId = (await searchParams).case
  if (!caseId || !uuid.test(caseId)) notFound()
  redirect(`/clinique/mandats?record=${encodeURIComponent(caseId)}`)
}
