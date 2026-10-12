# Developper et verifier

## Demarrage et connaissances
- Node 24 (reference) et lockfile existant: `npm ci`.
- Lire `AGENTS.md`, les sections utiles de `PROJECT_NOTES.md` et les regles du domaine.
  Ne pas relire tout le depot ou l'historique des chats pour une modification ciblee.
- Configurer `.env.local` depuis `.env.example` avec un projet Supabase de test.
  Aucun secret reel dans Git, une capture, un exemple ou une sortie de commande.
- Next.js local utilise la base cible de `.env.local`: des acces de production
  modifieraient la production meme si la page est ouverte sur localhost.
- Un chantier = un chat, jusqu'a validation. Transmission courte: objectif, fichiers,
  decisions, controles et blocages; documenter les connaissances durables dans le depot.

## Commandes
| Commande | Portee |
| --- | --- |
| `npm run dev` | Serveur local; autre port si necessaire. |
| `npm run typecheck` | Types de routes Next puis TypeScript sans emission ni cache incremental. |
| `npm run lint` | Regles ESLint existantes, sans nouvelle desactivation. |
| `npm test` | Tests Node, fixtures fictives, alias `@/`, fetch externe interdit par defaut. |
| `npm run check` | Types, lint, tests; arret au premier echec. |
| `npm run check:full` | Controles precedents puis build local de production. |
| `npm run test:db` | Scenario SQL distinct contre PostgreSQL local isole uniquement. |

Le build genere `.next` et les declarations Next; il ne deploie rien.
Le runner conserve Node natif et `node:test`, sans nouveau framework. Node 24 evite
les ecarts de support des hooks de resolution; le hook `@/` ne change pas le runtime Next.
`--test-isolation=none` est preexistant: eviter les mocks globaux non restaures.
Un test de fetch doit simuler et restaurer son mock explicitement.

## Controles adaptes au changement
| Domaine | Automatisation disponible | Verification complementaire |
| --- | --- | --- |
| Assignation | `assignmentWorkflow.test.ts`: statuts, compteurs, attente, service pris, echec insert. | Concurrence, annulation/reouverture et echecs partiels en base. |
| Droits | `accessRules.test.ts`: helpers super admin, paie, demandes et taches. | Routes par role, RLS/JWT, URLs directes et Storage. |
| Prospects | `prospectValidation.test.ts`: contacts, champs requis/facultatifs, attribution. | Transfert avec motif/priorite, classement et dossier unique; SQL local. |
| Rendez-vous | Tests existants horaires/contrats; SQL local hold/retry/annulation/deplacement. | WordPress de test, Turnstile, concurrence et deduplication marketing. |
| Paie pro | `payrollCalculation.test.ts`: vrais calculateurs, durees, rapports, seuils, annulations. | DOCX, quantites/totaux, destinataires sans vrai envoi. |
| Budget/adjointes | `budgetExpenses.test.ts`: bornes, lien paie et types d'heures. | Sauvegarde/remplacement, separation salaires et vacances multimois. |
| Satisfaction/suggestions | Tests existants selection, preferences, filtres et destinataires. | RLS, imports anonymises, absence de nouvelle sollicitation. |

Controle cible, en remplacant le fichier si necessaire:

```powershell
node --import ./tests/register-aliases.mjs --test --test-isolation=none --experimental-strip-types tests/assignmentWorkflow.test.ts
```

## Tests SQL locaux: preparation sans migration automatique
`test:db` exige `LOCAL_TEST_DATABASE_URL`, ignore `.env.local`, refuse les adresses
distantes et les parametres d'URL pouvant rediriger la connexion. Mot de passe transmis
au sous-processus via l'environnement, jamais les arguments. Ne pas utiliser un tunnel
vers la production sous une adresse locale.

Prerequis manuels:
1. Supabase/PostgreSQL local dedie et client `psql` dans PATH.
2. Schema de base compatible: `profiles`, `waiting_list_clients`, `audit_logs`.
   Le depot ne fournit pas une installation complete de ces tables initiales.
3. Roles `anon`, `authenticated`, `service_role`, extensions et politiques Supabase locales;
   compte local autorise a executer les RPC.
4. Scripts d'admission, `conversion-event-id.sql` et corrections de transfert pertinents
   appliques dans cette base isolee, apres revue de l'ordre; rien n'est installe par les tests.
5. Variable `LOCAL_TEST_DATABASE_URL` reservee a cette base locale.

Exemple fictif PowerShell, a remplacer seulement par des acces LOCAUX:

```powershell
$env:LOCAL_TEST_DATABASE_URL = 'postgresql://fixture:local-only-password@127.0.0.1:54322/fixture'
npm run test:db
Remove-Item Env:LOCAL_TEST_DATABASE_URL
```

`tests/integration/public-intake.sql` execute les vrais RPC: privileges, holds, retries,
identifiants, doublons potentiels, deplacement, annulation et transfert idempotent.
Donnees fictives, aucun courriel, aucune migration, transaction terminee par `ROLLBACK`.
Avec ON_ERROR_STOP, une erreur ferme la connexion et annule aussi la transaction.
Le succes ne couvre pas la concurrence multi-session ni toutes les RLS utilisateur.
Scenario prepare mais non execute au 12 octobre 2026: base de tests non configuree
et client `psql` non disponible lors de la mise en place.

## Avant la mise en production
1. Lire `git status` et le diff; seuls les fichiers attendus doivent changer.
2. Executer `npm run check:full`. Distinguer avertissements/echecs preexistants et nouveaux.
3. Valider le parcours concerne, donnees fictives et environnement isole.
4. SQL/droits/reservations: verifier politiques effectives, index, erreurs partielles et
   retries, pas seulement le texte SQL. Executer les controles locaux requis.
5. Verifier documentation, compatibilite et lacunes de couverture.
6. Avant migration autorisee, confirmer sauvegarde et restauration. Un tag Git conserve
   le code, pas la base; pas de rollback destructif improvise.
7. Respecter les autorisations de commit/push et de mise en ligne de la demande.
   Un push main peut declencher Vercel; il ne se confond pas avec une verification locale.
8. Apres livraison autorisee, verifier le deploiement et le parcours.

GitHub Actions execute `check:full` sur PR/push main avec Node 24 et des parametres publics
Supabase fictifs, sans secret de production. Pas de test SQL ni de deploiement dans ce workflow.
Execution distante a verifier au premier push autorise. La protection de branche exigeant
ce controle est un reglage GitHub separe, non configure ici.

Etat de depart: 57 tests verts, types/build verts; lint avec un avertissement de navigation
preexistant dans `app/login/page.tsx`. Avertissement Node `MODULE_TYPELESS_PACKAGE_JSON`
egalement preexistant; le type du package n'est pas modifie pour le supprimer.

## Effort proportionne et modele
- Sol 6.1 Moyen au quotidien; Eleve pour SQL, droits, calculs ou changements transversaux.
- Luna pour le simple et bien defini; Astra pour un diagnostic tres complexe.
- Ultra seulement pour des parties independantes justifiant une delegation.
- Un seul agent lorsque cela suffit; lectures et sorties pertinentes uniquement.
- Criteres de reussite et tests passent avant l'economie de quota. Le depot ne change
  ni le modele actif ni les limites du compte.
