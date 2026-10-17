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

Moteur clinique v2 (17 octobre, local): `clinicalNoteEngine.test.ts` controle
sept gabarits, citations exactes/source autorisee, references inconnues, rubriques
vides exclues de la copie, tableaux ABC incomplets, alertes prioritaires, relecture
et versions clonees bornees. `clinicalNotesRoute.mjs` exerce la vraie API avec
fournisseur simule: deux comptes autorises, contexte non confirme refuse avant
appel, trois etapes pour les sept types, citations/references invalides, controle
de fidelite negatif, reponse incomplete/refus, annulation avant et entre etapes.
Compatibilite de l'ancien contrat conservee. Les simulations ne mesurent pas la
capacite reelle du modele a detecter une hallucination, une omission ou une mauvaise
attribution: revue comparative clinique des sorties reelles encore necessaire.
Scenario fictif de reference: parent rapportant sommeil/jeux video, sans diagnostic
confirme, sans propos du jeune, sans plan ni prochaine date convenus. Ne jamais
transformer les qualificatifs familiaux en diagnostic ou une question en technique.
Autres essais a comparer avec le professionnel: risques sans evaluation documentee,
contradictions avec ancienne note, bilan de fermeture absent, scores normatifs absents,
observation ABC incomplete. Aucun appel payant ni vrai client dans les tests automatises.
Verification finale locale du moteur v2: `npm run check:full` reussi, 198 tests et build;
trois avertissements lint preexistants, aucune nouvelle erreur. Apercu isole avec
identite et transport simules: edition, source modifiee/copie bloquee, echec conservant
la correction, regeneration/archivage/restauration, ajout/retrait/deplacement de
paragraphe et texte a copier excluant alertes/rubriques vides verifies. Aucun micro reel,
appel fournisseur, SQL, commit/push ou deploiement execute pour cette evolution.
Publication autorisee ensuite (commit `ff27a16`, Vercel
`B5ufBViuvHaJyTr15ee7xD7rNWXc` en succes): domaine public, sept choix et acces
super administrateur verifies. GET et POST anonymes/jeton fictif invalide = 401,
private no-store. Contrats de droits des deux comptes reexecutes hors ligne;
connexion directe au professionnel pilote non exercee. Essai IA reel sur le seul
scenario fictif sommeil/jeux video, evaluation 1: trois etapes reussies, pas d'ajout
ni omission materiels a la comparaison, locuteurs/limites et manques dans les alertes,
aucun diagnostic, acte, plan ou prochaine date inventes. Brouillon non valide pour
laisser la relecture a l'utilisateur. Alertes proches parfois repetees: limite de
lisibilite encore presente, sans inclusion dans le texte clinique a copier.
Correctif des alertes: `clinicalNoteAlerts.test.ts` controle apostrophes/espaces,
ordre des references, priorite maximale, variantes conservees, references supplementaires,
points sans references ou disjoints, categories separees, regroupement transitif,
absence de mutation et texte copie inchange. Vraie API simulee: alertes des trois
etapes dedupliquees sans perdre une precision distincte ni diminuer une priorite.
Verification locale du correctif: `check:full` reussi, 205 tests et build, les trois
avertissements lint preexistants seulement. Apercu isole: neuf alertes fictives
deviennent quatre cartes, les doublons exacts disparaissent, les precisions distinctes
restent depliables et les references supplementaires sont visibles. Aucun nouvel
appel IA n'est ajoute au parcours; droits et donnees fictives inchanges.
Le runner conserve Node natif et `node:test`, sans nouveau framework. Node 24 evite
les ecarts de support des hooks de resolution; le hook `@/` ne change pas le runtime Next.
`--test-isolation=none` est preexistant: eviter les mocks globaux non restaures.
Un test de fetch doit simuler et restaurer son mock explicitement.

