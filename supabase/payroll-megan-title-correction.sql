-- PREPARE UNIQUEMENT. Ne pas appliquer en production sans validation.
-- Uniquement le titre du profil; aucun contrat, catégorie, montant ou signature Outlook.
begin;
do $$
declare target public.profiles; old_title text; matches integer;
begin
  select count(*) into matches from public.profiles
    where lower(btrim(email))='megan.dallaire.pea@outlook.com' and role='professionnel';
  if matches <> 1 then raise exception 'Profil unique non confirmé : aucune modification.'; end if;
  select * into strict target from public.profiles
    where lower(btrim(email))='megan.dallaire.pea@outlook.com' and role='professionnel' for update;
  old_title := target.professional_title;
  if old_title is distinct from 'Intervenante B.Sc. Ps.éd' then
    update public.profiles set professional_title='Intervenante B.Sc. Ps.éd' where id=target.id;
    insert into public.audit_logs(actor_profile_id,actor_name,actor_role,action,entity_type,entity_id,description,metadata)
      values(auth.uid(),null,'direction','payroll_professional_title_corrected','profile',target.id,
        'Titre professionnel corrigé selon la référence fournie et validée par la direction.',
        jsonb_build_object('previous_title',old_title,'professional_title','Intervenante B.Sc. Ps.éd',
          'reference','Signature professionnelle confirmée pour la facture PEA-MD-018',
          'historical_invoices_unchanged',true));
  end if;
end;
$$;
commit;
