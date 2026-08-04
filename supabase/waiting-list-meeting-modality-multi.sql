-- Convertit waiting_list_clients.meeting_modality d'une valeur unique (text)
-- vers plusieurs valeurs possibles (text[]), pour permettre à un client
-- d'avoir plusieurs modalités de rencontre à la fois (ex: Visioconférence +
-- Présentiel — bureau de Montréal), et retire l'option "Hybride" devenue
-- redondante (les combinaisons se font désormais en cochant plusieurs
-- modalités individuelles).
--
-- Les dossiers existants marqués "Hybride (présentiel + visioconférence)"
-- sont migrés vers ['Visioconférence'] uniquement, car "Hybride" ne précisait
-- pas quel bureau présentiel était visé (Longueuil ou Montréal) — à ajuster
-- manuellement au cas par cas si besoin après la migration.
--
-- À exécuter manuellement dans le SQL Editor de Supabase (ne pas exécuter automatiquement).

begin;

alter table public.waiting_list_clients
  alter column meeting_modality type text[]
  using (
    case
      when meeting_modality is null then null
      when meeting_modality = 'Hybride (présentiel + visioconférence)' then array['Visioconférence']
      else array[meeting_modality]
    end
  );

commit;
