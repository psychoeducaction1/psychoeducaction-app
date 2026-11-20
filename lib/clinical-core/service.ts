import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { CLINICAL_NOTE_TEMPLATES, getClinicalNoteTemplate } from '@/lib/clinicalNoteTemplates'
import type { AmendmentReason, ClientAdminProjection, ClinicalAccessChange, ClinicalAppointmentProvider, ClinicalAppointmentSnapshot, ClinicalAuditEvent, ClinicalNoteView, ClinicalRecordSummary, ClinicalState, ClinicalStore, FixtureActor, NoteVersion, RecordGrant, SchedulingDirectory, WorkspaceView } from './types'
import { actorIdOf, canAdmin, canPractice, canSupervise, hasCapability, resolveActor } from '@/lib/clinical-core/capabilities'
import type { ClinicalActorInput } from './types'
import * as v from '@/lib/clinical-core/validation'

export type ClinicalServiceOptions = { store: ClinicalStore; now?: () => string; newId?: () => string; appointments?: ClinicalAppointmentProvider }
export function createClinicalService({ store, now = () => new Date().toISOString(), newId = () => crypto.randomUUID(), appointments }: ClinicalServiceOptions) {
  const identityActor = (state: ClinicalState, actorId: string) => state.actors.find(entry => entry.id === v.uuid(actorId)) ?? v.forbidden()
  const actor = (state: ClinicalState, input: ClinicalActorInput) => {
    try { return resolveActor(identityActor(state, actorIdOf(input)), input) } catch { return v.forbidden() }
  }
  const administrative = canAdmin
  const clinical = (who: FixtureActor) => canPractice(who) || canSupervise(who)
  const requireAdmin = (who: FixtureActor) => { if (!administrative(who)) v.forbidden() }
  const requireManager = (who: FixtureActor) => { if (!administrative(who)) v.forbidden() }
  const findClient = (state: ClinicalState, id: string) => state.clients.find(entry => entry.id === v.uuid(id)) ?? v.missing()
  const findRecord = (state: ClinicalState, id: string) => state.records.find(entry => entry.id === v.uuid(id)) ?? v.missing()
  const findNote = (state: ClinicalState, id: string) => state.notes.find(entry => entry.note.id === v.uuid(id) && !entry.note.removedAt) ?? v.missing()
  const grant = (record: ClinicalRecordSummary, who: FixtureActor) => clinical(who) ? record.members.find(member => member.actorId === who.id) : undefined
  const readable = (record: ClinicalRecordSummary, who: FixtureActor) => Boolean(grant(record, who)?.canRead)
  function readRecord(state: ClinicalState, who: FixtureActor, id: string) {
    const record = findRecord(state, id)
    if (!readable(record, who)) v.forbidden()
    return record
  }
  function writable(state: ClinicalState, who: FixtureActor, id: string) {
    const record = readRecord(state, who, id)
    if (record.status !== 'open' || !canPractice(who) || !grant(record, who)?.canWrite) v.forbidden()
    return record
  }
  function event(state: ClinicalState, who: FixtureActor, action: string, resourceType: ClinicalAuditEvent['resourceType'], resourceId: string, clientId: string | null = null, recordId: string | null = null, version: number | null = null, accessChanges?: ClinicalAccessChange[]) {
    state.audit.push({ id: newId(), actorId: who.id, context: who.context, action, resourceType, resourceId, clientId, recordId, version, occurredAt: now(), ...(accessChanges ? { accessChanges: structuredClone(accessChanges) } : {}) })
  }
  function auditVisible(state: ClinicalState, who: FixtureActor) {
    if (administrative(who)) return state.audit
    return state.audit.filter(entry => (entry.recordId !== null && state.records.some(record => record.id === entry.recordId && readable(record, who)))
      || (entry.actorId === who.id && entry.context === who.context && entry.recordId === null
        && (entry.clientId === null || state.records.some(record => record.clientId === entry.clientId && readable(record, who)))))
  }
  function projection(state: ClinicalState, who: FixtureActor, clientId: string): ClientAdminProjection {
    const client = findClient(state, clientId)
    const permittedEpisodes = new Set(state.records.filter(record => record.clientId === clientId && readable(record, who)).map(record => record.episodeId))
    const ownAssignments = canPractice(who) ? state.assignments.filter(entry => entry.clientId === clientId && entry.professionalId === who.id && entry.status === 'active') : []
    for (const assignment of ownAssignments) permittedEpisodes.add(assignment.episodeId)
    if (!administrative(who) && permittedEpisodes.size === 0) v.forbidden()
    const adminRecord = state.administrativeRecords.find(entry => entry.clientId === clientId) ?? v.missing()
    const episodes = state.episodes.filter(entry => entry.clientId === clientId && (administrative(who) || permittedEpisodes.has(entry.id)))
    const requestIds = new Set(episodes.map(entry => entry.requestId))
    return { ...client, administrativeRecord: { ...adminRecord, administrativeNotes: administrative(who) ? adminRecord.administrativeNotes : '' },
      contacts: state.contacts.filter(entry => entry.clientId === clientId), representatives: state.representatives.filter(entry => entry.clientId === clientId),
      payers: administrative(who) ? state.payers.filter(entry => entry.clientId === clientId) : [],
      requests: state.requests.filter(entry => entry.clientId === clientId && (administrative(who) || requestIds.has(entry.id))).map(entry => ({ ...entry, administrativeReason: administrative(who) ? entry.administrativeReason : '' })),
      episodes, assignmentLinks: administrative(who) ? state.assignmentLinks.filter(entry => entry.clientId === clientId) : [],
      assignments: administrative(who) ? state.assignments.filter(entry => entry.clientId === clientId) : ownAssignments }
  }
  function listClientsIn(state: ClinicalState, who: FixtureActor) {
    return state.clients.filter(client => administrative(who) || state.records.some(record => record.clientId === client.id && readable(record, who))
      || (canPractice(who) && state.assignments.some(entry => entry.clientId === client.id && entry.professionalId === who.id && entry.status === 'active'))).map(client => projection(state, who, client.id))
  }
  function checkVersion(note: ClinicalNoteView, expected: unknown) { if (note.note.version !== v.version(expected)) v.conflict() }
  function snapshot(note: ClinicalNoteView, who: FixtureActor, kind: NoteVersion['kind'], at: string) {
    note.versions.push({ version: note.note.version, content: structuredClone(note.content), title: note.note.title, encounterDate: note.note.encounterDate, noteType: note.note.noteType, status: note.note.status, appointmentId: note.note.appointmentId, appointmentSnapshot: structuredClone(note.note.appointmentSnapshot), actorId: who.id, createdAt: at, kind })
  }
  function contentHash(note: ClinicalNoteView) {
    return createHash('sha256').update(JSON.stringify({ id: note.note.id, recordId: note.note.recordId, authorId: note.note.authorId, noteType: note.note.noteType, title: note.note.title, encounterDate: note.note.encounterDate, amendsNoteId: note.note.amendsNoteId, amendmentReason: note.note.amendmentReason, appointmentId: note.note.appointmentId, appointmentSnapshot: note.note.appointmentSnapshot, requiresCosignature: note.note.requiresCosignature, supervisorId: note.note.supervisorId, content: note.content })).digest('hex')
  }
  function appointmentSource(value: unknown, who: FixtureActor, record: ClinicalRecordSummary, expectedId?: string): ClinicalAppointmentSnapshot {
    const input = v.object(value, ['id', 'recordId', 'clientId', 'professionalId', 'startAt', 'endAt', 'modality', 'status', 'version'])
    const id = v.uuid(input.id)
    if ((expectedId && id !== expectedId) || v.uuid(input.recordId) !== record.id || v.uuid(input.clientId) !== record.clientId || v.uuid(input.professionalId) !== who.id) v.forbidden()
    if (input.status !== 'planned' && input.status !== 'completed') throw new v.ClinicalError(409, 'APPOINTMENT_UNAVAILABLE', 'Une rencontre annulée ou une absence ne peut pas être liée à une note.')
    const startAt = v.text(input.startAt, 40), endAt = v.text(input.endAt, 40)
    if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || new Date(startAt).toISOString() !== startAt || new Date(endAt).toISOString() !== endAt || endAt <= startAt || Date.parse(endAt) - Date.parse(startAt) > 12 * 60 * 60 * 1000) v.invalid('La période de rencontre est invalide.')
    if (!['office', 'home', 'phone', 'video'].includes(input.modality as string)) v.invalid('La modalité de rencontre est invalide.')
    return { id, recordId: record.id, clientId: record.clientId, professionalId: who.id, startAt, endAt, modality: input.modality as ClinicalAppointmentSnapshot['modality'], status: input.status, version: v.version(input.version) }
  }
  function requireAppointmentProvider() { if (!appointments) throw new v.ClinicalError(503, 'APPOINTMENT_PROVIDER_UNAVAILABLE', 'Les rencontres ne peuvent pas être vérifiées pour le moment.'); return appointments }
  function checkEncounterDate(encounterDate: string | null, appointment: ClinicalAppointmentSnapshot | null) {
    if (encounterDate && appointment && encounterDate !== new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(appointment.startAt))) v.invalid('La date de rencontre doit correspondre au rendez-vous choisi, à l’heure de Montréal.')
  }
  function currentAppointmentForSignature(note: ClinicalNoteView, who: FixtureActor, record: ClinicalRecordSummary) {
    if (!note.note.appointmentId || note.note.amendsNoteId) return
    let source: unknown
    try { source = requireAppointmentProvider().resolve({ actorId: who.id, context: who.context, recordId: record.id, clientId: record.clientId, appointmentId: note.note.appointmentId }) }
    catch (error) {
      if (v.isClinicalError(error) && [403, 404, 409].includes(error.status)) v.conflict('La rencontre liée a changé ou n’est plus disponible. Le texte est conservé ; créez un nouveau brouillon avec la bonne rencontre.')
      throw error
    }
    if (!source) v.conflict('La rencontre liée n’est plus disponible. Le brouillon est conservé.')
    let current: ClinicalAppointmentSnapshot
    try { current = appointmentSource(source, who, record, note.note.appointmentId) }
    catch (error) {
      if (v.isClinicalError(error) && [403, 409].includes(error.status)) v.conflict('La rencontre liée a changé. Le brouillon et sa référence initiale sont conservés.')
      throw error
    }
    const original = note.note.appointmentSnapshot
    // Outcome planned→completed and its technical version may change; they do not
    // change the encounter identity/time/modality being clinically documented.
    if (!original || ['id', 'recordId', 'clientId', 'professionalId', 'startAt', 'endAt', 'modality'].some(key => current[key as keyof ClinicalAppointmentSnapshot] !== original[key as keyof ClinicalAppointmentSnapshot])) v.conflict('La rencontre liée a été déplacée ou modifiée. Créez un nouveau brouillon ; le texte actuel est conservé.')
  }
  function validateMembers(state: ClinicalState, value: unknown, updating = false): RecordGrant[] {
    if (!Array.isArray(value) || (!updating && value.length < 1) || value.length > 20) return v.invalid('Membres du dossier invalides.')
    const members = value.map(entry => {
      const input = v.object(entry, ['actorId', 'canRead', 'canWrite', 'canCosign', 'requiresCosignature', 'supervisorId'])
      const target = identityActor(state, v.uuid(input.actorId))
      if (!hasCapability(target, 'practice') && !hasCapability(target, 'supervision')) v.invalid('Une capacité clinique explicite est requise pour cet accès.')
      const member: RecordGrant = { actorId: target.id, canRead: v.bool(input.canRead), canWrite: v.bool(input.canWrite), canCosign: v.bool(input.canCosign), requiresCosignature: v.bool(input.requiresCosignature), supervisorId: input.supervisorId === null ? null : v.uuid(input.supervisorId) }
      if (member.canCosign && !hasCapability(target, 'supervision')) v.invalid('La cosignature exige un superviseur explicitement autorisé.')
      if (member.canWrite && !hasCapability(target, 'practice')) v.invalid('La rédaction exige une capacité de pratique clinique.')
      if ((member.canWrite || member.canCosign) && !member.canRead) v.invalid('La lecture est requise pour rédiger ou cosigner.')
      if (member.requiresCosignature && (!member.canWrite || !member.supervisorId || member.supervisorId === target.id)) v.invalid('Supervision invalide.')
      if (member.requiresCosignature && !hasCapability(identityActor(state, member.supervisorId!), 'supervision')) v.invalid('Le superviseur désigné est invalide.')
      if (!member.requiresCosignature && member.supervisorId) v.invalid('Supervision inattendue.')
      return member
    })
    if (new Set(members.map(member => member.actorId)).size !== members.length || (!updating && !members.some(member => member.canWrite))) v.invalid('Membres du dossier invalides.')
    for (const member of members) if (!updating && member.requiresCosignature && !members.some(supervisor => supervisor.actorId === member.supervisorId && supervisor.canRead && supervisor.canCosign)) v.invalid('Le superviseur doit avoir une autorisation explicite de cosignature.')
    return members
  }
  const service = {
    listClients(actorId: ClinicalActorInput) { return store.transaction(state => { const who = actor(state, actorId); const clients = listClientsIn(state, who); event(state, who, 'clients.list', 'workspace', who.id); return clients }) },
    createClient(actorId: ClinicalActorInput, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who)
      const input = v.object(value, ['firstName', 'lastName', 'birthDate'])
      const birthDate = v.date(input.birthDate)
      if (birthDate && birthDate > now().slice(0, 10)) v.invalid('La naissance ne peut être future.')
      const client = { id: newId(), firstName: v.text(input.firstName, 100), lastName: v.text(input.lastName, 100), birthDate, createdAt: now() }
      state.clients.push(client); state.administrativeRecords.push({ id: newId(), clientId: client.id, administrativeNotes: '', version: 1 })
      event(state, who, 'client.create', 'client', client.id, client.id)
      return projection(state, who, client.id)
    }) },
    updateAdministrativeRecord(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['administrativeNotes', 'expectedVersion'])
      const record = state.administrativeRecords.find(entry => entry.clientId === clientId) ?? v.missing()
      if (record.version !== v.version(input.expectedVersion)) v.conflict('Le dossier administratif a changé. Rechargez avant d’enregistrer.')
      record.administrativeNotes = v.text(input.administrativeNotes, 6000, false); record.version++
      event(state, who, 'client.admin.update', 'client', clientId, clientId)
      return projection(state, who, clientId)
    }) },
    addContact(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['fullName', 'relationship', 'email', 'phone'])
      state.contacts.push({ id: newId(), clientId, fullName: v.text(input.fullName, 200), relationship: v.text(input.relationship, 100, false), email: v.email(input.email), phone: v.text(input.phone, 40, false) })
      event(state, who, 'client.contact.create', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    addRepresentative(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['fullName', 'relationship', 'authorityVerified'])
      state.representatives.push({ id: newId(), clientId, fullName: v.text(input.fullName, 200), relationship: v.text(input.relationship, 100), authorityVerified: v.bool(input.authorityVerified) })
      event(state, who, 'client.representative.create', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    addPayer(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['fullName', 'payerType', 'email'])
      if (!['self', 'parent', 'organization'].includes(input.payerType as string)) v.invalid()
      state.payers.push({ id: newId(), clientId, fullName: v.text(input.fullName, 200), payerType: input.payerType as 'self' | 'parent' | 'organization', email: v.email(input.email) })
      event(state, who, 'client.payer.create', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    createRequest(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['service', 'administrativeReason'])
      state.requests.push({ id: newId(), clientId, service: v.text(input.service, 200), administrativeReason: v.text(input.administrativeReason, 1000, false), status: 'open', requestedAt: now() })
      event(state, who, 'request.create', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    createEpisode(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['requestId', 'label']); const requestId = input.requestId === undefined || input.requestId === null ? null : v.uuid(input.requestId)
      if (requestId && !state.requests.some(entry => entry.id === requestId && entry.clientId === clientId)) v.invalid('La demande ne correspond pas à ce client.')
      state.episodes.push({ id: newId(), clientId, requestId, label: v.text(input.label, 160), status: 'open', openedAt: now(), closedAt: null })
      event(state, who, 'episode.create', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    assignRequest(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['requestId', 'professionalId', 'label'])
      const requestId = v.uuid(input.requestId), professionalId = v.uuid(input.professionalId), label = v.text(input.label, 160)
      const request = state.requests.find(entry => entry.id === requestId && entry.clientId === clientId)
      if (!request) v.invalid('La demande ne correspond pas à ce client.')
      if (request.status !== 'open' || state.assignments.some(entry => entry.requestId === requestId)) v.conflict('Cette demande est déjà assignée ou fermée.')
      const professional = identityActor(state, professionalId)
      if (!hasCapability(professional, 'practice')) v.invalid('La personne assignée doit avoir une capacité de pratique clinique.')
      const at = now(), episodeId = newId(), assignmentId = newId()
      state.episodes.push({ id: episodeId, clientId, requestId, label, status: 'open', openedAt: at, closedAt: null })
      state.assignments.push({ id: assignmentId, clientId, requestId, episodeId, professionalId, status: 'active', assignedAt: at, closedAt: null })
      request.status = 'closed'
      // Assignment is administrative: no clinical record or note grant is inferred.
      event(state, who, 'request.assign', 'client', assignmentId, clientId)
      return projection(state, who, clientId)
    }) },
    linkAssignment(actorId: ClinicalActorInput, clientId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireAdmin(who); clientId = findClient(state, clientId).id
      const input = v.object(value, ['episodeId', 'externalAssignmentId']); const episodeId = v.uuid(input.episodeId); const externalAssignmentId = v.uuid(input.externalAssignmentId)
      if (!state.episodes.some(entry => entry.id === episodeId && entry.clientId === clientId)) v.invalid('Épisode incompatible.')
      if (state.assignmentLinks.some(entry => entry.externalAssignmentId === externalAssignmentId)) v.conflict('Cette assignation est déjà liée.')
      state.assignmentLinks.push({ id: newId(), clientId, episodeId, source: 'fixture_assignment', externalAssignmentId })
      event(state, who, 'assignment.link', 'client', clientId, clientId); return projection(state, who, clientId)
    }) },
    createClinicalRecord(actorId: ClinicalActorInput, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireManager(who)
      const input = v.object(value, ['clientId', 'episodeId', 'label', 'members']); const clientId = v.uuid(input.clientId); const episodeId = v.uuid(input.episodeId)
      findClient(state, clientId)
      if (!state.episodes.some(entry => entry.id === episodeId && entry.clientId === clientId && entry.status === 'open')) v.invalid('Épisode incompatible.')
      if (state.records.some(entry => entry.episodeId === episodeId)) v.conflict('Un dossier clinique existe déjà pour cet épisode. Ouvrez un nouvel épisode pour un nouveau dossier.')
      const record: ClinicalRecordSummary = { id: newId(), clientId, episodeId, label: v.text(input.label, 160), members: validateMembers(state, input.members), grantRevision: 1, status: 'open', createdAt: now() }
      state.records.push(record); event(state, who, 'record.create', 'record', record.id, clientId, record.id, record.grantRevision, record.members.map(member => ({ actorId: member.actorId, previous: null, next: member })))
      return record
    }) },
    updateClinicalAccess(actorId: ClinicalActorInput, recordId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); requireManager(who); const record = findRecord(state, recordId)
      const input = v.object(value, ['expectedRevision', 'members'])
      if (record.grantRevision !== v.version(input.expectedRevision)) v.conflict('Les autorisations ont changé. Rechargez le dossier avant de les modifier.')
      const members = validateMembers(state, input.members, true)
      const actorIds = new Set([...record.members.map(member => member.actorId), ...members.map(member => member.actorId)])
      const changes: ClinicalAccessChange[] = [...actorIds].sort().map(actorId => ({ actorId, previous: record.members.find(member => member.actorId === actorId) ?? null, next: members.find(member => member.actorId === actorId) ?? null })).filter(change => JSON.stringify(change.previous) !== JSON.stringify(change.next))
      record.members = members; record.grantRevision++
      event(state, who, 'record.access.update', 'record', record.id, record.clientId, record.id, record.grantRevision, changes)
      return record
    }) },
    getClinicalRecord(actorId: ClinicalActorInput, recordId: string) { return store.transaction(state => {
      const who = actor(state, actorId); const record = readRecord(state, who, recordId)
      event(state, who, 'record.read', 'record', record.id, record.clientId, record.id)
      return { record, client: projection(state, who, record.clientId), notes: state.notes.filter(entry => entry.note.recordId === record.id && !entry.note.removedAt).map(entry => entry.note), audit: auditVisible(state, who).filter(entry => entry.recordId === record.id) }
    }) },
    listNotes(actorId: ClinicalActorInput, recordId: string) { return service.getClinicalRecord(actorId, recordId).notes },
    listNoteAppointments(actorId: ClinicalActorInput, recordId: string) {
      const previous = store.read(); const who = actor(previous, actorId); const record = writable(previous, who, recordId)
      const sources = requireAppointmentProvider().list({ actorId: who.id, context: who.context, recordId: record.id, clientId: record.clientId })
      if (!Array.isArray(sources) || sources.length > 500) v.invalid('La liste de rencontres est invalide.')
      return store.transaction(state => {
        const currentActor = actor(state, actorId); const currentRecord = writable(state, currentActor, recordId)
        const choices = sources.map(source => appointmentSource(source, currentActor, currentRecord))
        if (new Set(choices.map(choice => choice.id)).size !== choices.length) v.invalid('La liste de rencontres comporte un doublon.')
        event(state, currentActor, 'appointment.choices.read', 'record', currentRecord.id, currentRecord.clientId, currentRecord.id)
        return choices
      })
    },
    createNote(actorId: ClinicalActorInput, recordId: string, value: unknown) {
      const previous = store.read(); const previousActor = actor(previous, actorId); const previousRecord = writable(previous, previousActor, recordId)
      const input = v.object(value, ['noteType', 'title', 'encounterDate', 'content', 'appointmentId'])
      const appointmentId = input.appointmentId === undefined || input.appointmentId === null || input.appointmentId === '' ? null : v.uuid(input.appointmentId)
      const source = appointmentId ? requireAppointmentProvider().resolve({ actorId: previousActor.id, context: previousActor.context, recordId: previousRecord.id, clientId: previousRecord.clientId, appointmentId }) : null
      if (appointmentId && !source) v.missing()
      return store.transaction(state => {
      const who = actor(state, actorId); const record = writable(state, who, recordId)
      const type = v.noteType(input.noteType); const member = grant(record, who)!; const at = now()
      const appointmentSnapshot = source ? appointmentSource(source, who, record, appointmentId!) : null
      const encounterDate = v.date(input.encounterDate); checkEncounterDate(encounterDate, appointmentSnapshot)
      const note: ClinicalNoteView = { note: { id: newId(), recordId: record.id, noteType: type, title: input.title === undefined ? getClinicalNoteTemplate(type).label : v.text(input.title, 120), encounterDate, authorId: who.id, status: 'draft', version: 1, amendsNoteId: null, amendmentReason: null, appointmentId, appointmentSnapshot, createdAt: at, updatedAt: at, signedAt: null, requiresCosignature: member.requiresCosignature, supervisorId: member.supervisorId }, content: v.content(input.content, type), versions: [], signatures: [] }
      snapshot(note, who, 'create', at); state.notes.push(note); event(state, who, 'note.create', 'note', note.note.id, record.clientId, record.id, 1); return note
    }) },
    getNote(actorId: ClinicalActorInput, noteId: string) { return store.transaction(state => {
      const who = actor(state, actorId); const note = findNote(state, noteId); const record = readRecord(state, who, note.note.recordId)
      event(state, who, 'note.read', 'note', note.note.id, record.clientId, record.id, note.note.version); return note
    }) },
    deleteNote(actorId: ClinicalActorInput, noteId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId)
      const note = findNote(state, noteId)
      const record = writable(state, who, note.note.recordId)
      if (note.note.authorId !== who.id) v.forbidden()
      const input = v.object(value, ['expectedVersion'])
      checkVersion(note, input.expectedVersion)
      note.note.removedAt = now(); note.note.removedBy = who.id
      event(state, who, 'note.delete', 'note', note.note.id, record.clientId, record.id, note.note.version)
      return { id: note.note.id, removed: true }
    }) },
    saveNote(actorId: ClinicalActorInput, noteId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); const note = findNote(state, noteId); const record = writable(state, who, note.note.recordId)
      if (note.note.authorId !== who.id) v.forbidden()
      const input = v.object(value, ['expectedVersion', 'content', 'title', 'encounterDate']); checkVersion(note, input.expectedVersion)
      if (note.note.status !== 'draft') v.conflict('Cette note est verrouillée. Créez un amendement après signature complète.')
      if (input.content === undefined) v.invalid('Le contenu est requis.')
      note.content = v.content(input.content, note.note.noteType)
      if (input.title !== undefined) note.note.title = v.text(input.title, 120)
      if (input.encounterDate !== undefined) note.note.encounterDate = v.date(input.encounterDate)
      checkEncounterDate(note.note.encounterDate, note.note.appointmentSnapshot)
      note.note.version++; note.note.updatedAt = now(); snapshot(note, who, 'save', note.note.updatedAt)
      event(state, who, 'note.save', 'note', note.note.id, record.clientId, record.id, note.note.version); return note
    }) },
    signNote(actorId: ClinicalActorInput, noteId: string, value: unknown) {
      const previous = store.read(); const previousActor = actor(previous, actorId); const previousNote = findNote(previous, noteId); const previousRecord = writable(previous, previousActor, previousNote.note.recordId)
      if (previousNote.note.authorId !== previousActor.id) v.forbidden()
      const input = v.object(value, ['expectedVersion', 'attested']); checkVersion(previousNote, input.expectedVersion)
      if (input.attested !== true) v.invalid('La validation humaine est requise.')
      if (previousNote.note.status !== 'draft') v.conflict('Cette note est déjà verrouillée.')
      currentAppointmentForSignature(previousNote, previousActor, previousRecord)
      return store.transaction(state => {
      const who = actor(state, actorId); const note = findNote(state, noteId); const record = writable(state, who, note.note.recordId)
      if (note.note.authorId !== who.id) v.forbidden()
      checkVersion(note, input.expectedVersion)
      if (input.attested !== true) v.invalid('La validation humaine est requise.')
      if (note.note.status !== 'draft') v.conflict('Cette note est déjà verrouillée.')
      if (!Object.values(note.content).some(text => text.trim())) v.invalid('Une note vide ne peut être signée.')
      if (note.note.amendsNoteId) {
        const originalContent = findNote(state, note.note.amendsNoteId).content
        if (Object.keys(note.content).length === Object.keys(originalContent).length && Object.entries(note.content).every(([key, text]) => originalContent[key] === text)) v.invalid('Une correction ou un complément doit modifier la note signée d’origine.')
      }
      const currentGrant = grant(record, who)!
      if (currentGrant.requiresCosignature !== note.note.requiresCosignature || currentGrant.supervisorId !== note.note.supervisorId) v.conflict('Les règles de supervision ont changé. Créez un nouveau brouillon.')
      if (note.note.requiresCosignature && !record.members.some(member => member.actorId === note.note.supervisorId && member.canRead && member.canCosign)) v.forbidden()
      const at = now(); note.note.status = note.note.requiresCosignature ? 'awaiting_cosignature' : 'signed'; note.note.version++; note.note.updatedAt = at; note.note.signedAt = note.note.requiresCosignature ? null : at
      note.signatures.push({ actorId: who.id, signedAt: at, version: note.note.version, kind: 'author', contentHash: contentHash(note) }); snapshot(note, who, 'sign', at)
      event(state, who, 'note.sign', 'note', note.note.id, record.clientId, record.id, note.note.version); return note
    }) },
    cosignNote(actorId: ClinicalActorInput, noteId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); const note = findNote(state, noteId); const record = readRecord(state, who, note.note.recordId)
      if (record.status !== 'open' || !canSupervise(who) || !grant(record, who)?.canCosign || note.note.supervisorId !== who.id || note.note.authorId === who.id) v.forbidden()
      const input = v.object(value, ['expectedVersion', 'attested']); checkVersion(note, input.expectedVersion)
      if (input.attested !== true) v.invalid('La validation humaine est requise.')
      if (note.note.status !== 'awaiting_cosignature') v.conflict('Cette note n’attend pas de cosignature.')
      const at = now(); note.note.status = 'signed'; note.note.version++; note.note.updatedAt = at; note.note.signedAt = at
      note.signatures.push({ actorId: who.id, signedAt: at, version: note.note.version, kind: 'supervisor', contentHash: contentHash(note) }); snapshot(note, who, 'cosign', at)
      event(state, who, 'note.cosign', 'note', note.note.id, record.clientId, record.id, note.note.version); return note
    }) },
    amendNote(actorId: ClinicalActorInput, noteId: string, value: unknown) { return store.transaction(state => {
      const who = actor(state, actorId); const original = findNote(state, noteId); const record = writable(state, who, original.note.recordId)
      if (original.note.authorId !== who.id) v.forbidden()
      const input = v.object(value, ['expectedVersion', 'reason']); checkVersion(original, input.expectedVersion)
      if (original.note.status !== 'signed') v.conflict('Seule une note entièrement signée peut être amendée.')
      if (!['correction', 'clarification', 'supplement'].includes(input.reason as string)) v.invalid('Motif d’amendement invalide.')
      const member = grant(record, who)!; const at = now()
      const note: ClinicalNoteView = { note: { ...original.note, id: newId(), status: 'draft', version: 1, amendsNoteId: original.note.id, amendmentReason: input.reason as AmendmentReason, createdAt: at, updatedAt: at, signedAt: null, requiresCosignature: member.requiresCosignature, supervisorId: member.supervisorId }, content: structuredClone(original.content), versions: [], signatures: [] }
      snapshot(note, who, 'create', at); state.notes.push(note); event(state, who, 'note.amend.create', 'note', note.note.id, record.clientId, record.id, 1); return note
    }) },
    listAudit(actorId: ClinicalActorInput) { return store.transaction(state => { const who = actor(state, actorId); event(state, who, 'audit.read', 'workspace', who.id); return auditVisible(state, who) }) },
    getSchedulingDirectory(actorId: ClinicalActorInput): SchedulingDirectory { return store.transaction(state => {
      const who = actor(state, actorId)
      const records = state.records.filter(record => administrative(who) || readable(record, who))
      const clientIds = new Set(records.map(record => record.clientId))
      event(state, who, 'scheduling.directory.read', 'workspace', who.id)
      return { actors: state.actors, clients: state.clients.filter(client => administrative(who) || clientIds.has(client.id)).map(({ id, firstName, lastName }) => ({ id, firstName, lastName })), records: records.map(({ id, clientId, status, members }) => ({ id, clientId, status, members })) }
    }) },
    getWorkspace(actorId: ClinicalActorInput): WorkspaceView { return store.transaction(state => {
      const who = actor(state, actorId); event(state, who, 'workspace.read', 'workspace', who.id)
      return { mode: 'isolated_fixture', durable: false, context: who.context, actor: who, actors: state.actors, clients: listClientsIn(state, who), records: state.records.filter(record => readable(record, who)), managedRecords: administrative(who) ? state.records : [], noteTypes: CLINICAL_NOTE_TEMPLATES.map(type => ({ id: type.id, label: type.label, sections: CLINICAL_NOTE_BLUEPRINTS[type.id].map(section => ({ id: section.id, title: section.title })) })), audit: auditVisible(state, who) }
    }) },
  }
  return service
}
export type ClinicalService = ReturnType<typeof createClinicalService>
import { createHash } from 'node:crypto'
