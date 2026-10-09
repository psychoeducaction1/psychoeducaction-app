begin;

alter table public.profiles
  add column if not exists pref_age_ranges jsonb not null default '[]'::jsonb,
  add column if not exists pref_client_groups text[] not null default '{}'::text[],
  add column if not exists pref_service_types text[] not null default '{}'::text[],
  add column if not exists pref_office_locations text[] not null default '{}'::text[],
  add column if not exists pref_meeting_modes text[] not null default '{}'::text[],
  add column if not exists pref_motifs text[] not null default '{}'::text[],
  add column if not exists pref_exclusions text,
  add column if not exists pref_matching_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_pref_age_ranges_array_check'
  ) then
    alter table public.profiles
      add constraint profiles_pref_age_ranges_array_check
      check (jsonb_typeof(pref_age_ranges) = 'array');
  end if;
end $$;

create index if not exists profiles_pref_client_groups_gin
  on public.profiles using gin (pref_client_groups);
create index if not exists profiles_pref_service_types_gin
  on public.profiles using gin (pref_service_types);
create index if not exists profiles_pref_office_locations_gin
  on public.profiles using gin (pref_office_locations);
create index if not exists profiles_pref_meeting_modes_gin
  on public.profiles using gin (pref_meeting_modes);
create index if not exists profiles_pref_motifs_gin
  on public.profiles using gin (pref_motifs);

