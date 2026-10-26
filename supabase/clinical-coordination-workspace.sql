-- Coordination clinique : nouveau module indépendant du marketing retiré.
-- Préparation locale. Appliquer seulement après validation explicite de production.
begin;
create table public.clinical_coordination_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  full_name text not null, email text not null,
  singleton boolean not null default true unique check(singleton),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.clinical_coordination_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.clinical_coordination_staff(id) on delete restrict,
  title text not null check(length(btrim(title)) between 1 and 300),
  description text check(length(description)<=20000),
  priority text not null default 'normal' check(priority in ('low','normal','high')),
  status text not null default 'pending' check(status in ('pending','in_progress','completed','canceled')),
  due_at timestamptz, completed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.clinical_coordination_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.clinical_coordination_tasks(id) on delete restrict,
  note text not null check(length(btrim(note)) between 1 and 10000),
  author_id uuid not null references public.profiles(id) on delete restrict,
  author_name text not null, created_at timestamptz not null default now()
);
create table public.clinical_coordination_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.clinical_coordination_tasks(id) on delete restrict,
  storage_path text not null unique, file_name text not null,
  mime_type text, file_size bigint check(file_size between 0 and 52428800),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.clinical_coordination_availability_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.clinical_coordination_staff(id) on delete restrict,
  start_at timestamptz not null, end_at timestamptz not null check(end_at>start_at),
  note text check(length(note)<=10000), created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.clinical_coordination_tasks(staff_id,status,due_at);
create index on public.clinical_coordination_task_notes(task_id,created_at);
create index on public.clinical_coordination_task_files(task_id);
create index on public.clinical_coordination_availability_slots(staff_id,start_at);

create function public.can_access_clinical_coordination(target_staff_id uuid, manager_only boolean default false)
returns boolean language sql stable security definer set search_path='' set row_security=off as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.platform_access_enabled is distinct from false
    and ((p.role='direction' and lower(btrim(coalesce(auth.jwt()->>'email','')))='contact@psychoeducaction.com')
      or (not manager_only and p.role='professionnel' and exists(
        select 1 from public.clinical_coordination_staff s where s.id=target_staff_id
          and s.profile_id=p.id and s.is_active))))
$$;
revoke all on function public.can_access_clinical_coordination(uuid,boolean) from public,anon;
grant execute on function public.can_access_clinical_coordination(uuid,boolean) to authenticated;

-- Aucun droit de gestion des membres depuis le navigateur, même pour la direction.
alter table public.clinical_coordination_staff enable row level security;
revoke all on public.clinical_coordination_staff from public,anon,authenticated;
grant select on public.clinical_coordination_staff to authenticated;
create policy staff_private on public.clinical_coordination_staff for select to authenticated
  using(public.can_access_clinical_coordination(id));

alter table public.clinical_coordination_tasks enable row level security;
revoke all on public.clinical_coordination_tasks from public,anon,authenticated;
grant select,insert,update on public.clinical_coordination_tasks to authenticated;
create policy tasks_private on public.clinical_coordination_tasks as restrictive for all to authenticated
  using(public.can_access_clinical_coordination(staff_id)) with check(public.can_access_clinical_coordination(staff_id));
create policy tasks_read on public.clinical_coordination_tasks for select to authenticated using(true);
create policy tasks_create on public.clinical_coordination_tasks for insert to authenticated
  with check(created_by=auth.uid() and status='pending' and completed_at is null);
create policy tasks_manager_update on public.clinical_coordination_tasks for update to authenticated
  using(public.can_access_clinical_coordination(staff_id,true)) with check(public.can_access_clinical_coordination(staff_id,true));

