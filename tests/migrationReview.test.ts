import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyMigrationRow} from '../lib/clinical-migration/model.ts'
import {migrationReviewQueue,filterMigrationReviewQueue,visibleMigrationReviewQueue,attachMigrationDocuments} from '../lib/clinical-migration/review.ts'
import {createMigrationWorkbookStager,saveMigrationWithReceipt} from '../lib/clinical-migration/submission.ts'
const row=(sourceKey:string)=>({...emptyMigrationRow(sourceKey),firstName:'Émilie',lastName:'Exemple',birthDate:'2000-01-01',professionalId:'pro-fictif',service:'Psychoéducation',decision:'create' as const})

test('file : validations cohérentes, filtres, recherche accentuée et index conservés',()=>{
 const entries=[{index:2,row:row('fixture:ready')},{index:5,row:{...row('fixture:blocked'),firstName:'Autre',service:'À préciser'}},{index:7,row:{...row('fixture:ignored'),decision:'skip' as const}}]
 const q=migrationReviewQueue(entries,[])
 assert.deepEqual(q.map(entry=>entry.state),['ready','blocked','skipped'])
 assert.match(q[1].issues[0],/service requis/);assert.doesNotMatch(q[1].issues[0],/Ligne 1/)
 assert.deepEqual(filterMigrationReviewQueue(q,'EMILIE EXEMPLE').map(entry=>entry.index),[2])
 assert.deepEqual(filterMigrationReviewQueue(q,'','blocked').map(entry=>entry.index),[5])
 assert.deepEqual(filterMigrationReviewQueue(q,'','skipped').map(entry=>entry.index),[7])
 const duplicates=migrationReviewQueue([{row:row('fixture:same'),index:0},{row:row('fixture:same'),index:1}],[])
 assert.ok(duplicates.every(entry=>entry.state==='blocked'));assert.notEqual(duplicates[0].key,duplicates[1].key)
})
test('file : corriger le dernier problème conserve la fiche affichée jusqu’à validation',()=>{
 const q=migrationReviewQueue([{index:0,row:row('fixture:edited')},{index:1,row:{...row('fixture:next'),service:'À préciser'}}],[])
 const visible=visibleMigrationReviewQueue(q,'','blocked',q[0].key)
 assert.equal(visible[0].key,q[0].key)
 assert.equal(visibleMigrationReviewQueue(q,'','blocked','')[0].key,q[1].key,'explicit filter/navigation resets the pin')
 assert.equal(visibleMigrationReviewQueue(q.slice(1),'','blocked',q[0].key)[0].key,q[1].key,'a confirmed removal advances')
})
test('PDF : cible traitée refusée, doublon évité, cible par index préservée',()=>{
 const doc={sha256:'a'.repeat(64),name:'Original fictif.pdf',bytes:100,pages:1,kind:'notes' as const}
 const source={...row('fixture:source'),documents:[{...doc,name:'Copie fictive.pdf'}],dates:['2020-01-01']}
 const target={...row('fixture:target'),documents:[doc],dates:['2020-01-02']}
 const untouched={...row('fixture:target')}
 const rows=[source,target,untouched]
 assert.equal(attachMigrationDocuments(rows,0,1,[0]),rows)
 assert.equal(migrationReviewQueue([{row:source,index:0}],[],[],new Set())[0].state,'blocked')
 assert.equal(migrationReviewQueue([{row:source,index:0}],[],[],new Set([doc.sha256]))[0].state,'ready')
 const attached=attachMigrationDocuments(rows,0,1,[0,1,2])
 assert.equal(attached.length,2);assert.equal(attached[0].documents.length,1);assert.equal(attached[0].documents[0].name,doc.name)
 assert.deepEqual(attached[0].dates,['2020-01-02','2020-01-01']);assert.equal(attached[1],untouched)
})
test('Excel : un seul transfert confirmé par lot ; échec et autre lot restent transférables',async()=>{
 const stage=createMigrationWorkbookStager();let uploads=0,finalized=0
 const upload=async()=>{uploads++},finish=async()=>{finalized++}
 await Promise.all([stage('batch1','sha1',upload,finish),stage('batch1','sha1',upload,finish)])
 await stage('batch1','sha1',upload,finish);assert.equal(uploads,1);assert.equal(finalized,1)
 await stage('batch2','sha1',upload,finish);assert.equal(uploads,2)
 await assert.rejects(stage('batch3','sha1',upload,async()=>{throw Error('fixture failure')}))
 await stage('batch3','sha1',upload,finish);assert.equal(uploads,4)
})
test('confirmation perdue : une lecture, aucune seconde écriture ; champs soumis vérifiés',async()=>{
 let writes=0,reads=0;const payload={sourceKey:'fixture:save',preparation:{rateCents:13500,validated:true}}
 const confirmed={items:[{source_key:payload.sourceKey,status:'imported',payload:{preparation:{validated:true,rateCents:13500},sourceKey:payload.sourceKey,serverDefault:true}}]}
 const result=await saveMigrationWithReceipt(async()=>{writes++;throw Object.assign(Error('service unavailable'),{status:503})},async()=>{reads++;return confirmed},payload.sourceKey,payload)
 assert.equal(result,confirmed);assert.equal(writes,1);assert.equal(reads,1)
 await assert.rejects(saveMigrationWithReceipt(async()=>{writes++;throw Error('lost response')},async()=>({...confirmed,items:[{...confirmed.items[0],payload:{...payload,preparation:{...payload.preparation,rateCents:14750}}}]}),payload.sourceKey,payload),/confirmation/)
 assert.equal(writes,2)
})
test('conflit connu et révocation : refus conservé, aucun réessai automatique',async()=>{
 let reads=0;const conflict=Object.assign(Error('conflict'),{status:409})
 await assert.rejects(saveMigrationWithReceipt(async()=>{throw conflict},async()=>{reads++;return{items:[]}},'fixture:save',{}),error=>error===conflict);assert.equal(reads,0)
 const denied=Object.assign(Error('denied'),{status:403})
 await assert.rejects(saveMigrationWithReceipt(async()=>{throw Error('lost response')},async()=>{throw denied},'fixture:save',{}),error=>error===denied)
 await assert.rejects(saveMigrationWithReceipt(async()=>{throw Error('lost response')},async()=>({items:[]}), 'fixture:save',{}),/Consultez le rapport/)
})
