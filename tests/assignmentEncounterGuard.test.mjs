import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const source = new URL('../supabase/clinical/assignment-non-service-encounter-guard.sql', import.meta.url)
const pro = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000001'
const episode = '30000000-0000-4000-8000-000000000001'

test('garde SQL hors ligne : service non pris uniquement avant une rencontre, pour professionnel et direction', async t => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create role fixture_professional; create role fixture_direction; create role fixture_other;
      create schema clinical;
      create table public.assigned_clients(id uuid primary key,professional_id uuid,is_active boolean);
      create table clinical.service_episodes(id uuid primary key);
      create table clinical.legacy_assignment_links(source_table text,source_id uuid,episode_id uuid);
      create table clinical.appointments(id serial primary key,episode_id uuid,kind text,status text,end_at timestamptz);
      insert into public.assigned_clients values('${id}','${pro}',true);
      insert into clinical.service_episodes values('${episode}');
      insert into clinical.legacy_assignment_links values('assigned_clients','${id}','${episode}');
      alter table public.assigned_clients enable row level security;
      grant select,update on public.assigned_clients to fixture_professional,fixture_direction,fixture_other;
      create policy fixture_access on public.assigned_clients using
        (current_user='fixture_direction' or current_user='fixture_professional' and professional_id='${pro}');
    `)
    const sql = await readFile(source, 'utf8')
    await db.exec(sql)
    // Reapplication must preserve the installed trigger and existing rows.
    await db.exec(sql)
    const active = async () => (await db.query(`select is_active from public.assigned_clients where id='${id}'`)).rows[0].is_active
    const update = async role => {
      await db.exec(`set role ${role}`)
      try { return await db.query(`update public.assigned_clients set is_active=false where id='${id}' returning id`) }
      finally { await db.exec('reset role') }
    }
    const reset = async (kind, status, end, ep = episode) => {
      await db.exec('delete from clinical.appointments')
      await db.exec(`update public.assigned_clients set is_active=true where id='${id}'`)
      if (kind) await db.query('insert into clinical.appointments(episode_id,kind,status,end_at) values($1,$2,$3,$4)', [ep, kind, status, end])
    }
    await t.test('aucune rencontre ou rendez-vous futur : changement permis et rendez-vous conservés', async () => {
      for (const role of ['fixture_professional', 'fixture_direction']) {
        await reset(null)
        assert.equal((await update(role)).rows.length, 1)
        assert.equal(await active(), false)
        await reset('meeting', 'planned', '2999-01-01T12:00:00Z')
        await update(role)
        assert.equal(await active(), false)
        assert.equal((await db.query('select count(*)::int n from clinical.appointments')).rows[0].n, 1)
      }
    })
    await t.test('rencontre effectuée ou planifiée écoulée : refus atomique dans les deux contextes', async () => {
      for (const role of ['fixture_professional', 'fixture_direction']) {
        for (const status of ['completed', 'planned']) {
          await reset('meeting', status, '2000-01-01T12:00:00Z')
          await assert.rejects(update(role), error => error.code === '40001' && error.message === 'ASSIGNMENT_ENCOUNTER_EXISTS')
          assert.equal(await active(), true)
        }
      }
    })
    await t.test('annulation, absence, rédaction et rencontre d’un autre épisode ne comptent pas', async () => {
      for (const [kind, status] of [['meeting', 'cancelled'], ['meeting', 'no_show'], ['documentation', 'completed']]) {
        await reset(kind, status, '2000-01-01T12:00:00Z')
        await update('fixture_professional')
        assert.equal(await active(), false)
      }
      await reset('meeting', 'completed', '2000-01-01T12:00:00Z', '30000000-0000-4000-8000-000000000002')
      await update('fixture_professional')
      assert.equal(await active(), false)
    })
    await t.test('RLS existante conservée et fonction privée non appelable directement', async () => {
      await reset(null)
      assert.equal((await update('fixture_other')).rows.length, 0)
      assert.equal(await active(), true)
      const privileges = await db.query("select has_function_privilege('authenticated','clinical.guard_assignment_non_service_encounters()','execute') allowed")
      assert.equal(privileges.rows[0].allowed, false)
    })
    await t.test('service déjà pris sans lien clinique : vérification obligatoire ; nouveau refus sans service préalable permis', async () => {
      await reset(null)
      await db.exec('delete from clinical.legacy_assignment_links')
      await assert.rejects(update('fixture_direction'), error => error.message === 'ASSIGNMENT_ENCOUNTER_LINK_REQUIRED')
      assert.equal(await active(), true)
      await db.exec(`update public.assigned_clients set is_active=null where id='${id}'`)
      await update('fixture_professional')
      assert.equal(await active(), false)
    })
  } finally { await db.close() }
})
