-- Messagerie interne : un fil de discussion par professionnel, entre ce
-- professionnel et la direction.
-- À exécuter manuellement dans le SQL Editor de Supabase (ne pas exécuter automatiquement).

begin;

-- Redéfinie ici de façon idempotente au cas où
-- supabase/rls-assignment-security.sql n'a pas encore été exécuté.
create or replace function public.is_direction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = 'direction',
    false
  )
$$;

revoke all on function public.is_direction() from public;
grant execute on function public.is_direction() to authenticated;

create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id),
  sender_id uuid not null references public.profiles(id),
  sender_role text not null check (sender_role in ('direction', 'professionnel')),
  sender_name text,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.internal_messages is
  'Messagerie interne : un fil de discussion par professionnel, entre ce professionnel et la direction.';

create index if not exists idx_internal_messages_professional_id
  on public.internal_messages (professional_id, created_at);

alter table public.internal_messages enable row level security;

drop policy if exists "internal_messages_select_own_or_direction" on public.internal_messages;
drop policy if exists "internal_messages_insert_own_or_direction" on public.internal_messages;
drop policy if exists "internal_messages_update_own_or_direction" on public.internal_messages;

create policy "internal_messages_select_own_or_direction"
on public.internal_messages
for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_direction()
);

create policy "internal_messages_insert_own_or_direction"
on public.internal_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and (professional_id = auth.uid() or public.is_direction())
);

-- Nécessaire pour marquer read_at ; le contenu du message reste immuable
-- après envoi côté application (l'update ne touche que read_at).
create policy "internal_messages_update_own_or_direction"
on public.internal_messages
for update
to authenticated
using (professional_id = auth.uid() or public.is_direction())
with check (professional_id = auth.uid() or public.is_direction());

commit;