create function public.update_own_clinical_coordination_task_status(target_task_id uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.clinical_coordination_tasks;
begin
  if next_status is null or next_status not in ('pending','in_progress','completed','canceled') then raise exception 'Statut invalide'; end if;
  select * into t from public.clinical_coordination_tasks where id=target_task_id for update;
  if not found or not public.can_access_clinical_coordination(t.staff_id) then raise exception using errcode='42501',message='Accès refusé'; end if;
  if next_status='canceled' and not public.can_access_clinical_coordination(t.staff_id,true) then raise exception using errcode='42501',message='Annulation réservée à la direction'; end if;
  update public.clinical_coordination_tasks set status=next_status,
    completed_at=case when next_status='completed' then now() else null end, updated_at=now() where id=t.id;
end;
$$;
revoke all on function public.update_own_clinical_coordination_task_status(uuid,text) from public,anon;
grant execute on function public.update_own_clinical_coordination_task_status(uuid,text) to authenticated;

create function public.can_access_clinical_coordination_task(target_task_id uuid)
returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select exists(select 1 from public.clinical_coordination_tasks t where t.id=target_task_id and public.can_access_clinical_coordination(t.staff_id))
$$;
revoke all on function public.can_access_clinical_coordination_task(uuid) from public,anon;
grant execute on function public.can_access_clinical_coordination_task(uuid) to authenticated;

alter table public.clinical_coordination_task_notes enable row level security;
alter table public.clinical_coordination_task_files enable row level security;
alter table public.clinical_coordination_availability_slots enable row level security;
revoke all on public.clinical_coordination_task_notes,public.clinical_coordination_task_files,public.clinical_coordination_availability_slots from public,anon,authenticated;
grant select,insert on public.clinical_coordination_task_notes,public.clinical_coordination_task_files to authenticated;
grant select,insert,update,delete on public.clinical_coordination_availability_slots to authenticated;
create policy notes_read on public.clinical_coordination_task_notes for select to authenticated using(public.can_access_clinical_coordination_task(task_id));
create policy notes_create on public.clinical_coordination_task_notes for insert to authenticated with check(author_id=auth.uid() and public.can_access_clinical_coordination_task(task_id));
create function public.set_clinical_coordination_note_author()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select full_name into new.author_name from public.profiles where id=auth.uid();
  return new;
end;
$$;
revoke all on function public.set_clinical_coordination_note_author() from public,anon,authenticated;
create trigger note_author before insert on public.clinical_coordination_task_notes for each row execute function public.set_clinical_coordination_note_author();
create policy slots_private on public.clinical_coordination_availability_slots as restrictive for all to authenticated
  using(public.can_access_clinical_coordination(staff_id)) with check(public.can_access_clinical_coordination(staff_id));
create policy slots_read on public.clinical_coordination_availability_slots for select to authenticated using(true);
create policy slots_create on public.clinical_coordination_availability_slots for insert to authenticated with check(created_by=auth.uid());
create policy slots_change on public.clinical_coordination_availability_slots for update to authenticated using(true) with check(true);
create policy slots_remove on public.clinical_coordination_availability_slots for delete to authenticated using(true);

-- Le nom du fichier doit désigner un vrai couple membre/tâche. Pas de cast UUID sur une entrée non fiable.
create function public.can_access_clinical_coordination_file(object_name text)
returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select exists(select 1 from public.clinical_coordination_tasks t
   where t.staff_id::text=split_part(object_name,'/',1) and t.id::text=split_part(object_name,'/',2)
     and split_part(object_name,'/',3)<>'' and public.can_access_clinical_coordination(t.staff_id))
$$;
revoke all on function public.can_access_clinical_coordination_file(text) from public,anon;
grant execute on function public.can_access_clinical_coordination_file(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('clinical-coordination-task-files','clinical-coordination-task-files',false,52428800);
-- Une ancienne policy permissive globale ne peut ouvrir ce bucket privé.
create policy clinical_coordination_bucket_gate on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'clinical-coordination-task-files' or public.can_access_clinical_coordination_file(name))
 with check(bucket_id<>'clinical-coordination-task-files' or public.can_access_clinical_coordination_file(name));
create policy clinical_coordination_storage_read on storage.objects for select to authenticated
 using(bucket_id='clinical-coordination-task-files' and public.can_access_clinical_coordination_file(name));
create policy clinical_coordination_storage_upload on storage.objects for insert to authenticated
 with check(bucket_id='clinical-coordination-task-files' and public.can_access_clinical_coordination_file(name));
create policy clinical_coordination_storage_remove on storage.objects for delete to authenticated
 using(bucket_id='clinical-coordination-task-files' and public.can_access_clinical_coordination_file(name));
-- Le refus anonyme reste vrai même si une ancienne policy globale autorise anon.
create policy clinical_coordination_bucket_anon_gate on storage.objects as restrictive for all to anon
 using(bucket_id<>'clinical-coordination-task-files') with check(bucket_id<>'clinical-coordination-task-files');
create policy files_read on public.clinical_coordination_task_files for select to authenticated using(public.can_access_clinical_coordination_task(task_id));
create policy files_create on public.clinical_coordination_task_files for insert to authenticated
 with check(uploaded_by=auth.uid() and public.can_access_clinical_coordination_task(task_id)
   and exists(select 1 from public.clinical_coordination_tasks t where t.id=task_id
      and t.staff_id::text=split_part(storage_path,'/',1) and t.id::text=split_part(storage_path,'/',2))
   and exists(select 1 from storage.objects o where o.bucket_id='clinical-coordination-task-files' and o.name=storage_path));
grant all on public.clinical_coordination_staff,public.clinical_coordination_tasks,public.clinical_coordination_task_notes,public.clinical_coordination_task_files,public.clinical_coordination_availability_slots to service_role;
commit;
