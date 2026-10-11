-- Satisfaction des clients : imports des exports Psylog « Activités détaillées »,
-- clients éligibles au sondage, envois, désabonnements et réponses.
-- À exécuter manuellement dans Supabase SQL Editor.
-- Prérequis : supabase/rls-assignment-security.sql (définit public.is_direction()).

begin;

create table if not exists public.satisfaction_imports (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  imported_by uuid null references public.profiles(id) on delete set null,
  period_start date not null,
  period_end date not null,
  row_count integer not null default 0 check (row_count >= 0),
  file_name text null
);

comment on table public.satisfaction_imports is 'Lots d''import des exports Psylog « Activités détaillées » pour la fonction Satisfaction des clients.';

create table if not exists public.satisfaction_eligibles (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.satisfaction_imports(id) on delete cascade,
  client_nom text not null,
  client_nom_normalise text not null,
  destinataire_nom text not null,
  destinataire_email text null,
  destinataire_emails text[] not null default '{}',
  professionnel text null,
  nb_rencontres integer not null check (nb_rencontres >= 4),
  derniere_rencontre date null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'envoye', 'exclu', 'desabonne')),
  jeton_reponse text not null unique,
  jeton_desabonnement text not null unique,
  created_at timestamptz not null default now(),
  unique (import_id, client_nom_normalise)
);

comment on table public.satisfaction_eligibles is 'Clients éligibles au sondage de satisfaction (au moins 4 rencontres sur la période). La contrainte d''unicité (import_id, client_nom_normalise) empêche les doublons.';

create table if not exists public.satisfaction_envois (
  id uuid primary key default gen_random_uuid(),
  eligible_id uuid not null references public.satisfaction_eligibles(id) on delete cascade,
  destinataire_email text not null,
  sujet text not null,
  statut text not null check (statut in ('envoye', 'erreur')),
  erreur text null,
  message_id text null,
  envoye_le timestamptz not null default now(),
  envoye_par uuid null references public.profiles(id) on delete set null
);

comment on table public.satisfaction_envois is 'Journal de chaque invitation au sondage envoyée (ou tentative échouée).';

create table if not exists public.satisfaction_desabonnes (
  id uuid primary key default gen_random_uuid(),
  nom_normalise text not null unique,
  email text null,
  desabonne_le timestamptz not null default now()
);

comment on table public.satisfaction_desabonnes is 'Personnes ayant demandé à ne plus recevoir d''invitation au sondage.';

create table if not exists public.satisfaction_reponses (
  id uuid primary key default gen_random_uuid(),
  eligible_id uuid not null unique references public.satisfaction_eligibles(id) on delete cascade,
  note integer not null check (note between 1 and 5),
  commentaire text null,
  repondu_le timestamptz not null default now()
);

comment on table public.satisfaction_reponses is 'Réponses au sondage de satisfaction (une seule réponse par client éligible).';

create index if not exists satisfaction_eligibles_import_id_idx
  on public.satisfaction_eligibles (import_id);
create index if not exists satisfaction_eligibles_statut_idx
  on public.satisfaction_eligibles (statut);
create index if not exists satisfaction_eligibles_nom_normalise_idx
  on public.satisfaction_eligibles (client_nom_normalise);
create index if not exists satisfaction_envois_eligible_id_idx
  on public.satisfaction_envois (eligible_id);
create unique index if not exists satisfaction_envois_unique_success_idx
  on public.satisfaction_envois (eligible_id) where statut = 'envoye';
create unique index if not exists satisfaction_one_contact_per_client_idx
  on public.satisfaction_eligibles (client_nom_normalise)
  where statut in ('en_cours', 'envoye');

-- Mise à niveau si une première version du script a déjà été exécutée.
alter table public.satisfaction_eligibles
  add column if not exists destinataire_emails text[] not null default '{}';
update public.satisfaction_eligibles
set destinataire_emails = array[destinataire_email]
where cardinality(destinataire_emails) = 0 and destinataire_email is not null;
alter table public.satisfaction_eligibles
  drop constraint if exists satisfaction_eligibles_statut_check;
alter table public.satisfaction_eligibles
  add constraint satisfaction_eligibles_statut_check
  check (statut in ('en_attente', 'en_cours', 'envoye', 'exclu', 'desabonne'));

-- Les pages publiques (réponse, désabonnement) passent par des routes API qui
-- utilisent la clé service-role après validation du jeton : aucun accès
-- public direct n'est accordé ici. Tout accès authentifié est réservé à la
-- direction.

alter table public.satisfaction_imports enable row level security;
alter table public.satisfaction_eligibles enable row level security;
alter table public.satisfaction_envois enable row level security;
alter table public.satisfaction_desabonnes enable row level security;
alter table public.satisfaction_reponses enable row level security;

drop policy if exists "satisfaction_imports_direction" on public.satisfaction_imports;
create policy "satisfaction_imports_direction"
on public.satisfaction_imports for all to authenticated
using (public.is_direction())
with check (public.is_direction());

drop policy if exists "satisfaction_eligibles_direction" on public.satisfaction_eligibles;
create policy "satisfaction_eligibles_direction"
on public.satisfaction_eligibles for all to authenticated
using (public.is_direction())
with check (public.is_direction());

drop policy if exists "satisfaction_envois_direction" on public.satisfaction_envois;
create policy "satisfaction_envois_direction"
on public.satisfaction_envois for all to authenticated
using (public.is_direction())
with check (public.is_direction());

drop policy if exists "satisfaction_desabonnes_direction" on public.satisfaction_desabonnes;
create policy "satisfaction_desabonnes_direction"
on public.satisfaction_desabonnes for all to authenticated
using (public.is_direction())
with check (public.is_direction());

drop policy if exists "satisfaction_reponses_direction" on public.satisfaction_reponses;
create policy "satisfaction_reponses_direction"
on public.satisfaction_reponses for all to authenticated
using (public.is_direction())
with check (public.is_direction());

commit;
