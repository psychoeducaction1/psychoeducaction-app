-- Restriction Satisfaction au super administrateur.
-- A revoir puis appliquer manuellement APRES satisfaction-clients.sql.
-- Aucun changement de donnees. Ne pas executer en production sans autorisation.
begin;

-- Meme compte configure que lib/superAdmin.ts, email du JWT signe et role du profil.
create or replace function public.is_satisfaction_super_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_direction()
    and lower(btrim(coalesce(auth.jwt()->>'email', ''))) = 'contact@psychoeducaction.com'
$$;

revoke all on function public.is_satisfaction_super_admin() from public;
grant execute on function public.is_satisfaction_super_admin() to authenticated;

alter table public.satisfaction_imports enable row level security;
alter table public.satisfaction_eligibles enable row level security;
alter table public.satisfaction_envois enable row level security;
alter table public.satisfaction_desabonnes enable row level security;
alter table public.satisfaction_reponses enable row level security;

drop policy if exists "satisfaction_imports_direction" on public.satisfaction_imports;
drop policy if exists "satisfaction_imports_super_admin" on public.satisfaction_imports;
create policy "satisfaction_imports_super_admin"
on public.satisfaction_imports for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

-- Bloque aussi un acces elargi par une autre politique permissive.
drop policy if exists "satisfaction_imports_super_admin_gate" on public.satisfaction_imports;
create policy "satisfaction_imports_super_admin_gate"
on public.satisfaction_imports as restrictive for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

drop policy if exists "satisfaction_eligibles_direction" on public.satisfaction_eligibles;
drop policy if exists "satisfaction_eligibles_super_admin" on public.satisfaction_eligibles;
create policy "satisfaction_eligibles_super_admin"
on public.satisfaction_eligibles for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

-- Bloque aussi un acces elargi par une autre politique permissive.
drop policy if exists "satisfaction_eligibles_super_admin_gate" on public.satisfaction_eligibles;
create policy "satisfaction_eligibles_super_admin_gate"
on public.satisfaction_eligibles as restrictive for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

drop policy if exists "satisfaction_envois_direction" on public.satisfaction_envois;
drop policy if exists "satisfaction_envois_super_admin" on public.satisfaction_envois;
create policy "satisfaction_envois_super_admin"
on public.satisfaction_envois for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

-- Bloque aussi un acces elargi par une autre politique permissive.
drop policy if exists "satisfaction_envois_super_admin_gate" on public.satisfaction_envois;
create policy "satisfaction_envois_super_admin_gate"
on public.satisfaction_envois as restrictive for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

drop policy if exists "satisfaction_desabonnes_direction" on public.satisfaction_desabonnes;
drop policy if exists "satisfaction_desabonnes_super_admin" on public.satisfaction_desabonnes;
create policy "satisfaction_desabonnes_super_admin"
on public.satisfaction_desabonnes for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

-- Bloque aussi un acces elargi par une autre politique permissive.
drop policy if exists "satisfaction_desabonnes_super_admin_gate" on public.satisfaction_desabonnes;
create policy "satisfaction_desabonnes_super_admin_gate"
on public.satisfaction_desabonnes as restrictive for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

drop policy if exists "satisfaction_reponses_direction" on public.satisfaction_reponses;
drop policy if exists "satisfaction_reponses_super_admin" on public.satisfaction_reponses;
create policy "satisfaction_reponses_super_admin"
on public.satisfaction_reponses for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

-- Bloque aussi un acces elargi par une autre politique permissive.
drop policy if exists "satisfaction_reponses_super_admin_gate" on public.satisfaction_reponses;
create policy "satisfaction_reponses_super_admin_gate"
on public.satisfaction_reponses as restrictive for all to authenticated
using (public.is_satisfaction_super_admin())
with check (public.is_satisfaction_super_admin());

commit;
