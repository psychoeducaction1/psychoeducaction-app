import { ProfessionalPreviewWorkspace } from '@/components/ProfessionalPreviewWorkspace'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProfessionalPreviewWorkspace professionalId={id} />
}
