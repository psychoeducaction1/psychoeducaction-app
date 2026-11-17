import { ProfessionalProfileEntry } from '@/components/ProfessionalProfileEntry'
export default async function ProfessionalPage({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params
 return <ProfessionalProfileEntry professionalId={id} />
}
