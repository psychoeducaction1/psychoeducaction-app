-- Correctif cible pour les permissions du calendrier marketing.
-- A executer manuellement dans Supabase SQL Editor.
-- Ce script ne modifie aucune donnee existante.

begin;

alter table public.marketing_availability_slots enable row level security;

drop policy if exists "marketing_availability_select_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_insert_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_update_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_delete_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_insert_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_update_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_delete_direction_or_self"
on public.marketing_availability_slots;

create policy "marketing_availability_select_direction_or_self"
on public.marketing_availability_slots
for select
to authenticated
using (
  public.is_marketing_manager()
  or public.is_marketing_staff(staff_id)
);

create policy "marketing_availability_insert_direction_or_self"
on public.marketing_availability_slots
for insert
to authenticated
with check (
  public.is_marketing_manager()
  or public.is_marketing_staff(staff_id)
);

create policy "marketing_availability_update_direction_or_self"
on public.marketing_availability_slots
for update
to authenticated
using (
  public.is_marketing_manager()
  or public.is_marketing_staff(staff_id)
)
with check (
  public.is_marketing_manager()
  or public.is_marketing_staff(staff_id)
);

create policy "marketing_availability_delete_direction_or_self"
on public.marketing_availability_slots
for delete
to authenticated
using (
  public.is_marketing_manager()
  or public.is_marketing_staff(staff_id)
);

grant select, insert, update, delete
on table public.marketing_availability_slots
to authenticated;

commit;
