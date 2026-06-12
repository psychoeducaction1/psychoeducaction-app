-- Supabase RLS hardening for the assignment module.
-- Review and run from the Supabase SQL Editor after the test cleanup/import plan is approved.

begin;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.is_direction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'direction', false)
$$;

create or replace function public.sync_waiting_list_status_for_assigned_client(
  assigned_client_id uuid,
  next_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_waiting_list_client_id uuid;
begin
  select ac.waiting_list_client_id
  into linked_waiting_list_client_id
  from public.assigned_clients ac
  where ac.id = assigned_client_id
    and (
      public.is_direction()
      or ac.professional_id = auth.uid()
    )
  limit 1;

  if linked_waiting_list_client_id is null then
    return;
  end if;

  update public.waiting_list_clients
  set status = case
    when next_is_active is true then 'active'
    when next_is_active is false then 'closed'
    else 'assigned'
  end
  where id = linked_waiting_list_client_id;
end;
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.is_direction() from public;
revoke all on function public.sync_waiting_list_status_for_assigned_client(uuid, boolean) from public;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_direction() to authenticated;
grant execute on function public.sync_waiting_list_status_for_assigned_client(uuid, boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.assignment_requests enable row level security;
alter table public.assigned_clients enable row level security;
alter table public.waiting_list_clients enable row level security;

drop policy if exists "profiles_select_own_or_direction" on public.profiles;
drop policy if exists "profiles_insert_direction" on public.profiles;
drop policy if exists "profiles_update_direction" on public.profiles;
drop policy if exists "profiles_update_own_professional" on public.profiles;
drop policy if exists "profiles_delete_direction" on public.profiles;

create policy "profiles_select_own_or_direction"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_direction()
);

create policy "profiles_insert_direction"
on public.profiles
for insert
to authenticated
with check (public.is_direction());

create policy "profiles_update_direction"
on public.profiles
for update
to authenticated
using (public.is_direction())
with check (public.is_direction());

create policy "profiles_update_own_professional"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  and role = 'professionnel'
)
with check (
  id = auth.uid()
  and role = 'professionnel'
);

create policy "profiles_delete_direction"
on public.profiles
for delete
to authenticated
using (public.is_direction());

drop policy if exists "assignment_requests_select_own_or_direction" on public.assignment_requests;
drop policy if exists "assignment_requests_insert_own_or_direction" on public.assignment_requests;
drop policy if exists "assignment_requests_update_own_or_direction" on public.assignment_requests;
drop policy if exists "assignment_requests_delete_direction" on public.assignment_requests;

create policy "assignment_requests_select_own_or_direction"
on public.assignment_requests
for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "assignment_requests_insert_own_or_direction"
on public.assignment_requests
for insert
to authenticated
with check (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "assignment_requests_update_own_or_direction"
on public.assignment_requests
for update
to authenticated
using (
  professional_id = auth.uid()
  or public.is_direction()
)
with check (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "assignment_requests_delete_direction"
on public.assignment_requests
for delete
to authenticated
using (public.is_direction());

drop policy if exists "assigned_clients_select_own_or_direction" on public.assigned_clients;
drop policy if exists "assigned_clients_insert_direction" on public.assigned_clients;
drop policy if exists "assigned_clients_update_own_or_direction" on public.assigned_clients;
drop policy if exists "assigned_clients_delete_direction" on public.assigned_clients;

create policy "assigned_clients_select_own_or_direction"
on public.assigned_clients
for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "assigned_clients_insert_direction"
on public.assigned_clients
for insert
to authenticated
with check (public.is_direction());

create policy "assigned_clients_update_own_or_direction"
on public.assigned_clients
for update
to authenticated
using (
  professional_id = auth.uid()
  or public.is_direction()
)
with check (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "assigned_clients_delete_direction"
on public.assigned_clients
for delete
to authenticated
using (public.is_direction());

drop policy if exists "waiting_list_clients_select_direction" on public.waiting_list_clients;
drop policy if exists "waiting_list_clients_insert_direction" on public.waiting_list_clients;
drop policy if exists "waiting_list_clients_update_direction" on public.waiting_list_clients;
drop policy if exists "waiting_list_clients_delete_direction" on public.waiting_list_clients;

create policy "waiting_list_clients_select_direction"
on public.waiting_list_clients
for select
to authenticated
using (public.is_direction());

create policy "waiting_list_clients_insert_direction"
on public.waiting_list_clients
for insert
to authenticated
with check (public.is_direction());

create policy "waiting_list_clients_update_direction"
on public.waiting_list_clients
for update
to authenticated
using (public.is_direction())
with check (public.is_direction());

create policy "waiting_list_clients_delete_direction"
on public.waiting_list_clients
for delete
to authenticated
using (public.is_direction());

commit;
