-- INITIALISATION PONCTUELLE selon la liste explicitement donnée par la direction.
-- Revoir le roster courant avant exécution autorisée. Aucun défaut pour les futurs profils.
-- Prérequis : professional-civility.sql. Ne remplace aucune civilité déjà renseignée.
begin;
lock table public.profiles in share row exclusive mode;
do $$
declare given_name text;
begin
  foreach given_name in array array['patrick','louis-nicolas','hicham'] loop
    if (select count(*) from public.profiles where role = 'professionnel'
        and lower(split_part(translate(trim(full_name), '‑–−', '---'), ' ', 1)) = given_name) <> 1 then
      raise exception 'Initialisation annulée : identité absente ou ambiguë, confirmer les UUID des trois profils.';
    end if;
  end loop;
end;
$$;
update public.profiles set professional_civility = case
  when lower(split_part(translate(trim(full_name), '‑–−', '---'), ' ', 1))
    in ('patrick','louis-nicolas','hicham') then 'M.' else 'Mme' end
where role = 'professionnel' and professional_civility is null;
commit;
