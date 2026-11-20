'use client'

import Link from 'next/link'
import { buttonClass } from '@/components/Ui'
import RealLegacyBatchImport from './RealLegacyBatchImport'

export default function RealClinicalImport() {
  return <main className="mx-auto max-w-3xl p-5 text-[#332820]">
    <Link className={buttonClass('secondary')} href="/clinique/clients">← Retour à mes dossiers</Link>
    <h1 className="mt-6 text-2xl font-semibold">Importer mes dossiers</h1>
    <p className="mt-2 text-sm">Déposez un PDF de notes par client. Les correspondances certaines seront rattachées automatiquement. Seuls les cas incertains demanderont votre réponse.</p>
    <RealLegacyBatchImport onImported={async () => {}} />
  </main>
}
