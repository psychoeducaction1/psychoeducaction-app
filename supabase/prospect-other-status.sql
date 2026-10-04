-- Autorise le classement "Autre" avec une note de suivi.
begin;

alter table public.public_intake_prospects
  drop constraint if exists public_intake_prospects_status_check;

alter table public.public_intake_prospects
  add constraint public_intake_prospects_status_check
  check (
    status in (
      'new', 'scheduled', 'callback_requested', 'contacted',
      'service_taken', 'service_not_taken', 'other',
      'transferred_to_waiting_list'
    )
  );

notify pgrst, 'reload schema';

commit;
