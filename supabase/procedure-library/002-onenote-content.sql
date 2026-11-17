-- Prepared content import only. Run after 001-library.sql with explicit authorization.
-- Existing edited articles are never overwritten. No membership is created.
begin;
insert into public.procedure_library_sections(id,title,position) values('b13cd4c7-cf72-5579-a4bc-78ce0f0735b4','Répartition des tâches',0) on conflict(id) do nothing;
insert into public.procedure_library_sections(id,title,position) values('c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Procédures en vigueur',1) on conflict(id) do nothing;
insert into public.procedure_library_sections(id,title,position) values('77a8a944-6a5a-53d4-a700-63a8dbe576d0','Plaintes et insatisfactions',2) on conflict(id) do nothing;
insert into public.procedure_library_sections(id,title,position) values('fabb371d-3ac9-5246-a3b9-5b22639d928b','Nouveauté et décisions',3) on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('bf8fdeef-bfbe-5a3b-a133-1897984f2790','b13cd4c7-cf72-5579-a4bc-78ce0f0735b4','Qui fait quoi : toutes les deux sur le même quart de travail','Tableau de répartition à compléter chaque semaine. Les colonnes « Nom de la personne qui s’en occupe » et « Semaine » sont vides dans le document source.

Tâches à répartir :
• Appels entrants
• Appels réservés
• Tri des courriels
• Envoi des factures le lendemain des rencontres
• Assignations

Source datée du 12 novembre 2026.',ARRAY['tâches','adjointe','quart','répartition' ]::text[],'review','Répartition des tâches / Qui fait quoi : toutes les deux sur le même quart de travail') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('8c587e90-efe0-5c2b-a618-72387079861b','b13cd4c7-cf72-5579-a4bc-78ce0f0735b4','Ordre des priorités en période de publicité ou d’achalandage','Ordre indiqué dans OneNote :
1. Plainte d’un client par téléphone.
2. Réservation d’appel.
3. Appel entrant.
4. Plainte d’un client par courriel.
5. Répondre dans Teams à un message de Tina ou de Hicham.
6. Envoi des factures.
7. Faire les assignations.
8. Trier et répondre aux courriels.

Source datée du 13 novembre 2026.',ARRAY['priorité','achalandage','publicité','appel','courriel' ]::text[],'review','Répartition des tâches / Ordre des priorités en période de publicité ou d’achalandage') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('9a3a37a4-b0e7-5279-add4-262a1a32cc41','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Ouverture d’un dossier sur la plateforme','Objectif
Créer un dossier complet, éviter les doublons et préparer le début des services.

Étapes
1. Vérifier si la personne possède déjà un dossier. Rechercher son nom et confirmer son identité avant toute création.
2. Recueillir les renseignements nécessaires :
• Identité et coordonnées de la personne qui recevra les services.
• Pour une personne de moins de 14 ans, le document demande les deux parents détenant l’autorité parentale ; si un parent indique être le seul détenteur, obtenir le document l’attestant.
• Coordonnées du demandeur, du représentant et du payeur, s’ils sont différents.
• Motif de consultation et service recherché.
• Disponibilités, langue et modalités souhaitées.
• Lieu privilégié : Longueuil, Montréal, domicile ou visioconférence.
• Présence d’un tiers payeur : PAE, IVAC ou autre organisme.
3. Inscrire la demande dans l’application d’assignation. Résumer les besoins sans poser de diagnostic ni promettre une prise en charge.
4. Créer ou compléter le profil et le mandat dans Psylog tant que cet outil demeure utilisé pour les dossiers et les horaires. Le document prévoit ensuite une plateforme commune.

Frais d’ouverture — consigne et réserve présentes dans la source
La source indique 60 $ à la confirmation du premier rendez-vous, séparément des honoraires professionnels et sans double facturation pour un même dossier. Elle demande de préciser au téléphone que sans ces 60 $, le rendez-vous n’est pas fixé.

La source comporte aussi ce point à valider avant formalisation : la nature exacte de ces frais et le moment de perception doivent être vérifiés au regard des normes de l’OPPQ ; ils ne doivent pas être présentés comme un paiement permettant d’attendre ou de réserver des services futurs. Cette réserve est conservée et cette fiche n’est pas une validation juridique de la règle.
Référence citée dans OneNote : https://ordrepsed.qc.ca/wp-content/uploads/2024/09/La-pratique-autonome-en-psychoeducation-Normes-dexercice.pdf

Source datée du 13 novembre 2026.',ARRAY['ouverture','dossier','doublon','parent','consentement','frais' ]::text[],'review','Procédures en vigueur / Ouverture d’un dossier sur la plateforme') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('b092f731-8549-5fef-a2a1-36853176424d','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Gestion de la liste d’attente','Objectif
Garder une liste fiable et permettre un jumelage dès qu’une disponibilité compatible se présente.

Renseignements à maintenir pour chaque demande
• Date de réception.
• Service recherché et âge de la personne.
• Résumé du besoin.
• Modalités, lieux et disponibilités.
• Contraintes particulières.
• Tiers payeur, s’il y a lieu.
• Dernière communication.
• Responsable et prochaine relance.

Étapes
1. Vérifier que la demande contient assez d’information pour rechercher un professionnel.
2. Préciser que l’inscription ne constitue pas une confirmation de rendez-vous.
3. Comparer les demandes avec les disponibilités réellement confirmées.
4. Vérifier explicitement la modalité : une demande en visioconférence ne doit pas être jumelée uniquement sur la base d’un bureau libre.
5. Faire examiner les besoins de jumelage en psychoéducation par Ève lorsque nécessaire.
6. Lorsqu’une place est proposée, inscrire la date de l’offre et la réponse attendue.
7. Mettre à jour le statut dès qu’un client accepte, refuse, reporte sa démarche ou n’a plus besoin de services.
8. En cas de non-réponse, consigner les tentatives et la prochaine action.

Fin du suivi
La demande est assignée ou rendue inactive avec un motif documenté.

Source datée du 13 novembre 2026.',ARRAY['attente','jumelage','relance','disponibilité','modalité' ]::text[],'review','Procédures en vigueur / Gestion de la liste d’attente') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('07bcbec7-46a0-5e64-aa7f-8dd96aff4c44','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Assignations','Objectif
Jumeler chaque demande avec un professionnel dont les compétences, les modalités et les disponibilités correspondent aux besoins.

Avant confirmation, vérifier :
• Que le professionnel accepte cette clientèle et ce mandat.
• Que la modalité correspond à la demande.
• Que l’horaire convient aux deux parties.
• Que le bureau est disponible, si nécessaire.
• Que les conditions du tiers payeur sont compatibles avec le service.

Méthode 1 — la clinique fait l’horaire
Le professionnel doit mettre ses disponibilités dans son horaire et faire une demande.
Personnes inscrites dans cette colonne du tableau source : Anne-Sophie, Patrick, Viviane, Alycia B., Victorine.

Méthode 2 — le professionnel fait son horaire
Le professionnel fait la demande sur le portail d’assignation et s’occupe du premier contact.
Personnes inscrites dans cette colonne : Nancy, Thinhinane, Karie, Sylvain, Maryse (ne reçoit plus de client), Mélanie, Hélièna, Aglaé, Ève, Megan (ne reçoit plus de client), Kahina, Solène, Karima, Mélina, Roxanne, Louis-N, Alicia G (congé maternité).

Cette répartition est celle du document daté du 13 novembre 2026 ; elle n’attribue aucun droit dans l’application et doit être tenue à jour par l’équipe.',ARRAY['assignation','jumelage','horaire','professionnel','méthode' ]::text[],'review','Procédures en vigueur / Assignations') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('bedba88c-16fa-5d3d-a299-f95276d11649','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Annulations et absences','Objectif
Documenter l’événement, prévenir le professionnel et appliquer les conditions financières convenues avec le client.

Étapes
1. Inscrire la date et l’heure de réception de l’annulation.
2. Vérifier l’heure du rendez-vous afin de calculer le préavis.
3. Prévenir rapidement le professionnel et renvoyer le client vers lui ; réenvoyer ses coordonnées professionnelles au besoin.
4. Inscrire le statut approprié au calendrier en conservant la trace. Selon la source, le professionnel le fait normalement ; l’administration garde un œil sur les oublis.
5. Confirmer au client l’annulation, les frais retenus et la possibilité de reprendre rendez-vous.

Tableau du document source
• Préavis d’au moins 24 h : sans frais ; professionnel non payé pour cette annulation.
• Annulation à moins de 24 h : frais possibles selon l’entente et la décision du professionnel, selon la raison ; colonne rémunération : oui, à 50 %.
• Absence sans préavis : frais possibles ; le professionnel choisit 0 %, 50 % ou 100 % selon les circonstances ; colonne rémunération : oui, à 50 %.
• Annulation par le professionnel : prévenir le client et organiser la reprise ; aucun frais d’annulation au client ; professionnel non payé pour cette annulation.

Ces consignes documentaires ne modifient ni les tarifs ni les calculs existants dans l’application. Source datée du 13 novembre 2026.',ARRAY['annulation','absence','préavis','24 h','rémunération' ]::text[],'review','Procédures en vigueur / Annulations et absences') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('e3df75c0-984f-5503-aba2-6c4d23ba2d91','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Facturation PAE','Objectif
Facturer conformément à l’autorisation du programme d’aide aux employés et suivre la couverture disponible.

Au téléphone
Demander le document attestant la couverture afin de connaître les modalités de remboursement. Mentionner que le client devra demander au PAE d’ajouter le professionnel comme fournisseur une fois le jumelage effectué.

Avant la première rencontre, vérifier dans le document :
• Nom du programme et coordonnées de facturation.
• Numéro de dossier ou d’autorisation.
• Professionnel et service admissibles.
• Nombre de rencontres ou plafond autorisé.
• Tarif et proportion couverte.
• Part éventuelle du client.
• Mode de transmission et pièces exigées.

Étapes
1. Obtenir les conditions écrites du PAE.
2. Vérifier si la clinique facture directement le programme ou si le client paie puis demande son remboursement.
3. Ajouter les modalités du PAE dans la convention de consentement.
4. Calculer la part de chaque payeur selon la couverture ; informer le professionnel et ajouter les paramètres au calcul du mandat.
5. Transmettre la facture par le canal prévu et conserver la preuve d’envoi.
6. Avertir le professionnel et le client avant l’épuisement de la couverture.
7. Faire confirmer les nouvelles conditions avant une poursuite au tarif privé.

Réserve explicite dans OneNote
Le document évoque trois rencontres couvertes à 100 %, puis un partage à 50 %, avec un plafond de 800 $ pour certains PAE. Il précise que cela doit être vérifié dans l’entente du dossier et ne constitue pas une règle générale.

Bureaux — consigne source à faire valider avant application
La source indique que le PAE rembourse uniquement les rencontres à Longueuil, et demande, pour Montréal, l’utilisation d’un « bureau 100 » administratif affilié à Longueuil. Elle précise que ce bureau n’est pas un lieu physique et que le professionnel devrait réserver le bureau physique puis modifier pour le bureau administratif. Cette consigne est conservée comme contenu à relire, sans validation de son admissibilité ; elle doit être clarifiée par la direction avec le payeur avant utilisation. La bibliothèque ne change aucune localisation de rencontre ni donnée de facturation.

Annexe mentionnée dans OneNote
« Guide_pairage_PAE_PsychoEducAction (1) », à envoyer au professionnel lors de l’assignation. Le contenu de cette pièce jointe n’a pas été récupéré dans cette livraison et reste à ajouter.

Source datée du 13 novembre 2026.',ARRAY['PAE','programme','couverture','payeur','bureau 100' ]::text[],'review','Procédures en vigueur / Facturation PAE') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('8a36e401-9427-5bbf-ac6c-cd67eda51cc7','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Facturation des clients','Objectif
Produire une facture exacte, enregistrer le paiement réel et remettre un reçu fidèle au service.

Tarifs de référence indiqués dans le document
• Psychoéducation : 135 $ par rencontre.
• Intervention en psychoéducation : 100 $.
• Psychothérapie : 180 $ par rencontre.
• Évaluation psychologique : selon le mandat et l’estimation ; 250 $ par rencontre. Nancy évalue le nombre de rencontres nécessaires pour compléter l’évaluation et produire le rapport.
• Déplacement : 0,64 $/km selon les conditions convenues. Le professionnel ajoute les frais de déplacement aux rencontres.

Étapes
1. Vérifier que la rencontre a été réalisée ou que les frais d’annulation ont été confirmés.
2. Contrôler la date, le service, le professionnel, le tarif et le payeur.
3. Vérifier les déplacements et les autres frais convenus.
4. Envoyer la facture dans l’outil utilisé (PsyLog au moment de la rédaction).
5. Confirmer le paiement dans le système de paiement ou les opérations bancaires.
6. Affecter le montant à la bonne facture.
7. Remettre le reçu correspondant au paiement reçu.

Règles internes retenues pour la future plateforme dans OneNote
• Préparation des factures le lendemain des rencontres admissibles.
• Validation manuelle de l’envoi et confirmation individuelle de chaque débit.
• Une facture distincte par payeur lorsque les coûts sont partagés.
• Correction d’une facture émise par un document rectificatif traçable.

Identité du bénéficiaire
Distinguer le client qui reçoit les services et la personne qui paie. Pour un suivi à l’enfant, ne pas remplacer son identité par celle du parent pour faciliter un remboursement. Le reçu doit identifier correctement le bénéficiaire et, lorsque nécessaire, le tiers payeur.

Fin du suivi
La facture est exacte, le paiement est rapproché ou le solde est inscrit au suivi des impayés.

Les tarifs sont repris comme documentation, sans modifier la configuration tarifaire. Source datée du 13 novembre 2026.',ARRAY['facture','reçu','paiement','tarif','déplacement','payeur' ]::text[],'review','Procédures en vigueur / Facturation des clients') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('11a23405-30ac-549d-a662-06a47d3a4f76','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Impayés','Objectif
Obtenir le paiement, résoudre les erreurs et assurer un suivi respectueux et documenté.

Étapes
1. Vérifier le solde avant de relancer : facture, paiements reçus, avoirs et répartition entre payeurs ; consulter le relevé de compte.
2. Distinguer oubli, paiement non rapproché, difficulté financière, contestation ou retard d’un organisme.
3. Indépendamment des rappels automatiques, envoyer un premier rappel par téléphone ou courriel indiquant le numéro de facture, la date, le montant et le moyen de paiement.
4. Consigner la communication dans le suivi administratif du dossier et fixer la prochaine relance.
5. Effectuer un suivi personnalisé par téléphone si le paiement demeure attendu.
6. Transmettre à Hicham les demandes d’entente, contestations et dossiers persistants selon les responsabilités convenues.
7. Consulter le professionnel avant toute démarche pouvant affecter le suivi clinique. La source demande que le professionnel annonce l’annulation des rencontres futures en cas de non-paiement, mais rappelle plus bas qu’aucune suspension ne doit découler automatiquement d’une relance administrative : cette articulation doit être confirmée par la direction.
8. Documenter les montants, dates, responsable et traitement d’un versement manqué.

Message de rappel proposé
Bonjour [prénom],
Notre suivi indique qu’un solde de [montant] demeure à régler pour la facture [numéro], datée du [date]. Si le paiement a déjà été effectué, merci de nous préciser la date et le mode de paiement afin que nous puissions le vérifier. Si vous rencontrez une difficulté, vous pouvez communiquer avec nous pour en discuter.
Merci !

Escalade
La suspension ou la fermeture d’un suivi ne doit pas découler automatiquement d’une relance administrative. Les conséquences cliniques doivent être examinées avec le professionnel.
Le document mentionne une tentative d’entente avant une démarche judiciaire et un délai de 60 jours pour les comptes d’un psychoéducateur, avec référence à ordrepsed.qc.ca. Cette mention est reprise comme référence du document, sans validation juridique dans cette bibliothèque.

Fin du suivi
Le solde est payé ou une autre issue est décidée et documentée.

Source datée du 13 novembre 2026.',ARRAY['impayé','solde','relance','entente','paiement' ]::text[],'review','Procédures en vigueur / Impayés') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('f3503a2e-d0ba-5315-a481-b952543e0bcb','c90bc95b-75e2-5e34-a6c2-6bcb26723d98','Facturation IVAC','Objectif
Facturer les services admissibles selon les conditions du dossier et distinguer la contribution de l’IVAC de toute part client.

Avant de facturer, obtenir et vérifier :
• Numéro de dossier IVAC.
• Lettre et documents précisant la couverture.
• Service et professionnel admissibles.
• Nombre de séances et conditions applicables.
• Renseignements fournisseur nécessaires.
• Mode de facturation.
• Entente financière du client, s’il existe une différence à payer.

Étapes
1. Vérifier la couverture applicable au dossier.
2. Confirmer que le service a été réalisé et correspond au mandat.
3. Pour l’assignation, s’assurer que le professionnel est fournisseur IVAC.
4. Inscrire la date, la durée, le professionnel et le montant admissible.
5. Calculer séparément toute part client expressément convenue.
6. Utiliser le formulaire ou canal de transmission applicable, en entrant le nom et le prénom du professionnel. Lien mentionné, sans identifiant de session temporaire : https://servicesenligne.cnesst.gouv.qc.ca/envoifichier/Indem/victimeIVAC/?lang=fr
7. Conserver la preuve d’envoi et suivre le paiement.
8. Vérifier le solde de séances et les conditions de poursuite.

Tarif clinique et remboursement — valeurs citées par le document, à vérifier pour le dossier
La source mentionne un maximum de 94,50 $/h pour les séances de réhabilitation psychothérapique ou psychosociale. Elle précise que la lettre au bénéficiaire détermine les conditions et le nombre de séances, et que les absences ne sont pas remboursables.
Exemple de la source : 135 $ moins 94,50 $ laisse 40,50 $. La part client ne doit être facturée que si les conditions le permettent et qu’une entente appropriée a été conclue. Le client doit être avisé par téléphone et signer l’entente de consentement avant les séances.

Contrôles particuliers
• Vérifier la réception effective de la facture : sa présence dans Psylog ne confirme pas sa transmission à l’IVAC.
• Ne pas transmettre automatiquement les notes cliniques avec la facturation.
• Faire vérifier les frais d’ouverture et autres frais accessoires avant application à un mandat IVAC.
• L’IVAC ne rembourse pas les absences selon la source.

Fin du suivi
La facture est transmise, le paiement rapproché et la couverture restante actualisée.

Source datée du 13 novembre 2026 ; aucun remboursement ou tarif n’est configuré par cette fiche.',ARRAY['IVAC','couverture','fournisseur','réhabilitation','facture' ]::text[],'review','Procédures en vigueur / Facturation IVAC') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('36898949-8df6-52c2-a819-9932c8d83979','77a8a944-6a5a-53d4-a700-63a8dbe576d0','Procédure de traitement des plaintes des clients','Champ d’application
Toute insatisfaction exprimée par un client, parent ou représentant concernant les services, un professionnel, un rendez-vous, la facturation ou la confidentialité. Une plainte verbale est traitée comme une plainte écrite.

1. Accueillir la plainte
Écouter sans interrompre, remercier le client et reconnaître son insatisfaction. Ne pas débattre des faits, conclure à une faute ni promettre remboursement ou résultat précis.
Vérifier l’identité, les coordonnées et le moyen de suivi souhaité. Si une personne parle au nom d’un client, vérifier son autorité ou le consentement avant de communiquer des renseignements.
Recueillir seulement les informations nécessaires : faits et date, personnes concernées, conséquences rapportées, suite souhaitée, rendez-vous à venir et urgence éventuelle.
Si la sécurité immédiate est en jeu, la source demande de joindre le 911 et d’aviser immédiatement la direction clinique. Les autres risques cliniques préoccupants sont transmis sans attendre le circuit habituel.

2. Consigner la plainte
Ouvrir le jour même une fiche dans le registre interne des plaintes à accès restreint. Consigner fidèlement les faits et propos, sans jugement ni hypothèse.
Inscrire : date, heure et mode de réception ; client et personne formulant la plainte ; coordonnées vérifiées ; réceptionnaire ; résumé factuel ; dates et personnes concernées ; documents reçus et attentes ; urgence ; responsable et transmissions ; actions, réponse et clôture.
Conserver le message original et les pièces jointes dans l’espace sécurisé prévu. Ne pas diffuser la plainte dans un canal d’équipe. Ajouter au dossier clinique uniquement une information pertinente aux soins, par une personne autorisée.

3. Transmettre à la bonne personne
• Rendez-vous, accueil, facturation ou autre question administrative : Hicham Boukili. Informer la coordination si le suivi est touché.
• Qualité des soins, conduite professionnelle ou relation thérapeutique : Thinhinane Ould Younes, direction clinique, le jour même. La coordination rassemble les faits et aide à organiser la continuité.
• Confidentialité ou accès non autorisé : immédiatement à la direction et à la personne responsable de la protection des renseignements personnels ; préserver messages et traces.
• Risque sérieux, allégation d’abus, menace, communication d’un ordre ou mise en demeure : immédiatement aux deux directions. Aucune réponse standard avant évaluation.
Si la plainte vise la personne normalement responsable, transmettre à l’autre direction. Limiter l’accès aux personnes devant intervenir.

4. Accuser réception
L’adjointe envoie un accusé au plus tard le jour ouvrable suivant, précise la personne responsable et la date de mise à jour. Éviter les détails cliniques dans un courriel non sécurisé. Il s’agit d’une cible interne.

Message type
Bonjour [nom],
Nous avons bien reçu votre message du [date] concernant [objet général]. Merci de nous avoir fait part de votre expérience.
[Nom ou fonction] assurera le suivi de votre demande et communiquera avec vous le plus rapidement possible.
Cordialement,
[Signature]

5. Analyser et décider
La personne responsable recueille les informations pertinentes, consulte les documents et distingue les faits établis des points à clarifier.
La coordination peut organiser la collecte et proposer des mesures de continuité, mais ne tranche pas seule une question de conduite professionnelle ou de déontologie. La direction concernée décide et valide la réponse.
En cas d’incident possible de confidentialité, la direction et la personne responsable évaluent la situation, réduisent le risque et examinent les obligations de registre et d’avis. La source cite la Commission d’accès à l’information du Québec.

6. Répondre et assurer le suivi
La direction valide idéalement une réponse dans les cinq jours ouvrables. Si l’analyse demande plus de temps, communiquer une nouvelle date. C’est une cible interne, pas un délai légal.
Présenter la compréhension de la plainte, les vérifications communicables, la mesure retenue et son échéance, sans renseignement sur un autre client ou détail confidentiel concernant le personnel.
La coordination vérifie les mesures cliniques ; l’administration vérifie les corrections administratives. Inscrire la réponse, les suivis et la clôture au registre. Porter les problèmes récurrents aux directions.

Recours mentionné dans la source
Le client peut s’adresser directement au bureau du syndic de l’ordre compétent sans terminer la démarche interne. Si une enquête est en cours, la direction et le professionnel vérifient les consignes de l’ordre avant de communiquer avec le client à ce sujet.

Source datée du 13 novembre 2026. Cette bibliothèque contient la procédure, pas le registre des plaintes réelles.',ARRAY['plainte','insatisfaction','confidentialité','escalade','direction' ]::text[],'review','Plaintes et insatisfactions / Procédure de traitement des plaintes des clients') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('78e74493-5bb0-5ec7-a280-f53a5cf64fa1','77a8a944-6a5a-53d4-a700-63a8dbe576d0','Fiche de réception et de suivi d’une plainte client — modèle vierge','Document interne à accès restreint — modèle vierge
Copier le modèle dans le registre sécurisé prévu pour chaque plainte. Ne pas compléter un cas réel dans cette bibliothèque de procédures.

1. Réception
Date et heure : ____________________
Reçue par : ____________________
Mode : ☐ Téléphone ☐ Courriel ☐ En personne ☐ Autre : __________
Client concerné : ____________________
Personne formulant la plainte, si différente : ____________________
Lien avec le client : ____________________
Identité et autorisation vérifiées : ☐ Oui ☐ Non ☐ Sans objet
Coordonnées vérifiées : ____________________
Moyen de communication souhaité : ____________________

2. Description
Sujet : ☐ Accueil/administration ☐ Rendez-vous ☐ Facturation ☐ Qualité des services ☐ Conduite professionnelle ☐ Confidentialité ☐ Autre : __________
Résumé factuel des propos :

Date ou période des événements : ____________________
Personnes ou services concernés : ____________________
Conséquences rapportées :

Suite souhaitée :

Documents ou messages : ☐ Aucun ☐ Oui ; lieu de conservation : __________
Décision rapide liée à un rendez-vous : ☐ Non ☐ Oui
Date du rendez-vous et décision à prendre : ____________________

3. Évaluation initiale et transmission
Priorité : ☐ Habituelle ☐ Le jour même ☐ Immédiate
Motif de priorité :

Personne avisée : ☐ Direction administrative ☐ Direction clinique ☐ Coordination ☐ Responsable de la protection des renseignements personnels ☐ Autre : __________
Date et heure de transmission : ____________________
Responsable du traitement : ____________________
Mesure immédiate prise :

4. Analyse et décision
Pour chaque échange : date | vérification/échange | réalisé par | résultat/suite.
Faits établis :

Points à clarifier :

Mesure ou décision :

Validation par : ____________________
Date de validation : ____________________

6. Réponse et clôture (numérotation de la source conservée)
Date de réponse : ____________________
Réponse transmise par : ____________________
Résumé de la réponse et des mesures annoncées :

Actions : action | responsable | échéance | réalisation.
Client recontacté pour vérifier la suite : ☐ Oui ☐ Non ☐ Sans objet
Résultat du suivi : ____________________
Date de clôture : ____________________
Clôture validée par : ____________________
Amélioration aux pratiques :

Source datée du 17 novembre 2026.',ARRAY['plainte','modèle','fiche','réception','suivi' ]::text[],'review','Plaintes et insatisfactions / Fiche de réception et de suivi d’une plainte client — modèle vierge') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('b488f5ab-eb66-5de0-a435-9c2025217525','fabb371d-3ac9-5246-a3b9-5b22639d928b','Décisions admin','',ARRAY['décision','administration' ]::text[],'draft','Nouveauté et décisions / Décisions admin') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('3b60b552-a3aa-5c25-ad68-29785c7dc6d3','fabb371d-3ac9-5246-a3b9-5b22639d928b','Décision de coordination','',ARRAY['décision','coordination' ]::text[],'draft','Nouveauté et décisions / Décision de coordination') on conflict(id) do nothing;
insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('170643a9-89f4-5287-af7a-c4e50b175efa','fabb371d-3ac9-5246-a3b9-5b22639d928b','Proposition de procédures à valider','',ARRAY['proposition','validation' ]::text[],'draft','Nouveauté et décisions / Proposition de procédures à valider') on conflict(id) do nothing;
insert into public.procedure_library_revisions(article_id,version,section_id,title,body,keywords,status,edited_by,edited_at) select id,version,section_id,title,body,keywords,status,updated_by,updated_at from public.procedure_library_articles where source_title is not null on conflict(article_id,version) do nothing;
commit;
