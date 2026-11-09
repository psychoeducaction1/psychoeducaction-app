-- Les changements de salaire sont indexés par mois de prise d'effet (AAAA-MM).
-- Les politiques existantes de la fiche continuent de protéger ces montants.
begin;

alter table public.administrative_staff
  add column if not exists monthly_salary_history jsonb not null default '{}'::jsonb
    check (jsonb_typeof(monthly_salary_history) = 'object');

commit;
