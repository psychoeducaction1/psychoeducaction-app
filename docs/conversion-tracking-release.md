# Livraison du suivi Google / Meta

Correctif publie le 12 octobre 2026 apres autorisation explicite de l'utilisateur.
La validation locale ne prouve pas une reception par les plateformes.
Aucun budget, enchere, ciblage ou SQL distant a modifier sans autorisation specifique.

## Verification Meta et correction du 12 octobre, apres publication initiale

- Attestation `I acknowledge` acceptee apres confirmation explicite de l'utilisateur.
- `Manage event blocking > Blocked > Lead > View details` confirme: evenement standard
  `Lead` bloque par Meta selon la categorie de la source. Il ne s'agit donc plus
  seulement d'une absence de reception a verifier. Aucune demande de revision deposee:
  le site offre effectivement des services de sante, et aucune erreur de classement
  n'a ete etablie. Ne pas renommer la reservation en un autre evenement pour contourner
  cette restriction, ni utiliser Conversions API pour la contourner.
- GTM version **18** publiee, `Meta — suspension Lead bloqué — 2026-10-12`:
  uniquement les balises 46 et 47 mises en pause. Les scripts ci-dessous restent
  des references techniques; **ne pas reactiver ces balises** sans nouvelle validation
  des restrictions applicables. Google Ads, GA4, les declencheurs et le consentement
  sont inchanges. La provenance interne WordPress/application reste active.
- PageView est actif dans Meta Events Manager, derniere reception indiquee une heure
  avant la verification. Ceci prouve une reception recente de visites, pas des reservations.
- Campagne `120247734032640766` relue: active, 20 CAD/jour, objectif `OUTCOME_LEADS`,
  ensemble `120247734034450766` en `OFFSITE_CONVERSIONS`, evenement `LEAD`.
  L'editeur verrouille la destination, le but de performance, le pixel et l'evenement
  de cet ensemble publie. Les parametres de provenance de l'annonce sont confirmes.
- Remplacement autorise explicitement puis effectue a budget inchange:
  - Nouvelle campagne `120247859031510766`, `Psychologue en ligne – Québec – Trafic`,
    `OUTCOME_TRAFFIC`, active, budget de campagne 20 CAD/jour.
  - Ensemble `120247859031540766`, `Québec 25-60 – Site web – Visites de page`,
    actif, `LANDING_PAGE_VIEWS`, Quebec (region 535), ages 25-60, tous genres,
    toutes langues, Advantage+ audience desactive et extension geographique desactivee.
  - Annonce `120247859105180766`, `Psychologue en ligne – Créatif principal`,
    meme image (asset `bd451851a979e4fbf300a5f32a7df4fa`), texte, titre, bouton
    `SEE_DETAILS` et destination `/psychologue-en-ligne/`. UTM relus sur l'annonce
    publiee, suivi Website events avec le pixel existant. En examen par Meta lors
    de la derniere verification; activation ne prouve pas encore une diffusion.
  - Nouvelle campagne publiee en pause et relue; ancienne campagne
    `120247734032640766` mise en pause et relue; nouvelle campagne activee ensuite.
    Aucun chevauchement de campagnes actives lors de cette bascule, aucun changement
    des budgets Google ni des autres campagnes Meta.
  - Le changement d'objectif dans le brouillon Meta reinitialisait budget et ciblage:
    valeurs par defaut corrigees AVANT publication. L'annonce a ete recopiee directement
    depuis l'originale vers le nouvel ensemble pour conserver son contenu.
    Les exclusions pays hors Canada ne pouvaient pas etre selectionnees dans le
    nouvel editeur, car deja hors des controles d'audience du compte; inclusion
    uniquement Quebec confirmee dans le recapitulatif et par le connecteur.
  - Quatre brouillons preexistants conserves. Brouillon vide de copie
    `120247859031520766` jamais publie; annulation irreversible soumise a confirmation
    distincte, encore en attente lors de cette verification.
  Les demandes reelles doivent etre mesurees dans Acquisition avec leurs UTM;
  une visite Meta ne doit jamais etre presentee comme une reservation.
- Controle local apres cette intervention: `npm run check:full` reussi, 142 tests,
  types et build verts. Lint sans erreur: avertissement existant de connexion et
  deux avertissements de fonctions inutilisees dans le fichier temporaire ignore
  `.env.wordpress-intake-helpers-served-20261012.js`. Aucune nouvelle modification
  de code applicatif; seules cette documentation et `PROJECT_NOTES.md` changent.

