// Base jetable locale exclusivement. Aucun fichier de production ni courriel.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
if (!process.env.PGLITE_MODULE_PATH) throw Error('Module PGlite local requis.')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002'
const snap = total => ({ invoice: { grandTotal: total }, period: { startDate:'2026-10-19',endDate:'2026-11-01' } })
const prepare = async (pro=a,action='prepare',snapshot=snap(200),expected=null,start='2026-10-19',end='2026-11-01') => (await db.query('select public.prepare_payroll_invoice($1,$2,$3,$1,$4,$5,$6,$7) as r',[pro,start,end,snapshot,action,expected,'Correction manuelle fictive'])).rows[0].r
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.profiles(id uuid primary key); insert into public.profiles values('${a}'),('${b}');`)
  await db.exec(await readFile(new URL('../supabase/payroll-invoice-registry.sql',import.meta.url),'utf8'))
  await db.exec("update public.payroll_invoice_registry_settings set historical_through='2026-10-18'")
  const legacy=(await db.query("select public.prepare_payroll_invoice($1,'2026-10-05','2026-10-18',$1,null,'import',null,null,'PEA-AG-021','T0xE','old-sha','signed.pdf',true) r",[a])).rows[0].r
  await db.exec(await readFile(new URL('../supabase/payroll-invoice-current.sql',import.meta.url),'utf8'))
  await assert.rejects(prepare(),/dernière référence/)
  await db.query("insert into public.payroll_invoice_counters values($1,'PEA-AGB',21,'Référence fictive confirmée'),($2,'PEA-AGO',21,'Référence fictive confirmée')",[a,b])
  await assert.rejects(db.query("update public.payroll_invoice_counters set prefix='PEA-AGB' where professional_id=$1",[b]),/unique/)
  const [first,retry,other]=await Promise.all([prepare(),prepare(),prepare(b)])
  assert.equal(first.number,'PEA-AGB-022'); assert.equal(other.number,'PEA-AGO-022'); assert.equal(first.id,retry.id)
  assert.equal((await prepare(a,'prepare',snap(999))).snapshot.invoice.grandTotal,200,'Retélécharger ne remplace pas une facture')
  await db.query("update public.payroll_invoice_versions set document_base64='T0xE',document_sha256='old-sha',document_name='old.docx' where invoice_id=$1",[first.id])
  const [corrected,collision]=await Promise.allSettled([prepare(a,'revise',snap(180),1),prepare(a,'revise',snap(170),1)])
  assert.equal(corrected.status,'fulfilled'); assert.equal(collision.status,'rejected')
  assert.equal(corrected.value.id,first.id);assert.equal(corrected.value.number,first.number);assert.equal(corrected.value.version,2)
  const versions=(await db.query('select * from public.payroll_invoice_versions where invoice_id=$1',[first.id])).rows
  assert.equal(versions.length,1);assert.equal(versions[0].version,2);assert.equal(versions[0].document_base64,null)
  assert.equal((await prepare(a,'revise',snap(180),1)).version,2,'Retry après réponse perdue idempotent')
  const oldCorrected=await prepare(a,'revise',snap(180),1,'2026-10-05','2026-10-18')
  assert.equal(oldCorrected.id,legacy.id);assert.equal(oldCorrected.number,'PEA-AG-021');assert.equal(oldCorrected.originalSigned,false)
  assert.equal((await db.query('select count(*)::int n from public.payroll_invoice_versions where invoice_id=$1 and original_signed',[legacy.id])).rows[0].n,0)
  const next=await prepare(a,'prepare',snap(200),null,'2026-11-02','2026-11-15');assert.equal(next.number,'PEA-AGB-023')
  await assert.rejects(db.query('delete from public.payroll_invoice_versions where invoice_id=$1',[first.id]),/protégée/)
  await db.exec('set role authenticated')
  await assert.rejects(prepare(),/permission denied/)
  await assert.rejects(db.query('select * from public.payroll_invoice_counters'),/permission denied/)
  await db.exec('reset role')
  console.log('Facture courante : remplacement, suppression des anciens octets/signatures, séquences individuelles, collisions, concurrence, retries et droits validés.')
} finally { await db.close() }
