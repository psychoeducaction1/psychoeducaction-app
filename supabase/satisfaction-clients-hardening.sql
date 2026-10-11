-- Correctifs à exécuter si supabase/satisfaction-clients.sql a déjà été lancé.
-- Cette migration est réexécutable.

begin;

alter table public.satisfaction_eligibles
  add column if not exists destinataire_emails text[] not null default '{}';

update public.satisfaction_eligibles
set destinataire_emails = array[destinataire_email]
where cardinality(destinataire_emails) = 0
  and destinataire_email is not null;

alter table public.satisfaction_eligibles
  drop constraint if exists satisfaction_eligibles_statut_check;

alter table public.satisfaction_eligibles
  add constraint satisfaction_eligibles_statut_check
  check (statut in ('en_attente', 'en_cours', 'envoye', 'exclu', 'desabonne'));

create unique index if not exists satisfaction_envois_unique_success_idx
  on public.satisfaction_envois (eligible_id)
  where statut = 'envoye';

create unique index if not exists satisfaction_one_contact_per_client_idx
  on public.satisfaction_eligibles (client_nom_normalise)
  where statut in ('en_cours', 'envoye');

commit;
