-- Préparation : aucun changement distant sans autorisation explicite.
-- Lier uniquement l'UUID Auth existant d'Ève. Aucun rôle, salaire ou compte n'est modifié.
-- Définir app.clinical_coordinator_profile_id dans LA MÊME transaction, après vérification humaine.
begin;
do $$
declare target public.profiles; target_id uuid;
begin
  target_id:=nullif(current_setting('app.clinical_coordinator_profile_id',true),'')::uuid;
  if target_id is null then raise exception 'UUID du profil à confirmer'; end if;
  select * into target from public.profiles where id=target_id for share;
  if not found or target.role<>'professionnel' or target.platform_access_enabled is false
    or translate(lower(replace(btrim(target.full_name),'‑','-')),'èéê','eee')<>'eve deveault-harvey'
    or nullif(btrim(target.email),'') is null then raise exception 'Profil de coordination non confirmé'; end if;
  if exists(select 1 from public.clinical_coordination_staff where profile_id<>target_id) then raise exception 'Un autre profil est déjà lié'; end if;
  insert into public.clinical_coordination_staff(profile_id,full_name,email)
    values(target.id,target.full_name,target.email) on conflict(profile_id) do nothing;
end;
$$;
commit;
