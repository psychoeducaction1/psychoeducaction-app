import type { ClinicalAccessContext } from '@/lib/clinical-core/types'

export type ClientProfile = {
  firstName: string; lastName: string; birthDate: string | null; sex: string;
  address: string; email: string; phone: string; consultationReason: string;
  requestedService: string; assignedAt: string | null; version: number
}
export type ClientPerson = {
  id: string; fullName: string; relationship: string; email: string; phone: string; address: string;
  version: number; canEdit: boolean; communicationAllowed: boolean; consentAllowed: boolean;
  documentsAllowed: boolean; authorityVerified: boolean; source: 'contact' | 'representative' | 'mandate' | 'payer';
  payerResponsibility: string | null; payerShareBasisPoints: number | null;
  reminder48h: boolean; reminder2h: boolean; reminderFirstHours: number; reminderSecondHours: number
}
export type ClientLifecycle = {
  recordId: string; episodeId: string; label: string; status: 'open' | 'closed'; version: number;
  canClose: boolean; canRequestReopen: boolean; canReopen: boolean; reopenRequested: boolean
}
export type ClientDocument = {
  id: string; label: string; fileName: string; mediaType: string; bytes: number | null; createdAt: string;
  audience: ClinicalAccessContext; downloadHref: string; recordId: string | null;
  kind: 'uploaded' | 'mandate' | 'invoice' | 'receipt' | 'consent'
}
export type ClientCommunication = {
  id: string; kind: string; label: string; at: string;
  status: 'prepared' | 'simulated' | 'expired' | 'revoked' | 'sent' | 'delivered' | 'failed';
  simulation: boolean; recipientLabel?: string; expiresAt?: string
}
export type ClientOverview = {
  importedIntake?: { caseId: string; facts: import('../clinical-migration/intake').MigrationIntake; reviewRequired: boolean; financiallyActive?: boolean }[];
  clientId: string; profile: ClientProfile; canEditProfile: boolean; canAddPerson: boolean;
  contacts: ClientPerson[]; lifecycle: ClientLifecycle[]; documents: ClientDocument[];
  communications: ClientCommunication[]; canUploadAdministrative: boolean; uploadClinicalRecordIds: string[]
}
export type UpdateClientProfileInput = Omit<ClientProfile, 'version' | 'requestedService' | 'assignedAt'> & { expectedVersion: number }
export type ClientPersonInput = Pick<ClientPerson, 'fullName' | 'relationship' | 'email' | 'phone' | 'address' | 'communicationAllowed' | 'consentAllowed' | 'documentsAllowed' | 'authorityVerified' | 'reminder48h' | 'reminder2h' | 'reminderFirstHours' | 'reminderSecondHours'> & {source:'contact'|'representative'; payerResponsible:boolean; payerShareBasisPoints:number; allocations?: {personId:string;basisPoints:number;expectedVersion?:number}[]}
export type ClientDocumentInput = { label: string; fileName: string; mediaType: string; dataBase64: string; audience: ClinicalAccessContext; recordId?: string | null }
