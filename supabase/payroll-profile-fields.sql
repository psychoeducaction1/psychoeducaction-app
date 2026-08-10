-- Ajoute les champs nécessaires au calcul de paie : catégorie de paie (détermine le
-- pourcentage/taux applicable) et adresse postale (affichée sur la facture générée).
-- À exécuter manuellement dans le SQL Editor de Supabase (ne pas exécuter automatiquement).

begin;

alter table public.profiles
  add column if not exists payroll_category text;

comment on column public.profiles.payroll_category is
  'Catégorie de paie du professionnel : intervenant_psychoeducation | psychoeducateur_membre_ordre | psychotherapeute. Détermine le pourcentage/taux appliqué lors du calcul de paie. Rempli manuellement par Fatima Zahra ou Hajar.';

alter table public.profiles
  add column if not exists professional_address text;

comment on column public.profiles.professional_address is
  'Adresse postale du professionnel, affichée sur la facture de paie générée.';

commit;

-- Aucune nouvelle policy RLS nécessaire : la policy "profiles_update_direction"
-- existante (supabase/rls-assignment-security.sql) autorise déjà la direction
-- à modifier n'importe quel profil, y compris ces nouveaux champs.
