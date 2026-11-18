import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyMigrationRow,processedMigrationClient,prefillMigrationRow,migrationBirthDateConflict} from '../lib/clinical-migration/model.ts'

test('reprise : même source traitée, nouvel export strict et ambiguïtés conservées à vérifier',()=>{
 const row={...emptyMigrationRow('fixture:original'),firstName:'Client',lastName:'Fictif',birthDate:'2000-01-01',professionalId:'pro-fictif',service:'Psychoéducation'}
 const receipt={sourceKey:row.sourceKey,patientId:'patient-fictif',caseId:'cas-fictif',professionalId:row.professionalId,service:row.service,firstName:row.firstName,lastName:row.lastName,birthDate:row.birthDate}
 assert.equal(processedMigrationClient(row,[receipt])?.patientId,receipt.patientId)
 const document={sha256:'a'.repeat(64),name:'Fictif.pdf',bytes:100,pages:1,kind:'notes' as const}
 assert.equal(processedMigrationClient({...row,documents:[document]},[receipt]),undefined,'a new PDF must remain available for review')
 assert.equal(processedMigrationClient({...row,documents:[document]},[{...receipt,documentHashes:[document.sha256]}])?.caseId,receipt.caseId)
 assert.equal(processedMigrationClient({...row,sourceKey:'fixture:new-export'},[receipt])?.caseId,receipt.caseId)
 assert.equal(processedMigrationClient({...row,sourceKey:'fixture:new-export',birthDate:'2000-01-02'},[receipt]),undefined)
 assert.equal(processedMigrationClient({...row,professionalId:'another-pro'},[receipt]),undefined)
 assert.equal(processedMigrationClient({...row,sourceKey:'fixture:new-export',service:'Autre service'},[receipt]),undefined)
 assert.equal(processedMigrationClient({...row,sourceKey:'fixture:new-export'},[receipt,{...receipt,sourceKey:'fixture:other',caseId:'other-case'}]),undefined)
 assert.equal(processedMigrationClient({...row,birthDate:'2000-01-02'},[receipt])?.caseId,receipt.caseId,'same source previously corrected by operator is not reimported')
})
test('destination simplifiée : candidat unique à vérifier, sans confirmer une naissance contradictoire',()=>{
 const row={...emptyMigrationRow('fixture:identity'),firstName:'Client',lastName:'Fictif',birthDate:'2000-01-02',professionalId:'pro-fictif',service:'Psychoéducation'}
 const person={id:'patient-fictif',firstName:row.firstName,lastName:row.lastName,birthDate:'2000-01-01',email:'',phone:'',version:1,cases:[{id:'case-fictif',label:'Suivi',status:'open',professionalIds:[row.professionalId]}]}
 const candidate=prefillMigrationRow(row,[person])
 assert.equal(candidate.patientId,person.id);assert.equal(candidate.caseId,'case-fictif');assert.equal(candidate.associationConfirmed,false)
 assert.equal(migrationBirthDateConflict(candidate,[person]),true)
 const corrected=prefillMigrationRow({...candidate,birthDate:'2000-01-01'},[person])
 assert.equal(corrected.patientId,person.id);assert.equal(corrected.associationConfirmed,true);assert.equal(migrationBirthDateConflict(corrected,[person]),false)
 const ambiguous=prefillMigrationRow(row,[person,{...person,id:'homonym-fictif'}]);assert.equal(ambiguous.patientId,'');assert.equal(ambiguous.associationConfirmed,false)
})