## Controles adaptes au changement
| Domaine | Automatisation disponible | Verification complementaire |
| --- | --- | --- |
| Assignation | `assignmentWorkflow.test.ts`, `waitingListFilters.test.ts`: statuts, compteurs, demande inactive apres retrait des tests, attente, service pris, echec insert et historique. `assignmentRequestSummary.test.ts`: vraie API, compteurs de confirmation, assignations annulees exclues, contrat compatible et droits. | Concurrence, annulation/reouverture et echecs partiels en base. |
| Liste des clients | `waitingListDuplicates.test.ts`: demande identique, homonymes, naissance/motif/contacts/requerants/adresse/modalites/disponibilites/notes differents, champs absents, relecture paginee et erreurs. `prospectTransferCompletion.test.ts`: vraie API de transfert, motif saisi, autorisations et absence d'ecriture si doublon/erreur. | Deux creations concurrentes; regroupement manuel sans perte de motifs, notes ni liens. RPC distant a aligner avec autorisation. |
| Droits | `accessRules.test.ts`: helpers super admin, paie, demandes et taches. `restrictedSections.test.ts`: vraies API Acquisition/Satisfaction, comptes non autorises, profil absent et super administrateur, dependances simulees hors ligne. | Routes par role, RLS/JWT, URLs directes et Storage. |
| Prise de notes pilote | `clinicalNotes.test.ts` et `clinicalNotesRoute.mjs`: vraie API, deux comptes permis, autres roles/profil absent/session invalide refuses, lecture du seul profil avec JWT utilisateur, aucune cle de service. Parcours consentement/source/relecture/validation/copie/depot simules et correction invalidant la validation. | Apercu isole bureau/mobile: navigation, Teams/presentiel simules, note modifiable, copie manuelle de secours et depot distinct. Rafraichir efface les essais. Aucun vrai audio, courriel, client ou appel IA. |
| Prospects | `prospectValidation.test.ts`, `prospectsWorkspace.test.ts`, `prospectCallWorkflow.test.ts`: validation, journee Toronto, ordre des rappels/prochain appel, anciens liens, droits et suivi. | Fiche commune, transfert, resultat et nouveau rendez-vous atomiques, nettoyage ponctuel; SQL local. |
| Rendez-vous | Tests existants horaires/contrats; SQL local hold/retry/annulation/deplacement. | WordPress de test, Turnstile, concurrence et deduplication marketing. |
| Reservation mobile | Pas de test unitaire pour la mise en page seule; reference `wordpress-booking-layout.html`. | A 320/390/430/1280 px: sept jours alignes, boutons sans debordement, date/heure selectionnables. Banniere masquee sur la page 2129 et visible ailleurs. Aucun formulaire soumis. |
| Conversions | `acquisitionTracking.test.ts`: scripts WordPress/Meta executes hors ligne, UTM entre pages, deux confirmations, retries, consentement, stockage bloque et vraies API avec dependances simulees. | Publication WordPress/GTM autorisee, Tag Assistant et Meta Test Events en environnement isole; voir `conversion-tracking-release.md`. |
| Paie pro | `payrollCalculation.test.ts`: vrais calculateurs, durees, rapports, seuils, annulations. | DOCX, quantites/totaux, destinataires sans vrai envoi. |
| Budget/adjointes | `budgetExpenses.test.ts`: bornes, lien paie et types d'heures. | Sauvegarde/remplacement, separation salaires et vacances multimois. |
| Acquisition / horaire date | `acquisitionReporting.test.ts`: periodes Toronto, depenses journalieres, rapports manquants, vraie API paginee, ancien horaire/taux conserves et heure ajoutee payee. | Rapport reel de chaque plateforme, actualite du jour et modification du script Google live autorisee; sauvegarde du mois de paie sans changer les mois precedents. |
| Satisfaction/suggestions | Tests existants selection, preferences, filtres et destinataires. | RLS, imports anonymises, absence de nouvelle sollicitation. |
| Journal / Satisfaction | `auditJournal.test.ts`: exclusions par action/type, anciens champs NULL, autres actions preservees et vraie requete Supabase simulant le transport hors ligne. | Filtre avant la limite de 500, aucune ligne/option Satisfaction dans le journal, historique Satisfaction conserve. Aucun vrai courriel ni evenement de production cree pour tester. |
| Satisfaction/imports et tests | `satisfactionWorkspace.test.ts`: dates Excel, analyse/exclusions, recherche, homonymie, vraie API import/detail/reponses et test sans ecriture metier. `restrictedSections.test.ts` couvre aussi l'API de test par role. | Voir sur un import vide/ancien, recherche avec accents, aperçu HTML sur mobile/bureau. Un envoi test exige une adresse explicitement autorisee ; verifier sa livraison, jamais envoyer aux vrais clients pendant les tests. |
| Satisfaction / recence et pages | `satisfactionRecency.test.ts`: bornes des 30 jours Toronto, dates invalides refusees et futures admises, compte des quatre rencontres sur la periode longue, anciennes analyses et pages de 25. `satisfactionWorkspaceRoutes.mjs`: vraies API import/lecture/reintegration/envoi, horloge fixe et transport courriel simule. | Ancien lot filtre sans suppression, historique preserve, changement de page puis recherche ramenant a la premiere page. Aucun vrai envoi pour verifier la regle. |