Source: [restrictions Meta selon la categorie](https://business.facebook.com/business/help/511197658391698).

## Exclusions Google autorisees le 12 octobre 2026

- Campagne `24325990045`, `Psychoéducation – Montréal`: ajout au niveau campagne
  de `[psychoéducation udem]` et `[udem psychoéducation]`, en correspondance exacte.
  Aucun terme generique ni autre recherche exclu sur la base des conversions historiques
  incompletes. Les onze exclusions existantes sont conservees (treize apres ajout).
- Relecture dans Google Ads puis via le connecteur: deux exclusions exactes presentes,
  budget toujours 20 CAD/jour, statut, encheres et autres criteres de ciblage inchanges.

## Etat de livraison et limites verifiees

- WPCode 7674 actif, JavaScript dans l'en-tete du site. Le script effectivement
  servi correspond au fichier de reference (apres normalisation CRLF/LF).
- Page WordPress 2129: nouveau helper `emitIntakeSubmitted(result,type)` present
  dans le script public; ancien helper retire. Dans le widget Editeur de texte
  Elementor, synchroniser Code > Visuel > Code avant publication: modifier le
  textarea seul ne mettait pas a jour le contenu publie. Affichage public verifie.
- GTM: version 17 publiee, titre `Conversions appels et rappels rapides — 2026-10-12`.
  Les trois modifications decrites ci-dessous sont dans cette version.
- Les cinq campagnes Google lancees le 5 octobre ont le suffixe indique ci-dessous.
  Relecture des budgets (60/20/20/40/30 CAD), encheres et statuts: inchanges.
- Annonce Meta `120247734037250766`: parametres d'URL publies et relus dans
  l'editeur de l'annonce active. Publication individuelle, autres brouillons conserves.
  Le connecteur ne restituait pas correctement ces parametres; sa reponse `applied`
  seule ne suffisait pas. Budget de campagne toujours 20 CAD/jour.
- Scripts publics recuperes depuis le DOM puis executes hors ligne: provenance
  Google/Meta apres navigation, reservations, rappels et retries sans doublon valides.
  Aucun rendez-vous, courriel ou evenement publicitaire fictif cree en production.
- Meta Events Manager applique les categories `Health & wellness - other`,
  `Health & wellness provider` et `Health & wellness condition`, avec `Core setup: On`.
  Meta indique que certaines transmissions/evenements peuvent etre bloques.
  L'aperçu du 14 septembre au 11 octobre n'affiche que PageView et `__missing_event`,
  aucun Lead. Le detail des evenements bloques exige `I acknowledge` sur les
  conditions Meta Business Tools: cette attestation n'a pas ete acceptee par l'agent.
  Aucun contournement des restrictions ni changement de categorie demande.
  Cet etat initial est remplace par la verification et la suspension documentees ci-dessus.

## WordPress

1. Conserver une copie du contenu actuel du formulaire et des snippets concernes.
2. Installer `docs/wordpress-acquisition-tracking.js` comme JavaScript global WPCode
   avant le formulaire, sur les pages d'arrivee publicitaires et de reservation.
   Le script utilise Complianz pour la conservation marketing. Ne pas mettre ce
   script entier en attente de consentement: il fournit aussi les helpers du formulaire;
   seules les balises publicitaires et la persistance marketing sont conditionnelles.
3. Dans le script de la page `/reserver-un-appel/` (page WordPress 2129), remplacer
   `utm()` et `emitBookingSubmitted()` par les fonctions de
   `docs/wordpress-intake-form-tracking.js`. Retirer l'ancien `emittedBookingEvents`.
4. Remplacer le debut du gestionnaire de succes:

   ```javascript
   task.then(function (result) {
     emitIntakeSubmitted(result, type);
     if (type === 'scheduled_call') bookingAttempt = null;
     // Conserver integralement l'affichage de confirmation existant.
   });
   ```

   Conserver la validation, Turnstile, les retenues, les cles d'idempotence,
   les requetes et les messages existants. Ne pas emettre d'evenement au clic
   sur le bouton, sur une erreur ou avant la reponse positive du serveur.

Les nouvelles campagnes remplacent l'attribution precedente sans melanger leurs
identifiants Google/Meta. La duree de conservation est de 30 jours, uniquement
avec consentement marketing. Sans consentement ou stockage disponible, seuls
les parametres presents sur la page peuvent accompagner la demande interne;
la provenance peut donc rester inconnue. Aucun renseignement de formulaire
n'entre dans le dataLayer ou les appels a Meta/Google.

## Conteneur GTM-NZ8G3VBV

Configuration effectivement lue le 12 octobre: espace de travail 17, aucun
changement en attente a l'ouverture. Il existe deja une conversion Google, un
evenement GA4 et deux balises Meta. Ne pas en installer une seconde copie.
Le declencheur 43 et les deux HTML Meta 46/47 ont ete publies dans la version 17.
La publication a ete autorisee, ainsi que le commit/push de l'interface Acquisition.

- Declencheur 43 `CE - booking_form_submitted`: remplacer le nom de l'evenement
  par `^(booking_form_submitted|rapid_callback_submitted)$` et activer l'expression
  reguliere. Le nom historique du declencheur est conserve pour ses references.
  Garder ses references existantes: Google Ads, GA4 et les deux balises Meta.
- Balise Google 45: conserver ID `16670877953`, label `eIZbCPD39pEdEIHSpY0-`
  et Transaction ID `{{DLV - conversion_event_id}}` (deja configure).
- Balise Meta 46 `Meta - File locale Lead`: remplacer son HTML par
  `docs/gtm-meta-lead-queue.html`. File locale d'UUID uniquement; aucun envoi.
- Balise Meta 47: remplacer son HTML par `docs/gtm-meta-lead.html`.
  Garder les declencheurs de demande confirmee et de consentement marketing,
  ainsi que l'exigence supplementaire `ad_storage`. Le code recontrole le
  consentement lors des tentatives retardees et gere un stockage indisponible.
- Garder le pixel existant `1137626322165697` et ses conditions Complianz.
  Ne pas ajouter un deuxieme PageView ni activer la correspondance automatique
  ou la collecte des champs du formulaire.
- Garder les anciens clics Psylog et telephone secondaires. Ne pas transformer
  un clic ou un transfert vers la liste d'attente en nouvelle reservation.

## Provenance des publicites

Conserver les parametres d'URL existants, puis ajouter les champs manquants.
Les identifiants de clic seuls identifient la plateforme, pas le nom de campagne.
Ces parametres ne modifient pas les budgets.

Google Ads, suffixe d'URL finale (sans `?`, pas l'URL finale elle-meme):

