-- Préparé seulement : valider puis appliquer avant la version applicative.
begin;
alter table public.profiles add column if not exists professional_civility text;
alter table public.profiles drop constraint if exists profiles_professional_civility_check;
alter table public.profiles add constraint profiles_professional_civility_check
  check (professional_civility is null or professional_civility in ('M.', 'Mme'));

create or replace function public.guard_professional_civility()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.professional_civility is null) then return new; end if;
  if tg_op = 'UPDATE' then
    if new.professional_civility is not distinct from old.professional_civility then return new; end if;
  end if;
  if auth.role() = 'service_role' then return new; end if;
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then return new; end if;
  if not exists(select 1 from public.profiles where id = auth.uid()
      and role = 'direction' and platform_access_enabled is distinct from false) then
    raise exception using errcode = '42501', message = 'Civilité réservée à la direction.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_professional_civility() from public;
drop trigger if exists guard_professional_civility on public.profiles;
create trigger guard_professional_civility before insert or update on public.profiles
  for each row execute function public.guard_professional_civility();
commit;
