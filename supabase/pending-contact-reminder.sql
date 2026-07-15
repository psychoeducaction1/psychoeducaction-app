-- Ajoute le suivi de l'envoi du rappel automatique "contact en attente" (3 jours calendaires).
-- À exécuter manuellement dans le SQL Editor de Supabase (ne pas exécuter automatiquement).

begin;

alter table public.assigned_clients
  add column if not exists pending_contact_reminder_sent_at timestamptz null;

comment on column public.assigned_clients.pending_contact_reminder_sent_at is
  'Horodatage de l''envoi du rappel automatique (3 jours calendaires) au professionnel pour un client en attente de contact (is_active IS NULL). Rempli une seule fois, jamais réinitialisé automatiquement (sauf réessai après échec d''envoi).';

create index if not exists idx_assigned_clients_pending_contact_reminder
  on public.assigned_clients (assigned_date)
  where is_active is null
    and canceled_at is null
    and pending_contact_reminder_sent_at is null;

commit;

-- Optionnel : requête pour vérifier les contraintes existantes sur audit_logs
-- (actor_role / actor_profile_id) avant/après l'implémentation de la route cron.
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.audit_logs'::regclass;
