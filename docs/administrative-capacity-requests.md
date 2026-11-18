# Gestion administrative des demandes professionnelles

## Périmètre

La fiche Direction > Professionnels > Demande et disponibilités ne dépend plus
pour sa gestion administrative de la présence du professionnel dans le répertoire
clinique. Le professionnel affiché provient toujours de la fiche autorisée. Les
rôles, habilitations, bureaux et activations cliniques ne sont pas modifiés.
L'espace professionnel et les modes de démonstration gardent leur parcours.

Toutes les demandes du professionnel sont affichées, avec édition et clôture via
les commandes capacities.update existantes (verrou, compteurs et contrôle de
version). Les demandes antérieures sont également modifiables. La suppression
n'apparaît qu'après contrôle serveur de superadministration ; masquer le bouton
ne remplace pas ce contrôle.

## Suppression

L'API historique /api/direction/assignment-requests/[id] est conservée. Le GET
privé fournit les compteurs et la version. Le DELETE utilise le JWT de l'opérateur,
une version et une clé de reprise. La nouvelle fonction 981 impose à nouveau le
contrôle public.is_super_admin(), un verrou de profil, des verrous de demande et
une transaction. Le corps ne peut pas choisir un autre opérateur.

Les assignations restent en place, détachées de la demande supprimée. Les FK
existantes suppriment les propositions de plages liées à cette demande et
conservent les reçus d'assignation en effaçant uniquement leur pointeur. Il n'y a
aucune FK enfant des propositions de plages. Aucun rendez-vous, dossier, document,
mandat, paiement ou droit n'est supprimé. Une trace administrative minimale et un
reçu de reprise restent conservés. Une interruption après le détachement annule
l'ensemble de la transaction. Une réponse perdue peut être reprise avec la même
clé, sans seconde suppression.

## Intégration des deux lots de facturation

Commits fonctionnels secondaires intégrés sans snapshot initial :
3ecffc3a934e22b5cbc8ca01348d63e2014c0793 et
8af52f9f78cd1c2909f2acf6e34941bb8c39c544.
Les correctifs Direction et 970 du chat principal sont conservés.

Le panneau Rencontres terminées et facturation est retiré. Les commandes de
facturation, rendez-vous et calculs ne sont pas exécutés par cette suppression
visuelle. Le premier lot regroupe les actions de paiement et la carte enregistrée,
avec confirmation explicite avant débit ; il retire l'annulation manuelle de
facture de l'interface et de l'API. 980 protège aussi le RPC direct. Les annulations
internes liées à une correction de rencontre ne sont pas remplacées par ce lot.
Aucune clé Stripe, mode de paiement ou règle d'envoi n'est activé.

## Installation et contrôles

980/981 installées le 18 novembre 2026 dans une transaction à snapshot stable.
Empreintes de treize tables inchangées, dont profils, capacités, demandes,
assignations, dossiers, mandats, documents, factures et paiements. Aucun import,
courriel, débit, suppression ou modification de demande réelle n'est exécuté.

Contrôles locaux réussis : TypeScript global, ESLint ciblé, deux scénarios du
composant React réel, transaction PGlite (refus, version, interruption, reprise,
conservation des assignations et révocation), cinq tests du lot facturation,
et scénario SQL complet de référence incluant édition/clôture pour un professionnel
sans activation clinique. Les contrôles Stripe emploient un transport simulé.

Définition de retour arrière financier sauvegardée dans
output/unification-pilot/output/finance-before-980.sql. Conserver 981 privée et
inutilisée en cas de retour au précédent déploiement ; ne pas retirer les traces
ou reçus qui auraient été créés ensuite. Les déploiements et preuves figurent dans
output/unification-pilot/docs/migration/REQUESTS_BILLING_RELEASE.json et le bilan
LIVE correspondant.

Publication finale : dpl_A9sQCYsH31HYzAPwTFYtQdxH75SC sur app.psychoeducaction.com, source 0a71857603e76a22bb21283716c4fd1a99be3546, 598 fichiers vérifiés. Le lien du répertoire Hicham ouvre directement la fiche et son onglet demandes par navigation documentaire, sans changer les liens des autres comptes. Le contrôle de suppression utilise le JWT de session sur sa route Direction, sans élargir le transport clinique. Recette navigateur authentifiée en lecture seule : chemin du répertoire jusqu’aux demandes vérifié, édition et suppression visibles pour le professionnel sans activation clinique, ancien avertissement absent. La clôture des demandes ouvertes est exercée sur fixtures. Bloc de facturation demandé absent. Aucun changement de demande réelle, débit ni courriel. Les deux lots secondaires sont inclus ; les trois constructions ont abouti READY et la promotion finale est confirmée. Bilan dans REQUESTS_BILLING_LIVE_PROMOTED.json.
