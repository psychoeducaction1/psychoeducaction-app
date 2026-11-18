# Apercu Direction de l'espace d'assignation

Depuis Direction > Professionnels, le lien Voir l'espace professionnel ouvre un apercu en lecture seule pour ce professionnel. Le compte Direction reste connecte.

Consultation : tableau de bord, assignations non annulees, demande active, historique complet des demandes avec clients, clients sans demande liee et preferences. Les calculs utilisent les helpers du parcours professionnel existant. Les donnees sont relues depuis les tables existantes, sans reparation automatique des compteurs.

L'API GET verifie l'identite et les droits Direction avant toute lecture privilegiee, exige un UUID et un profil professionnel, limite les lectures au professionnel cible et pagine sans troncature silencieuse. Aucune route d'ecriture, emission de session cible, courriel ou nouvelle permission. Les reponses sont private/no-store.

Limites explicites : presentation adaptee a la lecture seule, pas une usurpation de session ni une preuve des RLS de la session du professionnel. Cet apercu porte sur les assignations; il ne reproduit pas les ecrans de notes, calendrier clinique et facturation. Les vues administratives cliniques existantes restent distinctes.

Publication autorisee par le chat principal. Aucun schema ni migration necessaire. Verification distante limitee a la consultation des assignations et de l historique.
