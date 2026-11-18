# Correctif préparé — concordance des noms et libellés

Migration 970 appliquée le 18 novembre 2026 avec autorisation explicite. Les empreintes des neuf tables contrôlées sont identiques avant/après. Publication en préparation.

## Cause vérifiée en lecture seule

Une préparation opérationnelle non importée présente un prénom différent en
comparaison stricte, mais identique après la normalisation utilisée par l'interface.
Professionnel, naissance, empreinte de l'assignation et statut ouvert concordent.
Le serveur 920 refusait cette variation avec OPERATIONAL_ASSOCIATION_CHANGED.
Aucun nom ni renseignement personnel n'est conservé dans ce diagnostic.

970 aligne uniquement la comparaison des noms du parcours individuel sur la
normalisation de l'interface (casse, accents et séparateurs). Les verrous, UUID,
professionnel, naissance, confirmation et empreinte restent contrôlés. La fonction
de normalisation reste privée. Aucun enregistrement existant n'est mis à jour.
Le contrôle de baseline provoque un rollback si la fonction attendue a changé.

## Présentation

Le bloc complémentaire conserve les renseignements mais retire l'avertissement
générique Excel, les explications financières techniques et les termes d'export.
Les droits de consentement et les données restent inchangés.

Un échec de lecture dans un dossier fermé indique que le mandat archivé n'a pas
pu être chargé, sans confondre fermeture et indisponibilité de tout le service.
Les refus d'accès et les autres messages précis restent conservés. La fermeture
ne constitue pas, à elle seule, une explication de la panne réelle de lecture.

## Vérifications

- TypeScript global sans émission : réussi.
- Test du message contextualisé : réussi.
- 16 tests SQL sur base PGlite jetable : réussis, dont import sans accent,
  refus d'identité distincte / naissance différente / empreinte modifiée,
  absence de doublons et lecture d'un mandat dans un dossier fermé.
- Pas de recette navigateur authentifiée, pas d'import réel, pas de courriel.
- Le lecteur SQL distant ne permet pas d'exécuter les RPC privés/authentifiés ;
  la cause exacte de l'échec d'affichage du mandat réel n'est pas établie.

## Activation et retour arrière

Accord explicite requis pour appliquer 970 et publier l'interface. Ne pas lancer
d'import pendant la publication. Conserver la définition précédente de
public.clinical_migration_command_930_base(text,uuid,jsonb) dans la sauvegarde
technique autorisée avant application. Le retour arrière restaure cette définition
et le déploiement précédent ; aucun dossier, date, mandat ou document ne doit être
supprimé. Le nouveau helper SQL peut rester privé et inutilisé.

Le diagnostic Vercel distingue maintenant une liste réussie et un détail en échec (503). Quatre preuves attendent le rendu dans les mandats archivés contrôlés ; aucun document ne manque de contenu ou de référence Storage. Les traces ajoutées au lecteur exposent uniquement une étape fixe et un code autorisé, jamais une URL, un nom, une donnée clinique ou une erreur brute.