```text
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}&utm_content={creative}&utm_term={keyword}
```

Meta, parametres d'URL de l'annonce (pas le champ URL du site):

```text
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_content={{ad.id}}
```

Verifier les redirections et liens internes avec des identifiants fictifs.
La page Acquisition, toujours reservee au super administrateur, distingue les
publicites Google/Meta des sources organiques et affiche le nombre de demandes
avec provenance. Les anciennes demandes sans attribution ne sont pas reconstituees.

## Verification

`tests/acquisitionTracking.test.ts` execute les vrais scripts WordPress et Meta
avec des doubles navigateur hors ligne: Google/Meta, deux types de demande,
navigation, nouveau canal, expiration, consentement/retrait, stockage bloque,
retries, pixel tardif, erreurs, absence de donnees personnelles.
Les vraies routes booking/callback et Acquisition sont executees dans un
sous-processus avec des RPC, autorisations et notifications simules.
Cela couvre la transmission/relecture des UTM par l'API, pas l'execution SQL.
`npm run check:full` reussi: types, lint, 142 tests et build. Seul l'avertissement
lint preexistant de la page de connexion subsiste, ainsi que l'avertissement
Node preexistant sur le type du package. Aucun test reel de soumission execute.

Apres publication autorisee:
1. Recharger les pages publiques hors cache; verifier les scripts effectivement servis.
2. Dans GTM Preview, verifier les deux noms d'evenement et l'UUID transmis a
   Google comme Transaction ID et a Meta comme eventID. Verifier les refus de consentement.
3. Tester la reception dans Tag Assistant et Meta Events Manager, avec des fixtures
   et un environnement isole. Aucun vrai appel/courriel ni evenement de production
   fictif sans autorisation distincte. Si Meta bloque une categorie/evenement,
   lire les diagnostics et ne pas contourner la restriction.
4. Sur les prochaines demandes reelles, comparer les compteurs agreges et la provenance
   dans Acquisition. Les fenetres/dates d'attribution et le consentement peuvent
   expliquer des ecarts avec les plateformes; ne pas exiger une egalite brute.

Sources de configuration: [deduplication Google](https://support.google.com/google-ads/answer/6386790?hl=en)
et [parametres ValueTrack](https://support.google.com/google-ads/answer/6305348?hl=fr).
