'use client'

import { buttonClass } from '@/components/Ui'
import { authenticatedDownloadUrl, portalDownloadAction } from '@/lib/clinical-mandates/client'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { MandateDocument } from '@/lib/clinical-mandates/types'
import { audienceLabels } from './model'

type DocumentPreviewProps = {
  document: MandateDocument
  context?: ClinicalAccessContext
  downloadFormToken?: string
  onOpened?: (id: string, hash: string) => void
}

export function DocumentPreview({ document, context, downloadFormToken, onOpened }: DocumentPreviewProps) {
  const requested = () => onOpened?.(document.id, document.sha256)
  return <section className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fffaf3] p-3">
    <p className="font-semibold">{document.kind === 'proof' ? 'Preuve de signature archivée' : audienceLabels[document.audience]}</p>
    <p className="mt-1 text-xs">Document exact figé · {document.byteLength} octets</p>
    <p className="mt-2 break-all font-mono text-[11px]">SHA-256 : {document.sha256}</p>
    {context ? <a href={authenticatedDownloadUrl(document.id, context)} className={buttonClass('secondary') + ' mt-3 max-w-full whitespace-normal text-center'} onClick={requested}>Télécharger le PDF exact</a>
      : downloadFormToken ? <form action={portalDownloadAction} method="POST" encType="application/x-www-form-urlencoded" target="_self" className="mt-3" onSubmit={requested}>
        <input type="hidden" name="token" value={downloadFormToken} />
        <button type="submit" className={buttonClass('secondary') + ' max-w-full whitespace-normal text-center'}>Télécharger le PDF exact</button>
      </form> : <p role="alert" className="mt-3 text-sm text-red-800">Téléchargement indisponible : contexte ou invitation manquant.</p>}
    <p className="mt-2 text-xs text-[#8a6f5d]">Le serveur vérifie les octets et leur empreinte avant de proposer le fichier. Le clic demande un téléchargement ; l’application ne peut pas confirmer sa réussite ni la lecture du PDF.</p>
    {onOpened && <p className="mt-2 text-sm">Ouvrez le fichier téléchargé sur votre appareil et lisez-le avant de cocher l’attestation de signature. Aucun PDF n’est exécuté dans cette page.</p>}
  </section>
}
