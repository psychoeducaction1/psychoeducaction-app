import { ProcedureLibrary } from '@/components/procedures/ProcedureLibrary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Procédures — PsychoÉducAction', robots: { index: false, follow: false } }

export default function ProceduresPage() { return <ProcedureLibrary /> }
