// PostgreSQL en mémoire seulement, aucune donnée ou connexion réelle.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
if (!process.env.PGLITE_MODULE_PATH) throw new Error('PGLITE_MODULE_PATH requis')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
try {
  await db.exec(`create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('fixture.actor',true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('fixture.role',true) $$;
    create table profiles(id uuid primary key default gen_random_uuid(), full_name text, role text, platform_access_enabled boolean default true);
    insert into profiles(full_name,role) values ('Patrick Fixture','professionnel'),('Louis-Nicolas Fixture','professionnel'),('Hicham Fixture','professionnel'),('Camille Fixture','professionnel');`)
  await db.exec(await readFile('supabase/professional-civility.sql','utf8'))
  const seed = await readFile('supabase/professional-civility-initialization.sql','utf8')
  await db.exec(seed)
  const rows = (await db.query('select professional_civility from profiles order by full_name')).rows
  assert.deepEqual(rows.map(r=>r.professional_civility),['Mme','M.','M.','M.'])
  await db.exec(seed)
  await db.exec(`insert into profiles(full_name,role) values ('Future Fixture','professionnel')`)
  assert.equal((await db.query("select professional_civility from profiles where full_name='Future Fixture'")).rows[0].professional_civility,null)
  await assert.rejects(db.exec("update profiles set professional_civility='Mme.'"),/check constraint/)
  await db.exec("insert into profiles(full_name,role) values ('Patrick Autre Fixture','professionnel')")
  await assert.rejects(db.exec(seed),/identité absente ou ambiguë/)
  await db.exec('rollback')
  await db.exec("set fixture.actor='10000000-0000-4000-8000-000000000001'; set fixture.role='authenticated'")
  await assert.rejects(db.exec("update profiles set professional_civility='M.' where full_name='Camille Fixture'"),/réservée à la direction/)
  await db.exec("insert into profiles(id,role) values ('10000000-0000-4000-8000-000000000001','direction')")
  await db.exec("update profiles set professional_civility='M.' where full_name='Camille Fixture'")
  await db.exec("update profiles set platform_access_enabled=false where role='direction'")
  await assert.rejects(db.exec("update profiles set professional_civility='Mme' where full_name='Camille Fixture'"),/réservée à la direction/)
  console.log('Civilités : migration, initialisation, répétition, ambiguïté, absence de défaut et autorisations vérifiées.')
} finally { await db.close() }
