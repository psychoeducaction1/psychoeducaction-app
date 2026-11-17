import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('bibliothèque SQL : adhésions explicites, RLS, édition versionnée et import sans écrasement', async t => {
  const db = new PGlite()
  const ids = Array.from({ length: 7 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
  const schema = await readFile(new URL('../supabase/procedure-library/001-library.sql', import.meta.url), 'utf8')
  const seed = await readFile(new URL('../supabase/procedure-library/002-onenote-content.sql', import.meta.url), 'utf8')
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table public.profiles(id uuid primary key,platform_access_enabled boolean);
      insert into public.profiles values ${ids.map(id => `('${id}',true)`).join(',')};`)
    await db.exec(schema)
    await db.exec(seed)
    await db.exec(await readFile(new URL('../supabase/procedure-library/003-private-pdfs.sql', import.meta.url), 'utf8'))
    const admin = sql => db.exec('reset role; ' + sql)
    const asUser = async (id, sql, params = []) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)
      try { return await db.query(sql, params) } finally { await db.exec('reset role') }
    }
    let section, article
    await t.test('aucun accès implicite et aucun compte réel activé par la migration', async () => {
      assert.equal((await db.query('select count(*)::int n from public.procedure_library_members')).rows[0].n, 0)
      await assert.rejects(asUser(ids[0], 'select public.procedure_library_snapshot()'), error => error.code === '42501')
      assert.equal((await asUser(ids[0], 'select * from public.procedure_library_articles')).rows.length, 0)
      await admin(`insert into public.procedure_library_members(profile_id,can_edit) values ${ids.slice(0,5).map(id => `('${id}',true)`).join(',')};`)
      for (const id of ids.slice(0,5)) {
        const snapshot = (await asUser(id, 'select public.procedure_library_snapshot() value')).rows[0].value
        assert.equal(snapshot.sections.length, 4); assert.equal(snapshot.articles.length, 15)
        assert.equal(snapshot.canEdit, true)
        section = snapshot.sections[0].id; article = snapshot.articles.find(a => a.title === 'Gestion de la liste d’attente').id
      }
      await assert.rejects(asUser(ids[5], 'select public.procedure_library_snapshot()'), error => error.code === '42501')
    })
    await t.test('modification et historique atomiques, ancienne version refusée, auteur dérivé de la session', async () => {
      const sql = 'select public.procedure_library_save_article($1,$2,$3,$4,$5,$6,$7) value'
      const args = [article, section, 'Procédure fictive mise à jour', 'Texte fictif conservé.', ['mot'], 'current', 1]
      const ack = (await asUser(ids[0], sql, args)).rows[0].value
      assert.equal(ack.version, 2)
      await assert.rejects(asUser(ids[1], sql, args), error => error.code === '40001')
      const revisions = (await db.query('select version,edited_by from public.procedure_library_revisions where article_id=$1 order by version', [article])).rows
      assert.deepEqual(revisions.map(r => r.version), [1, 2]); assert.equal(revisions[1].edited_by, ids[0])
      await db.exec(seed)
      assert.equal((await db.query('select body from public.procedure_library_articles where id=$1', [article])).rows[0].body, 'Texte fictif conservé.')
    })
    await t.test('ajout de section et fiche, double création refusée et aucune suppression directe', async () => {
      const sid = '30000000-0000-4000-8000-000000000001', aid = '40000000-0000-4000-8000-000000000001'
      await asUser(ids[0], 'select public.procedure_library_save_section($1,$2,0)', [sid, 'Section fictive'])
      await asUser(ids[0], 'select public.procedure_library_save_article($1,$2,$3,$4,$5,$6,0)', [aid, sid, 'Fiche fictive', '<script>contenu en texte</script>', [], 'draft'])
      await assert.rejects(asUser(ids[0], 'select public.procedure_library_save_article($1,$2,$3,$4,$5,$6,0)', ['40000000-0000-4000-8000-000000000002', sid, 'Fiche vide', '', [], 'current']), error => error.code === '22023')
      await assert.rejects(asUser(ids[0], 'select public.procedure_library_save_section($1,$2,0)', [sid, 'Doublon']), error => error.code === '23505')
      for (const sql of ['delete from public.procedure_library_articles', "update public.procedure_library_articles set body='forgé'", 'delete from public.procedure_library_revisions', 'update public.procedure_library_members set can_edit=true']) await assert.rejects(asUser(ids[0], sql), error => error.code === '42501')
    })
    await t.test('PDF privés : cinq membres, versions immuables, reprise idempotente et refus des écritures directes', async () => {
      const fid = '70000000-0000-4000-8000-000000000001', next = '70000000-0000-4000-8000-000000000002'
      const sql = 'select public.procedure_library_save_pdf($1,$2,$3,$4,$5,$6,$7) v'
      const args = [fid, article, fid, 0, 'Guide fictif', 'guide.pdf', Buffer.from('%PDF-fictif').toString('base64')]
      assert.equal((await asUser(ids[0], sql, args)).rows[0].v.version, 1)
      assert.equal((await asUser(ids[0], sql, args)).rows[0].v.version, 1)
      for (const id of ids.slice(0,5)) {
        const list = (await asUser(id, 'select public.procedure_library_list_pdfs($1) v', [article])).rows[0].v
        assert.equal(list.length, 1); assert.equal('bytesBase64' in list[0], false)
        assert.equal((await asUser(id, 'select public.procedure_library_read_pdf($1) v', [fid])).rows[0].v.bytesBase64, args[6])
      }
      await assert.rejects(asUser(ids[5], 'select public.procedure_library_read_pdf($1)', [fid]), e => e.code === '42501')
      await assert.rejects(asUser(ids[5], sql, args), e => e.code === '42501')
      await asUser(ids[0], sql, [next, article, fid, 1, 'Guide révisé', 'guide.pdf', args[6]])
      await assert.rejects(asUser(ids[1], sql, ['70000000-0000-4000-8000-000000000003', article, fid, 1, 'Conflit', 'guide.pdf', args[6]]), e => e.code === '40001')
      assert.equal((await asUser(ids[0], 'select public.procedure_library_list_pdfs($1) v', [article])).rows[0].v.length, 2)
      assert.equal((await asUser(ids[0], 'select public.procedure_library_read_pdf($1) v', [fid])).rows[0].v.version, 1)
      for (const statement of ['select bytes from public.procedure_library_pdfs', 'delete from public.procedure_library_pdfs', "update public.procedure_library_pdfs set label='forgé'"]) await assert.rejects(asUser(ids[0], statement), e => e.code === '42501')
      await admin(`update public.procedure_library_members set can_edit=false where profile_id='${ids[4]}';`)
      await assert.rejects(asUser(ids[4], sql, args), e => e.code === '42501')
      await admin(`update public.procedure_library_members set active=false where profile_id='${ids[4]}';`)
      await assert.rejects(asUser(ids[4], 'select public.procedure_library_read_pdf($1)', [fid]), e => e.code === '42501')
      await admin(`update public.profiles set platform_access_enabled=false where id='${ids[3]}';`)
      await assert.rejects(asUser(ids[3], 'select public.procedure_library_read_pdf($1)', [fid]), e => e.code === '42501')
    })
    await t.test('lecture seule, révocation et désactivation plateforme prennent effet aussi par RPC', async () => {
      await admin(`update public.procedure_library_members set can_edit=false where profile_id='${ids[0]}';`)
      assert.equal((await asUser(ids[0], 'select public.procedure_library_snapshot() v')).rows[0].v.canEdit, false)
      await assert.rejects(asUser(ids[0], 'select public.procedure_library_save_section($1,$2,0)', ['50000000-0000-4000-8000-000000000001', 'Refus']), error => error.code === '42501')
      await admin(`update public.procedure_library_members set active=false where profile_id='${ids[1]}';update public.profiles set platform_access_enabled=false where id='${ids[2]}';`)
      for (const id of [ids[1], ids[2]]) {
        assert.equal((await asUser(id, 'select * from public.procedure_library_articles')).rows.length, 0)
        await assert.rejects(asUser(id, 'select public.procedure_library_snapshot()'), error => error.code === '42501')
        await assert.rejects(asUser(id, 'select public.procedure_library_save_section($1,$2,0)', ['60000000-0000-4000-8000-000000000001', 'Refus']), error => error.code === '42501')
      }
    })
  } finally { await db.close() }
})
