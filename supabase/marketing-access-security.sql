-- Restreint l'espace marketing au super administrateur et a Camille.
-- A executer manuellement dans Supabase SQL Editor.
-- Ce script ne modifie aucune donnee existante.

begin;

create or replace function public.is_marketing_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'direction'
      and lower(coalesce(auth.jwt() ->> 'email', '')) =
        'contact@psychoeducaction.com'
  )
$$;

revoke all on function public.is_marketing_manager() from public;
grant execute on function public.is_marketing_manager() to authenticated;

drop policy if exists "marketing_staff_select_direction_or_self"
on public.marketing_staff;
drop policy if exists "marketing_staff_write_direction"
on public.marketing_staff;
drop policy if exists "marketing_tasks_select_direction_or_self"
on public.marketing_tasks;
drop policy if exists "marketing_tasks_insert_direction_or_self"
on public.marketing_tasks;
drop policy if exists "marketing_tasks_update_direction"
on public.marketing_tasks;
drop policy if exists "marketing_tasks_delete_direction"
on public.marketing_tasks;
drop policy if exists "marketing_task_notes_select_direction_or_self"
on public.marketing_task_notes;
drop policy if exists "marketing_task_notes_insert_direction_or_self"
on public.marketing_task_notes;
drop policy if exists "marketing_task_files_select_direction_or_self"
on public.marketing_task_files;
drop policy if exists "marketing_task_files_insert_direction_or_self"
on public.marketing_task_files;
drop policy if exists "marketing_task_files_delete_direction_or_uploader"
on public.marketing_task_files;
drop policy if exists "marketing_availability_select_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_insert_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_update_direction_or_self"
on public.marketing_availability_slots;
drop policy if exists "marketing_availability_delete_direction_or_self"
on public.marketing_availability_slots;

create policy "marketing_staff_select_direction_or_self"
on public.marketing_staff for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(id));

create policy "marketing_staff_write_direction"
on public.marketing_staff for all to authenticated
using (public.is_marketing_manager())
with check (public.is_marketing_manager());

create policy "marketing_tasks_select_direction_or_self"
on public.marketing_tasks for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_tasks_insert_direction_or_self"
on public.marketing_tasks for insert to authenticated
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_tasks_update_direction"
on public.marketing_tasks for update to authenticated
using (public.is_marketing_manager())
with check (public.is_marketing_manager());

create policy "marketing_tasks_delete_direction"
on public.marketing_tasks for delete to authenticated
using (public.is_marketing_manager());

create policy "marketing_task_notes_select_direction_or_self"
on public.marketing_task_notes for select to authenticated
using (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (
        public.is_marketing_manager()
        or public.is_marketing_staff(task.staff_id)
      )
  )
);

create policy "marketing_task_notes_insert_direction_or_self"
on public.marketing_task_notes for insert to authenticated
with check (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (
        public.is_marketing_manager()
        or public.is_marketing_staff(task.staff_id)
      )
  )
);

create policy "marketing_task_files_select_direction_or_self"
on public.marketing_task_files for select to authenticated
using (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (
        public.is_marketing_manager()
        or public.is_marketing_staff(task.staff_id)
      )
  )
);

create policy "marketing_task_files_insert_direction_or_self"
on public.marketing_task_files for insert to authenticated
with check (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (
        public.is_marketing_manager()
        or public.is_marketing_staff(task.staff_id)
      )
  )
);

create policy "marketing_task_files_delete_direction_or_uploader"
on public.marketing_task_files for delete to authenticated
using (public.is_marketing_manager() or uploaded_by = auth.uid());

create policy "marketing_availability_select_direction_or_self"
on public.marketing_availability_slots for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_insert_direction_or_self"
on public.marketing_availability_slots for insert to authenticated
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_update_direction_or_self"
on public.marketing_availability_slots for update to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id))
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_delete_direction_or_self"
on public.marketing_availability_slots for delete to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

drop policy if exists "marketing_storage_select" on storage.objects;
drop policy if exists "marketing_storage_insert" on storage.objects;
drop policy if exists "marketing_storage_delete" on storage.objects;

create policy "marketing_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'marketing-task-files'
  and (
    public.is_marketing_manager()
    or public.is_marketing_staff(((storage.foldername(name))[1])::uuid)
  )
);

create policy "marketing_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'marketing-task-files'
  and (
    public.is_marketing_manager()
    or public.is_marketing_staff(((storage.foldername(name))[1])::uuid)
  )
);

create policy "marketing_storage_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'marketing-task-files'
  and (public.is_marketing_manager() or owner_id = auth.uid()::text)
);

commit;
