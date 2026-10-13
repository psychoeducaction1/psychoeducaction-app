-- Ajoute le détail de l'analyse aux prochains imports. Aucun import ancien n'est reconstitué.
-- Application distante uniquement après autorisation explicite.
begin;
alter table public.satisfaction_imports add column if not exists analysis jsonb null;
alter table public.satisfaction_imports drop constraint if exists satisfaction_imports_analysis_check;
alter table public.satisfaction_imports add constraint satisfaction_imports_analysis_check
  check ((analysis is null or (jsonb_typeof(analysis) = 'object'
    and analysis->>'version' = '1' and jsonb_typeof(analysis->'rows') = 'array')) is true);
comment on column public.satisfaction_imports.analysis is
  'Analyse au moment de l''import: rencontres par client, raisons de non-éligibilité et difficultés de correspondance. Aucun jeton ni contenu clinique.';
notify pgrst, 'reload schema';
commit;