Prise de notes, verification locale du 16 octobre 2026: `check:full` reussi,
173 tests et build; trois avertissements lint preexistants. Les vrais composants
ont ete controles dans un apercu au transport et aux identites fictifs: menus des
deux comptes pilotes, refus des autres comptes, preparation Teams/presentiel,
correction invalidant la relecture, validation, copie et confirmation separee.
Pas de debordement global a 390 et 320 px; actualisation remettant les essais a zero.
La vraie API est exercee hors ligne avec dependances simulees. Apres publication
autorisee (`74a9668`), acces super administrateur, relecture/validation et refus 401
sans session/avec jeton invalide verifies en production. Connexion directe au compte
professionnel pilote non exercee. Aucun SQL ni ecriture clinique. Menu lateral
defilant controle sur l'apercu direction: journal accessible, deconnexion visible.

Essai IA prepare: `clinicalNotesAi.test.ts` couvre signatures de fichiers et schema
de note; `clinicalNotesRoute.mjs` exerce GET et POST reels avec Auth et OpenAI
simules. Roles refuses avant traitement, service desactive sans cle/activation,
confirmation fictive, flux trop grand sans Content-Length, nom de fichier remplace,
`store:false`, schema strict, erreur fournisseur expurgee et aucun retry.
Les tests ne prouvent ni la qualite clinique ni la configuration du compte distant.
`check:full` du 16 octobre reussi apres ce branchement: 175 tests et build, trois
avertissements lint preexistants. Apercu avec transport OpenAI fictif: selection du
WAV synthetique, confirmation, transcription vidable/corrigeable, generation et
validation avant copie. Une correction exige une nouvelle relecture. Aucun appel
payant effectue pour ces controles; activation et test du fournisseur distincts.
Apres publication autorisee de `83c7d58`, essai fournisseur reel effectue depuis
le compte direction sur l'application de production: WAV synthetique fictif de
42 secondes, transcription fidele, note structuree sans observation/date inventee,
validation humaine puis bouton de copie disponible. Aucun dossier reel utilise.
POST anonyme et jeton invalide verifies: 401 et cache prive/no-store.
Ce seul scenario ne valide pas encore la qualite sur une consultation complete
ni l'enregistrement Teams; la connexion du professionnel pilote reste non exercee.

Capture Teams preparee localement: `clinicalNotesRecorder.test.ts` couvre melange
audio seul, dernier chunk, refus sans son Teams, micro refuse, annulation pendant
permission, fermeture active, limite 120 s, taille finale, perte d'une source,
erreur codec et navigateur incompatible. `check:full`: 185 tests et build reussis,
trois avertissements lint preexistants. Apercu isole avec vrais Web Audio et
MediaRecorder, deux oscillateurs synthetiques (aucun micro/Teams reel): deux niveaux
actifs, WebM cree, zero source apres arret/changement de compte; envoi bloque avant
les deux confirmations et transcription simulee ensuite. Refus audio et micro
exerces dans l'interface. Aucun appel IA payant pour ces controles.
Avant validation sur le poste cible: appel Teams entierement fictif dans Chrome ou
Edge, choisir fenetre Teams avec audio ou ecran entier avec audio, autoriser micro,
faire parler les deux personnes, verifier indicateurs puis reecouter les deux voix.
Tester aussi Annuler, arret du partage navigateur, fermeture et deconnexion.
Ne pas confondre l'apercu synthetique avec une verification de Teams/Windows reel.
Publication autorisee de `11f860c`: Vercel Ready; controles sur le domaine public
avec le compte super administrateur. Demarrage bloque avant confirmation et
disponible apres; aucun acces au vrai micro/partage pendant la verification.
WAV synthetique fictif importe: transcription et brouillon OpenAI reels reussis,
validation exigible avant copie. GET/POST anonymes et jeton invalide: 401 no-store.
Les restrictions aux deux comptes restent identiques et sont couvertes hors ligne;
connexion directe du professionnel et appel Teams fictif sur le poste restent a faire.