with validated_preferences as (
  select *
  from jsonb_to_recordset($preferences$
  [
    {
      "full_name": "Aglaé Grégoire-Bélanger",
      "age_ranges": [{"min": 0, "max": null}],
      "client_groups": ["children", "adolescents", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["montreal"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["anxiety", "self_esteem", "tdah", "relational_difficulties", "emotional_regulation", "adaptation"],
      "exclusions": null,
      "notes": "Approches orientée vers les solutions et cognitivo-comportementale. Intérêt pour l’intervention assistée par l’animal."
    },
    {
      "full_name": "Alicia Gagnon-O'Dell",
      "age_ranges": [{"min": 0, "max": 12}],
      "client_groups": ["children", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["emotional_regulation", "behavior", "sleep", "anxiety", "self_esteem", "parenting", "family_relationships"],
      "exclusions": null,
      "notes": "Petite enfance 0-5 ans et enfants d’âge scolaire 6-12 ans. Coaching parental, soutien à domicile, dynamique familiale, relation parent-enfant, sommeil, organisation familiale et développement du sentiment de compétence parentale. Pas disponible la fin de semaine."
    },
    {
      "full_name": "Alycia Brûlotte",
      "age_ranges": [{"min": 0, "max": 12}, {"min": 18, "max": null}],
      "client_groups": ["children", "adults", "parents", "families", "couples"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["parenting", "family_relationships", "relational_difficulties", "adaptation"],
      "exclusions": null,
      "notes": "Suivis individuels, coaching parental et accompagnement de couple."
    },
    {
      "full_name": "Anne-Sophie Hébert",
      "age_ranges": [{"min": 4, "max": 17}],
      "client_groups": ["children", "adolescents"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["emotional_regulation", "behavior", "anxiety", "self_esteem", "social_skills", "school_adaptation", "adaptation"],
      "exclusions": null,
      "notes": "Intérêt pour les jeunes sportifs et athlètes."
    },
    {
      "full_name": "Ève Deveault-Harvey",
      "age_ranges": [{"min": 8, "max": 18}],
      "client_groups": ["children", "adolescents"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil", "montreal"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["anxiety", "emotional_regulation", "self_esteem", "social_skills", "adaptation"],
      "exclusions": null,
      "notes": "Disponibilités préférablement dans la journée; sinon le lundi soir, le jeudi soir ou une fin de semaine sur deux."
    },
    {
      "full_name": "Hélièna Guillet",
      "age_ranges": [{"min": 0, "max": null}],
      "client_groups": ["children", "adolescents", "adults", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": ["montreal"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["trauma", "anxiety", "depression_mood", "emotional_regulation", "relational_difficulties", "family_relationships", "adaptation"],
      "exclusions": "Ne prend pas les dossiers DI-TSA.",
      "notes": "Francophone uniquement. Disponibilités le mardi et le jeudi en téléconsultation. Faire les assignations le lundi ou le mercredi afin de permettre l’appel au client le lendemain."
    },
    {
      "full_name": "Hicham Boukili",
      "age_ranges": [{"min": 0, "max": 17}],
      "client_groups": ["children", "adolescents", "parents", "families"],
      "service_types": ["psychosocial_intervention"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["tsa_di", "behavior", "emotional_regulation", "family_relationships", "parenting", "adaptation"],
      "exclusions": null,
      "notes": "La fiche publique mentionne également des services à Montréal; confirmer le bureau avant l’assignation."
    },
    {
      "full_name": "Kahina Nait Hamoud",
      "age_ranges": [{"min": 3, "max": 12}],
      "client_groups": ["children", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": ["montreal"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["emotional_regulation", "opposition", "behavior", "anxiety", "self_esteem", "tdah", "school_adaptation", "social_skills", "parenting", "family_relationships", "adaptation"],
      "exclusions": null,
      "notes": "Approche psychoéducative centrée sur l’évaluation des forces et défis; approche systémique attentive aux interactions avec la famille et l’école; approche collaborative impliquant la personne, sa famille et les acteurs importants; approche orientée vers les objectifs et les solutions. Peut faire de l’accompagnement, de l’intervention directe, de l’observation, des plans d’intervention et des bilans."
    },
    {
      "full_name": "Karie Munn",
      "age_ranges": [{"min": 4, "max": 12}, {"min": 18, "max": null}],
      "client_groups": ["children", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["tdah", "anxiety", "trauma", "adaptation", "social_skills"],
      "exclusions": null,
      "notes": null
    },
    {
      "full_name": "Karima Becherif",
      "age_ranges": [{"min": 0, "max": null}],
      "client_groups": ["children", "adolescents", "adults", "seniors", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": [],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["parenting", "family_relationships", "adaptation"],
      "exclusions": null,
      "notes": "Aucune restriction de clientèle. Suivi individuel, suivi parental, soutien aux compétences parentales, évaluation psychoéducative et plan d’intervention."
    },
    {
      "full_name": "Louis-Nicolas Richer",
      "age_ranges": [{"min": 5, "max": 12}, {"min": 13, "max": 17}, {"min": 18, "max": null}],
      "client_groups": ["children", "adolescents", "adults", "couples", "siblings"],
      "service_types": ["psychosocial_intervention"],
      "office_locations": ["montreal"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["anxiety", "self_esteem", "life_transitions", "relational_difficulties", "migration", "dependence", "adaptation"],
      "exclusions": null,
      "notes": "Transitions possibles : séparation, deuil, immigration et changement de milieu professionnel. Relations interpersonnelles, familiales, amicales, conjugales, professionnelles et interculturelles."
    },
    {
      "full_name": "Megan Dallaire",
      "age_ranges": [{"min": 13, "max": null}],
      "client_groups": ["adolescents", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["anxiety", "depression_mood", "emotional_regulation", "self_esteem", "autonomy", "adaptation"],
      "exclusions": null,
      "notes": "Approche bienveillante, collaborative et centrée sur la personne, son rythme, ses forces et le développement de l’autonomie."
    },
    {
      "full_name": "Mélanie Bomhower",
      "age_ranges": [{"min": 13, "max": null}],
      "client_groups": ["adolescents", "adults", "parents", "families", "couples"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["dependence", "adaptation", "emotional_regulation", "family_relationships", "relational_difficulties"],
      "exclusions": null,
      "notes": "Suivis individuels, en dyade ou en famille. Disponible deux soirs après 18 h ou la fin de semaine."
    },
    {
      "full_name": "Mélina Dubé",
      "age_ranges": [{"min": 13, "max": null}],
      "client_groups": ["adolescents", "adults", "parents", "families"],
      "service_types": ["psychosocial_intervention"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["emotional_regulation", "anxiety", "family_relationships", "parenting", "relational_difficulties", "adaptation"],
      "exclusions": "Ne prend pas les enfants de moins de 13 ans.",
      "notes": null
    },
    {
      "full_name": "Nancy Al Kayal",
      "age_ranges": [{"min": 0, "max": null}],
      "client_groups": ["children", "adolescents", "adults"],
      "service_types": ["psychological_assessment"],
      "office_locations": ["longueuil", "montreal"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["tdah", "tsa_di", "attention", "depression_mood", "anxiety", "personality"],
      "exclusions": null,
      "notes": "Évaluations du TDAH, du TSA et du fonctionnement psychologique global; avis et rapports psychologiques. Téléconsultation offerte au Québec et en Ontario."
    },
    {
      "full_name": "Patrick Gagné",
      "age_ranges": [{"min": 5, "max": 25}],
      "client_groups": ["children", "adolescents", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["montreal"],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["screen_use", "anxiety", "tdah", "emotional_regulation", "self_esteem", "depression_mood", "trauma", "dependence", "personality", "adaptation"],
      "exclusions": "Éviter les interventions directes avec des profils narcissiques ou antisociaux.",
      "notes": "TSA niveau 1 ou 2 léger, douance, enjeux liés au masculinisme, solitude et écoanxiété. Disponibilités : lundi 17 h à 20 h, jeudi 17 h à 20 h et samedi 8 h à 12 h."
    },
    {
      "full_name": "Rim El Bassit",
      "age_ranges": [{"min": 18, "max": null}],
      "client_groups": ["adults", "couples", "families"],
      "service_types": ["psychotherapy"],
      "office_locations": [],
      "meeting_modes": ["video"],
      "motifs": ["anxiety", "depression_mood", "relational_difficulties", "adaptation", "trauma"],
      "exclusions": "Adultes seulement; aucun enfant ni adolescent.",
      "notes": "Approche globale, intégrative et personnalisée; cadres individuel, couple et famille."
    },
    {
      "full_name": "Roxanne Bouchard",
      "age_ranges": [{"min": 0, "max": null}],
      "client_groups": ["children", "adolescents", "adults", "parents", "families", "couples"],
      "service_types": ["psychosocial_intervention"],
      "office_locations": ["longueuil", "montreal"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["trauma", "migration", "dependence", "tsa_di", "tdah", "personality", "relational_difficulties", "adaptation"],
      "exclusions": null,
      "notes": "Approche créative pouvant intégrer l’art et le jeu, notamment auprès des enfants."
    },
    {
      "full_name": "Solène Faure-Dionne",
      "age_ranges": [{"min": 0, "max": 18}],
      "client_groups": ["children", "adolescents", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "home"],
      "motifs": ["emotional_regulation", "anxiety", "behavior", "attention", "social_skills", "self_esteem", "family_relationships", "parenting"],
      "exclusions": null,
      "notes": "Suivis individuels, en dyade et coaching parental."
    },
    {
      "full_name": "Sylvain Turgeon",
      "age_ranges": [{"min": 13, "max": null}],
      "client_groups": ["adolescents", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["tdah", "anxiety", "depression_mood", "dependence", "adaptation"],
      "exclusions": null,
      "notes": "Expertise en toxicomanie et troubles concomitants en santé mentale."
    },
    {
      "full_name": "Thinhinane Ould Younes",
      "age_ranges": [{"min": 13, "max": null}],
      "client_groups": ["adolescents", "adults", "seniors", "parents", "families"],
      "service_types": ["psychoeducation"],
      "office_locations": [],
      "meeting_modes": ["in_person", "video", "home"],
      "motifs": ["depression_mood", "personality", "trauma", "emotional_regulation", "relational_difficulties", "adaptation"],
      "exclusions": "Ne prend pas les dossiers DI-TSA.",
      "notes": null
    },
    {
      "full_name": "Viviane St-Louis",
      "age_ranges": [{"min": 14, "max": null}],
      "client_groups": ["adolescents", "adults"],
      "service_types": ["psychoeducation"],
      "office_locations": ["longueuil"],
      "meeting_modes": ["in_person", "video"],
      "motifs": ["tsa_di", "tdah", "anxiety", "depression_mood", "emotional_regulation", "self_esteem", "adaptation"],
      "exclusions": "Ne prend pas les conflits de séparation, l’aliénation parentale, la violence conjugale, les agressions sexuelles, les troubles alimentaires actifs ni les dossiers IVAC. Aucun déplacement à domicile.",
      "notes": "Peut intervenir auprès de personnes ayant un HPI. Disponibilités : mardi de 12 h à 17 h, avec possibilité de 11 h à 18 h; vendredi de 9 h à 13 h, avec possibilité de 8 h à 14 h."
    }
  ]
  $preferences$::jsonb) as pref(
    full_name text,
    age_ranges jsonb,
    client_groups jsonb,
    service_types jsonb,
    office_locations jsonb,
    meeting_modes jsonb,
    motifs jsonb,
    exclusions text,
    notes text
  )
)
update public.profiles as profile
set
  pref_age_ranges = pref.age_ranges,
  pref_client_groups = array(select jsonb_array_elements_text(pref.client_groups)),
  pref_service_types = array(select jsonb_array_elements_text(pref.service_types)),
  pref_office_locations = array(select jsonb_array_elements_text(pref.office_locations)),
  pref_meeting_modes = array(select jsonb_array_elements_text(pref.meeting_modes)),
  pref_motifs = array(select jsonb_array_elements_text(pref.motifs)),
  pref_exclusions = pref.exclusions,
  pref_matching_notes = pref.notes
from validated_preferences as pref
where profile.full_name = pref.full_name
  and profile.role = 'professionnel';

-- L’évaluation psychoéducative fait partie de la psychoéducation. Nettoie aussi
-- les sélections enregistrées manuellement avant cette mise à jour.
update public.profiles
set pref_service_types = (
  select array_agg(distinct case
    when service_type = 'psychoeducational_assessment' then 'psychoeducation'
    else service_type
  end)
  from unnest(pref_service_types) as service_type
)
where role = 'professionnel'
  and 'psychoeducational_assessment' = any(pref_service_types);

comment on column public.profiles.pref_age_ranges is
  'Plages d’âge structurées utilisées pour les suggestions de jumelage.';
comment on column public.profiles.pref_matching_notes is
  'Notes humaines conservées hors du calcul automatique de jumelage.';

commit;

-- Vérification : cette requête doit retourner 22 profils remplis.
select
  full_name,
  pref_age_ranges,
  pref_client_groups,
  pref_office_locations,
  pref_meeting_modes,
  pref_exclusions,
  pref_matching_notes
from public.profiles
where role = 'professionnel'
  and is_active is true
order by full_name;
