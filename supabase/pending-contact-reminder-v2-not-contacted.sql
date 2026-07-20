-- Migration v2 : le rappel automatique cible désormais contacted = false
-- (sous-ensemble strict de is_active IS NULL), pour distinguer "pas encore
-- contacté" de "en attente d'une réponse" (déjà contacté, décision pas encore prise).
-- À exécuter manuellement dans le SQL Editor de Supabase (ne pas exécuter automatiquement).

begin;

-- 1. Backfill : les assignations déjà "en attente" avant ce déploiement sont
--    considérées comme déjà contactées (convention : une file d'attente
--    préexistante = un contact déjà tenté au moins une fois). Les nouvelles
--    assignations créées après ce déploiement continuent d'être créées avec
--    contacted = false, is_active = null ("Pas encore contacté"), déjà le cas
--    aux points d'insertion existants.
update public.assigned_clients
set contacted = true
where is_active is null
  and contacted = false
  and canceled_at is null;

-- 2. Recréer l'index partiel du cron avec le nouveau prédicat (contacted = false
--    au lieu de is_active is null).
drop index if exists idx_assigned_clients_pending_contact_reminder;

create index if not exists idx_assigned_clients_pending_contact_reminder
  on public.assigned_clients (assigned_date)
  where contacted = false
    and canceled_at is null
    and pending_contact_reminder_sent_at is null;

commit;
