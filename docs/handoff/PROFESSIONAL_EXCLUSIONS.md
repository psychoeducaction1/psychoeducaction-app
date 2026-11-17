# Préférences — motifs non pris en charge

L'éditeur partagé `ProfessionalPreferencesEditor.tsx` propose maintenant pour les
exclusions exactement `motifOptions`, la même liste que pour les motifs et champs
d'intérêt. Le commentaire d'exclusions et le champ Notes et précisions restent
disponibles. Les choix acceptés ne sont pas changés lorsqu'on coche une exclusion :
une limite peut nécessiter une précision ou une exception.

`lib/professionalExclusions.ts` lit et écrit le champ texte existant `pref_exclusions` :
une première ligne « Motifs exclus : » avec les libellés sélectionnés, puis une
ligne vide et le commentaire. Les autres écrans et exports continuent de recevoir
un texte lisible. Aucun champ API, migration, droit ou moteur de jumelage n'est
modifié. Les préférences passent toujours par les commandes authentifiées et
versionnées existantes. La limite serveur du texte reste inchangée ; rien n'est
tronqué automatiquement.

Les anciens textes restent dans le commentaire, sans recherche approximative de
mots pour cocher automatiquement des exclusions. Seul un en-tête exactement au
format généré, composé de libellés reconnus, est interprété comme sélection.
Un ancien texte déjà identique à ce format sera donc présenté comme sélection.
Les formats non reconnus restent intégralement dans le commentaire. Les cases
sont reconstituées à la relecture du champ sauvegardé.

L'éditeur est déjà utilisé dans les préférences des fiches professionnelles, les
écrans d'admission et les écrans historiques. Les appelants, notamment
`ProfessionalWorkspace.tsx`, ne sont pas modifiés pour éviter les travaux parallèles
sur les signatures. L'éditeur de notes n'est pas touché.

Vérification : trois tests Node hors ligne réussis, sur textes historiques, tous
les motifs et leur relecture, puis interactions de l'éditeur réel (cocher,
décocher, modifier le commentaire et conserver les motifs acceptés).

Commande :
`node --import ./tests/register-office-visibility.mjs --test --experimental-strip-types tests/professionalExclusionChoices.test.ts`

ESLint ciblé et vérification du diff également effectués. Pas de build complet,
test navigateur, sauvegarde distante ni vérification RLS réelle. Aucune publication.
Le test utilise le lanceur hors ligne ajouté dans le commit du calendrier : importer
les commits dans leur ordre, ou employer le lanceur équivalent déjà présent dans
le dépôt principal. Fichiers applicatifs changés : uniquement l'éditeur partagé
et le nouveau helper. Risque de conflit si l'éditeur partagé évolue ailleurs.
