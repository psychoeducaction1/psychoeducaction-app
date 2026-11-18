# Menu Direction unifié — Hicham

Changement de présentation limité au compte demandé, à son accès administratif
existant et à l'application réelle. Aucun rôle, droit, compte ou schéma SQL modifié.

Les pages /administration réutilisent AppNav, comme les pages /direction : les
anciennes fonctions, les liens cliniques et leurs conditions d'accès sont conservés.
Le menu clinique habituel reste inchangé pour les autres comptes et le pilote.
Les menus ne constituent aucune nouvelle autorisation côté serveur.

La largeur de la page suit celle du menu Direction. Les boutons d'espace de
Hicham indiquent Direction et Mon espace professionnel. Les anciens chemins et
le retour au profil professionnel sont conservés. Les liens, le logo, les
procédures et la déconnexion passent par le garde de formulaires quand ce menu
est hébergé dans l'espace clinique. Les liens ouverts dans un nouvel onglet
conservent leur comportement habituel.

Contrôles locaux : TypeScript sans émission, ESLint ciblé, test du prédicat
(compte demandé, absence d'habilitation, autre compte, identité absente et pilote)
et contrôle du diff. Aucun appel de mutation, import ou courriel pendant ces tests.

Publication explicitement autorisée le 18 novembre 2026. Le candidat est préparé
depuis le manifeste de la version 970 publiée, avec vérification des empreintes.
