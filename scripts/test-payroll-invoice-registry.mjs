// PostgreSQL embarqué uniquement en mémoire; aucun .env ni accès distant.
// Installer PGlite hors des dépendances de l'app puis fournir son module explicitement.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PGLITE_MODULE_PATH) throw new Error('PGLITE_MODULE_PATH doit désigner un module PGlite local pour une base jetable en mémoire.')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
const proA = '00000000-0000-4000-8000-000000000001'
const proB = '00000000-0000-4000-8000-000000000002'
const actor = '00000000-0000-4000-8000-000000000010'
const snapshot = { templateVersion: 2, period: { startDate:'2026-10-19',endDate:'2026-11-01',dueDate:'2026-11-06' }, invoice:{ grandTotal:276 } }
async function prepare({ pro=proA, start='2026-10-19', end='2026-11-01', action='prepare', snap=snapshot, expected=null, reason=null, number=null, bytes=null, sha=null, name=null, signed=false }={}) {
  const result=await db.query('select public.prepare_payroll_invoice($1,$2::date,$3::date,$4,$5::jsonb,$6,$7::integer,$8,$9,$10,$11,$12,$13::boolean) as record',
    [pro,start,end,actor,snap ? JSON.stringify(snap):null,action,expected,reason,number,bytes,sha,name,signed])
  return result.rows[0].record
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.profiles(id uuid primary key); insert into public.profiles values('${proA}'),('${proB}');`)
  await db.exec(await readFile(new URL('../supabase/payroll-invoice-registry.sql',import.meta.url),'utf8'))
  await assert.rejects(prepare(),/HISTORICAL/,'La migration bloque les émissions tant que la reprise comptable n’est pas validée')
  await db.exec("update public.payroll_invoice_registry_settings set historical_through=date '2026-10-18' where singleton")
  const [a,aRetry,b]=await Promise.all([prepare(),prepare(),prepare({pro:proB})])
  assert.equal(a.id,aRetry.id,'Répétition simultanée : une seule identité')
  assert.equal(a.version,1)
  assert.notEqual(a.id,b.id)
  assert.notEqual(a.number,b.number,'Deux professionnels avec mêmes initiales : numéros globaux distincts')
  await db.query("update public.payroll_invoice_versions set document_base64='QQ==',document_sha256='empreinte-fictive',document_name='b.docx' where invoice_id=$1 and version=1",[b.id])
  const competing=await Promise.allSettled([prepare({pro:proB,action:'revise',expected:1,reason:'Première correction concurrente',snap:{...snapshot,invoice:{grandTotal:201.56}}}),
    prepare({pro:proB,action:'revise',expected:1,reason:'Deuxième correction concurrente',snap:{...snapshot,invoice:{grandTotal:276.01}}})])
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1,'Une seule correction concurrente acceptée')
  assert.equal(competing.filter(r=>r.status==='rejected').length,1)
  await assert.rejects(prepare({snap:{...snapshot,invoice:{grandTotal:200}}}),/CONFLICT/)
  await db.query("update public.payroll_invoice_versions set document_base64='T1JJR0lOQUw=',document_sha256='empreinte-fictive',document_name='original.docx' where invoice_id=$1 and version=1",[a.id])
  const corrected={...snapshot,invoice:{grandTotal:276,title:'Titre corrigé'}}
  const revision=await prepare({action:'revise',expected:1,reason:'Correction du titre uniquement',snap:corrected})
  assert.equal(revision.id,a.id); assert.equal(revision.number,a.number); assert.equal(revision.version,2)
  const retry=await prepare({action:'revise',expected:1,reason:'Correction du titre uniquement',snap:corrected})
  assert.equal(retry.version,2,'Réponse perdue puis réessai : pas de version 3')
  await assert.rejects(prepare({action:'revise',expected:1,reason:'Autre correction concurrente',snap:{...corrected,invoice:{grandTotal:300}}}),/CONFLICT/)
  await assert.rejects(db.query("update public.payroll_invoice_versions set snapshot='{}' where invoice_id=$1 and version=1",[a.id]),/immuable/)
  await assert.rejects(db.query('delete from public.payroll_invoices where id=$1',[a.id]),/immuable/)
  await assert.rejects(db.exec('truncate public.payroll_invoice_versions'),/immuable/)
  const old=(await db.query('select * from public.payroll_invoice_versions where invoice_id=$1 and version=1',[a.id])).rows[0]
  assert.equal(old.document_base64,'T1JJR0lOQUw=')
  assert.equal(old.snapshot.invoice.grandTotal,276)
  await assert.rejects(prepare({start:'2026-10-05',end:'2026-10-18'}),/HISTORICAL/)
  const legacyA=await prepare({start:'2026-10-05',end:'2026-10-18',action:'import',snap:null,number:'PEA-AG-021',bytes:'T1JJR0lOQUw=',sha:'a',name:'signed-original.pdf',signed:true})
  const legacyB=await prepare({pro:proB,start:'2026-10-05',end:'2026-10-18',action:'import',snap:null,number:'PEA-AG-021',bytes:'QVVUUkU=',sha:'b',name:'other-original.docx',signed:null})
  assert.notEqual(legacyA.id,legacyB.id); assert.equal(legacyA.number,legacyB.number)
  const correctedLegacy=await prepare({start:'2026-10-05',end:'2026-10-18',action:'revise',expected:1,reason:'Correction de présentation uniquement',snap:corrected})
  assert.equal(correctedLegacy.id,legacyA.id); assert.equal(correctedLegacy.version,2)
  assert.equal(correctedLegacy.originalSigned,false,'La signature de v1 ne vaut pas approbation de v2')
  await assert.rejects(db.query("update public.payroll_invoice_versions set document_base64='FAUX' where invoice_id=$1 and version=1",[legacyA.id]),/immuable/)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from public.payroll_invoice_versions'),/permission denied/)
  await assert.rejects(prepare(),/permission denied/)
  await db.exec('reset role')
  console.log('Registre PostgreSQL en mémoire : identités, collisions, répétitions, CAS, originaux, signatures, immutabilité et permissions vérifiés.')
} finally { await db.close() }