Choix du type prepare localement: `clinicalNotesAi.test.ts` couvre les six types,
valeurs inconnues/injection, titre et rubriques du texte copie; vraie API exercee
dans `clinicalNotesRoute.mjs` avec chaque modele et fournisseur simule. Verification
des consignes/schema correspondants, refus 400 avant fournisseur, ancien client
sans type en evolution et type retourne. `check:full` reussi: 187 tests et build,
trois avertissements lint preexistants. Apercu local avec capture synthetique et
transport IA simule: type requis avant capture, verrouillage pendant enregistrement,
brouillon evaluation 2, puis changement en fermeture effacant note/copie validees
et conservant la transcription; nouveau brouillon avec titre et nouvelle validation
requise. Aucun appel IA payant, capture reelle, SQL ou mise en ligne pour ces controles.
Apres autorisation, `da28534` publie (Vercel Ready). Verification sur le domaine public:
six options, capture bloquee sans type; WAV synthetique fictif transcrit puis plan
d'intervention genere via OpenAI. Changement apres validation en fermeture effacant
ancien brouillon/copie, transcription conservee. Note de fermeture reelle signalant
la fermeture non confirmee et les informations absentes. API sans session/jeton
invalide en 401 no-store. Aucun vrai micro, client, SQL ou autre compte utilise.

Mode Presentiel prepare localement: cinq tests ajoutes a `clinicalNotesRecorder`
pour absence de demande de partage, micro seul et nom WebM, refus/piste manquante,
permission tardive ou fermeture active, limite 120 s, niveau micro sans niveau Teams,
perte du micro et limite de taille. Les tests Teams existants restent verts.
`check:full` reussi: 192 tests et build, trois avertissements lint preexistants.
Controle visuel non realise: inventaire CUA vide et navigateur integre indisponible.
Avant validation manuelle, verifier dans l'essai fictif: choix de type puis mode
Presentiel, confirmation, micro seul sans partage, niveau micro, arret/reecoute,
effacement et envoi manuel. Verifier aussi le passage en Teams (nouvelle confirmation,
mode verrouille pendant capture), puis fermeture/deconnexion liberant le micro.
Aucune capture reelle ni requete IA payante effectuee pour ce changement local.
Apres autorisation, `8c157d5` publie et Vercel Ready. Navigateur reconnecte:
controle de l'interface sous super administrateur, six types, Presentiel par defaut,
demarrage micro bloque avant confirmation puis disponible, passage Teams demandant
nouvelle confirmation et retour Presentiel. Aucun micro active pendant ces controles.
API sans session/jeton invalide: 401 private no-store. Essai de voix fictives dans la
piece toujours distinct des tests automatises; aucun resultat clinique revendique.

Courriel et sondage: tests hors ligne des deux choix distincts (Google public et
sondage prive), premier bouton vers le vrai lien Google meme en test, logo PNG,
echappement HTML et liens de sondage test sans vrais jetons. L'API de reponse
est exercee sur fixtures: note/commentaire enregistres, jeton invalide refuse et
retry sans doublon. Apercu local isole: reponse de demonstration terminee sans
appel API, vrai lien Google propose apres toute note et desabonnement simule.
Le sondage de demonstration ne publie aucun avis et ne modifie aucune preference.

Le 13 octobre 2026, apercu isole des composants Satisfaction avec donnees fictives:
import vide consultable, periode Excel automatique, recherche sans accents, filtre
professionnel et tableaux verifies sur bureau et mobile (390 px). Aucun debordement
global; les tableaux defilent dans leur cadre. Les routes d'envoi de cet apercu sont
bloquees. La migration `satisfaction-import-analysis.sql` a ete validee separement
dans PGlite en memoire: ancien import preserve, analyse valide acceptee, cinq formats
invalides refuses et reapplication sans perte. Migration ensuite appliquee avec
autorisation en production: colonne JSONB confirmee apres commit, empreintes des
donnees et des dix politiques RLS inchangees, ancien import conserve.

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
   Appliquer la version corrigee de `prospect-direct-waiting-list-transfer.sql` apres le
   schema d'admission: cloture atomique des appels passes et controle des doublons.
   Le scenario de nettoyage exige aussi `assignment-processes.sql`, puis
   `supabase/prospects-and-calls.sql` APRES les scripts d'admission, et un profil direction
   fictif dans la base locale. Ne pas reinstaller ensuite la politique `direction_all`
   de l'ancien script: elle autoriserait de nouveau le DELETE direct.
   Installer aussi `supabase/prospect-call-workflow.sql` apres les scripts d'admission
   et le transfert pour les resultats atomiques et le nouveau rendez-vous de suivi.
5. Variable `LOCAL_TEST_DATABASE_URL` reservee a cette base locale.

Exemple fictif PowerShell, a remplacer seulement par des acces LOCAUX:

```powershell
$env:LOCAL_TEST_DATABASE_URL = 'postgresql://fixture:local-only-password@127.0.0.1:54322/fixture'
npm run test:db
Remove-Item Env:LOCAL_TEST_DATABASE_URL
```

`tests/integration/public-intake.sql` execute les vrais RPC: privileges, holds, retries,
identifiants, doublons potentiels, deplacement, annulation et transfert idempotent.
Il verifie aussi le refus d'une demande strictement identique et l'acceptation des
homonymes au meme contact avec un motif ou une naissance differents.
Donnees fictives, aucun courriel, aucune migration, transaction terminee par `ROLLBACK`.
Avec ON_ERROR_STOP, une erreur ferme la connexion et annule aussi la transaction.
Le succes ne couvre pas la concurrence multi-session ni toutes les RLS utilisateur.
`tests/integration/prospects-and-calls.sql` est lance ensuite: refus sans marquage,
controle de l'acteur, marquage reversible, nettoyage des liens, protection d'un client
transfere et rollback integral si l'audit echoue. Le trigger fictif et toutes les donnees
sont dans une transaction terminee par `ROLLBACK`. Aucun scenario n'installe de migration.
`tests/integration/prospect-call-workflow.sql` est lance ensuite: autorisations, refus de
conflit de plage, rollback si l'audit echoue, conservation de la meme fiche, retry sans
doublon, completion de l'appel et protection du dossier transfere. Transaction annulee.
Scenario prepare mais non execute au 12 octobre 2026: base de tests non configuree
et client `psql` non disponible lors de la mise en place.

Le 13 octobre 2026, validation distincte du seul RPC de transfert avec PGlite 0.5.9
(PostgreSQL 18.6 en memoire), installe temporairement hors des dependances de l'application.
Schema de colonnes/contraintes relu en production, fixtures fictives uniquement:
20 scenarios passes (homonymes, champs distincts, doublon identique, retry, cloture des
appels passes sans toucher les futurs, rollback si audit en echec, role et privileges,
garde de migration transactionnelle). Cette verification ne remplace pas la suite
`npm run test:db`, les RLS avec JWT distincts ou la concurrence multi-session.
La production PostgreSQL 17.6 a ensuite accepte la migration autorisee; empreinte de la
fonction et droits verifies apres commit, empreintes des donnees inchangees dans la
transaction, RPC serveur joignable et RPC anonyme refuse. Aucun vrai dossier transfere
ni courriel envoye. Sauvegarde/restauration de la fonction conservees hors Git.

Pour livrer Prospects et appels, valider en environnement isole les trois onglets,
les transferts anciens encore stockes comme planifies, les appels passes non traites
et les futurs appels qui doivent rester planifies. Verifier le transfert et son retry,
le refus d'une fiche existante et l'ouverture du dossier a la creation manuelle.
les liens `/direction/calendrier?...` et `/direction/prospects?prospect=...`, les heures
Toronto (hiver/ete), la fiche ouverte par la liste et le calendrier, les blocages,
l'affichage des anciens rendez-vous, le resultat et le transfert.
Verifier aussi Aujourd'hui/Demain aux bornes de minuit Toronto, la priorite des rappels
recus un autre jour, l'absence de commandes Modifier/Test dans la fiche, les trois choix
de resultat directement visibles et Autre/precision/nouveau rendez-vous sur la meme fiche.
Tester les URLs API avec direction, professionnel, marketing et sans session,
puis les RLS effectives avec des JWT distincts.
Le SQL de nettoyage doit etre revu et applique manuellement avec autorisation explicite;
La fiche ne propose plus de gestion de tests; le nettoyage ponctuel exige des identifiants
explicitement confirmes. Le SQL du parcours d'appel doit aussi etre installe avec autorisation;
les nouveaux resultats et reservations de suivi en dependent.

## Avant la mise en production
Pour la restriction Acquisition/Satisfaction: verifier menu et URLs directes avec les comptes
super administrateur et adjointes. Appliquer avec autorisation uniquement le correctif RLS
`supabase/satisfaction-super-admin-access.sql` sur une base existante (apres le schema Satisfaction).
Il ne modifie aucune donnee. Les tests Node verifient les API et le contrat du SQL, pas son execution.
Verifier ensuite les cinq tables Satisfaction avec des JWT distincts et le parcours public par jeton;
aucun envoi reel de courriel sans autorisation. Le 13 octobre 2026, les dix politiques
super administrateur (dont cinq gates restrictives) et la fonction verifiant l'email
du JWT ont ete retrouvees en production; la migration d'analyse conserve ces droits.

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
