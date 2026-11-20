/** Fixed explanations only. Never echo SQL text, submitted values or an unknown
 * provider error. Messages describe the next manual step, not an automatic retry.
 */
const failures:Record<string,string>={
 MIGRATION_BIRTH_DATE_MISMATCH:'La date de naissance diffère de celle du dossier existant. Comparez les deux dates dans la fiche, vérifiez un document fiable et faites corriger la date erronée avant de valider.',
 PATIENT_CHANGED:'La fiche du client a changé depuis sa préparation. Cliquez sur « Actualiser les correspondances », puis vérifiez à nouveau le client avant de valider.',
 CASE_CHANGED:'Le suivi sélectionné a changé. Actualisez les correspondances et vérifiez le professionnel et le dossier à reprendre avant de valider.',
 OPERATIONAL_ASSOCIATION_CHANGED:'L’assignation ne correspond plus à la préparation. Actualisez les correspondances, puis vérifiez le professionnel, l’identité et le statut du suivi. Si le blocage reste présent, faites vérifier l’assignation par la Direction.',
 MIGRATION_CONFLICT:'Le lot a changé depuis votre dernière action. Rouvrez son rapport et reprenez les fiches encore en attente ; ne recommencez pas les dossiers déjà traités.',
 MIGRATION_SETTINGS_CHANGED:'Les paramètres du service ont changé. Actualisez les correspondances et vérifiez le service et le tarif avant de reprendre la même fiche.',
 MIGRATION_IDENTITY_CONFLICT:'Une identité existante présente une contradiction ou plusieurs correspondances. Vérifiez le nom, la naissance et le dossier existant avec la Direction ; ne créez pas un second client pour contourner ce blocage.',
 MIGRATION_REQUESTER_AMBIGUOUS:'Plusieurs requérants portent le même nom. Vérifiez leurs coordonnées dans « Requérants et responsables des honoraires » pour distinguer les personnes avant de valider.',
 MIGRATION_CLIENT_INVALID:'Les renseignements préparés pour ce client sont incomplets ou incohérents. Vérifiez les champs signalés dans la fiche ; si aucun champ n’est indiqué, faites vérifier le dossier par la Direction.',
 MIGRATION_CLIENT_DATE_INVALID:'Une date de contact ou de début du suivi n’est pas valide. Vérifiez les champs « Date de contact d’origine » et « Début du suivi » en conservant les dates historiques exactes.',
 INVALID_BIRTH_DATE:'La date de naissance n’est pas valide. Vérifiez le champ « Naissance » et corrigez-le à partir d’un document fiable avant de valider.',
 IDENTITY_REQUIRED:'L’identité ou l’association au dossier n’est pas suffisamment renseignée. Vérifiez le prénom, le nom et le rattachement au dossier existant dans cette fiche.',
 INVALID_PROFESSIONAL:'Le professionnel sélectionné n’est pas disponible pour cette migration. Vérifiez le choix « Professionnel » ; la Direction doit contrôler son accès si le professionnel attendu ne peut pas être choisi.',
 MIGRATION_SERVICE_REQUIRED:'Aucun service n’est sélectionné pour préparer le mandat. Choisissez le service dans cette fiche, puis vérifiez le tarif avant de valider.',
 MIGRATION_SERVICE_FORBIDDEN:'Le service choisi n’est pas configuré pour ce professionnel. Vérifiez le professionnel et le service ; demandez à la Direction de vérifier ses paramètres si ce choix est bien le bon.',
 MANDATE_RATE_REQUIRED:'Aucun tarif de référence n’est disponible pour ce service à la date demandée. Vérifiez le service et le tarif de la fiche ; si ces renseignements sont exacts, la Direction doit contrôler le catalogue tarifaire.',
 MANDATE_INVALID_PAYER:'Un responsable des honoraires ne correspond pas aux personnes renseignées. Vérifiez les requérants, puis sélectionnez les bons responsables dans la même fiche.',
 MANDATE_PAYER_TOTAL:'Les parts des responsables des honoraires ne totalisent pas 100 %. Corrigez les champs « Part (%) » avant de valider.',
 MANDATE_INVALID_SIGNER:'Un signataire du mandat n’a pas pu être vérifié. Faites contrôler son identité et son rôle par la Direction avant de reprendre cette fiche.',
 MANDATE_SIGNER_RIGHTS_REQUIRED:'Le rôle ou le droit de signer d’une personne n’est pas confirmé. La Direction doit vérifier son autorité ; un simple requérant ne suffit pas à établir ce droit.',
 MANDATE_FICTIONAL_EMAIL_REQUIRED:'Une adresse du mandat ne correspond pas aux coordonnées enregistrées. Vérifiez les courriels du client et des requérants ; si tout est exact, demandez une vérification à la Direction.',
 MANDATE_INVALID_INPUT:'Les renseignements du mandat n’ont pas été acceptés. Vérifiez le service, le tarif et les responsables des honoraires ; si rien n’est signalé dans la fiche, faites contrôler le mandat par la Direction.',
 MANDATE_SUPERVISOR_SIGNATURE_REQUIRED:'La signature professionnelle de la superviseure doit être vérifiée. Demandez à la Direction de contrôler sa signature dans son profil avant de reprendre.',
 SUPERVISION_ACCESS_CHANGED:'Les accès de supervision ont changé. Vérifiez la superviseure choisie ; la Direction doit confirmer ses accès avant la validation.',
 SUPERVISION_ACCESS_REVOKED:'L’accès de la superviseure a été retiré. La Direction doit vérifier la supervision prévue avant de reprendre ; ne contournez pas ce refus en changeant de superviseure au hasard.',
 ASSIGNMENT_ENCOUNTER_EXISTS:'Cette prise en charge comporte déjà une rencontre et ne peut pas être classée « Service non pris ». Vérifiez le résultat réel du service avec la Direction avant de choisir son statut.',
 CLINICAL_FUTURE_APPOINTMENTS:'Des rendez-vous futurs empêchent l’archivage du suivi. Faites vérifier ces rendez-vous par la Direction avant de reprendre ; ils ne seront pas annulés automatiquement.',
 MIGRATION_MANDATE_SERVICE_CHANGED:'Le mandat existant concerne un autre service. Vérifiez le service de la fiche et le mandat déjà enregistré avec la Direction ; ce mandat sera conservé.',
 MIGRATION_MANDATE_PROFESSIONAL_CHANGED:'Le mandat existant concerne un autre professionnel. Vérifiez le professionnel de la fiche et le mandat avec la Direction ; ce mandat sera conservé.',
 MIGRATION_VALIDATED_CASE_REQUIRES_REVIEW:'Ce dossier a déjà été validé et le changement demandé nécessite une revue administrative. Ouvrez sa fiche avec la Direction ; ne recréez pas le client et ne déplacez pas seulement ses PDF.',
 SOURCE_ALREADY_IMPORTED_DIFFERENTLY:'Cette source a déjà été importée avec une autre association. Faites vérifier le dossier destinataire par la Direction avant de continuer ; ne recommencez pas l’import sous une nouvelle identité.',
 DOCUMENTS_REQUIRED:'Les documents originaux nécessaires à la reprise ne sont plus chargés. Redéposez les mêmes PDF dans cette préparation, puis vérifiez leur association aux fiches restantes.',
 ORIGINAL_WORKBOOK_REQUIRED:'Le fichier Excel original doit être disponible pour reprendre ce lot. Redéposez le même fichier dans la préparation, sans réimporter les dossiers déjà traités.',
 INVALID_DOCUMENT:'Un document n’a pas pu être validé. Vérifiez le PDF original et sa taille, puis redéposez ce fichier dans la préparation.',
 INVALID_DOCUMENTS:'Les documents de cette fiche n’ont pas pu être validés. Vérifiez les PDF rattachés et leurs tailles avant de reprendre.',
 INVALID_BATCH:'Le lot demandé n’est pas valide. Rouvrez le centre et le rapport du lot avant de reprendre les fiches restantes.',
 MIGRATION_NOT_FOUND:'Le lot n’est plus disponible dans cette sélection. Revenez à l’historique et vérifiez le rapport avec la personne qui l’a préparé.',
 MIGRATION_INDIVIDUAL_REQUIRED:'Ce lot doit être traité client par client. Revenez à « Vérifier les dossiers » et utilisez « Enregistrer et valider ce client » sur chaque fiche.',
 MIGRATION_READ_ONLY:'Votre accès à ce centre est en lecture seule. Vous pouvez consulter la préparation ; demandez à la Direction de vérifier votre autorisation avant un import.',
 MIGRATION_FORBIDDEN:'Votre compte ne permet pas cette opération de migration. Vérifiez le compte connecté et demandez à la Direction de contrôler l’accès au centre.',
 MIGRATION_REPORT_FORBIDDEN:'Le retrait de ce rapport est réservé au compte autorisé. Demandez à la Direction de vérifier cette demande ; aucun dossier client ne doit être supprimé pour retirer un rapport.',
 UNIFICATION_ORIGIN_REFUSED:'Cette adresse ne permet pas d’ouvrir le volet clinique. Ouvrez https://app.psychoeducaction.com et reconnectez-vous avec votre compte habituel.',
 IMPORT_FAILED_22023:'L’enregistrement a été refusé pendant la création du dossier ou du mandat, sans précision suffisante sur la règle concernée. Consultez le rapport et faites vérifier cette fiche par la Direction avant de reprendre.',
}

export function migrationFailureMessage(code:unknown,status?:number):string{
 if(typeof code==='string'&&Object.hasOwn(failures,code))return failures[code]
 if(status===401)return 'Votre session n’est plus valide. Reconnectez-vous sur l’adresse officielle, puis consultez le rapport du lot avant de reprendre.'
 if(status===403)return 'Votre compte ne permet pas cette opération. Vérifiez le compte connecté et demandez à la Direction de contrôler vos accès avant de reprendre.'
 if(status===413)return 'Le fichier ou le lot dépasse la taille acceptée. Réduisez le lot ou séparez les documents en conservant les originaux, puis vérifiez la préparation.'
 if(status===429)return 'Le service reçoit trop de demandes. Attendez un moment, puis vérifiez le rapport du lot avant de reprendre la même opération.'
 if(status&&status>=500)return 'Le service n’a pas pu confirmer l’opération. Vérifiez le rapport du lot avant de réessayer : le résultat peut rester incertain. Ne recréez pas le client pour contourner ce message.'
 return 'La cause précise du blocage n’a pas pu être identifiée. Conservez cette fiche à vérifier et consultez le rapport avec la Direction avant de reprendre. Ne recréez pas le client.'
}

/** UI wording only: the original field validations remain authoritative. */
export function migrationFieldHelp(message:string):string{
 const help:Record<string,string>={
  'professionnel requis':'Aucun professionnel n’est sélectionné. Choisissez le professionnel de cette fiche avant de valider.',
  'service requis pour créer le mandat':'Aucun service n’est sélectionné. Choisissez le service dans cette fiche pour préparer le mandat.',
  'identité manquante':'Le prénom ou le nom du client est manquant. Complétez les champs d’identité en haut de la fiche.',
  'association à confirmer':'L’association au dossier existant n’est pas confirmée. Vérifiez le client et le professionnel indiqués avant de valider.',
  'courriel invalide':'Une adresse courriel n’est pas valide. Vérifiez les coordonnées renseignées dans cette fiche et corrigez l’adresse erronée.',
  'naissance invalide':'La date de naissance n’est pas valide. Vérifiez le champ « Naissance » : la date doit être exacte et ne peut pas être future.',
  'identifiant source en double':'Plusieurs lignes portent le même identifiant dans le fichier. Faites corriger le doublon dans l’export avant de relancer son analyse.',
  'Tarif invalide.':'Le tarif n’est pas valide. Renseignez un montant positif dans le champ « Tarif horaire ($ CAD) » avant de valider.',
  'Un responsable est sélectionné plusieurs fois.':'Un responsable des honoraires est sélectionné plusieurs fois. Vérifiez les personnes et conservez une seule sélection par responsable.',
  'Vérifiez les courriels renseignés.':'Une adresse courriel n’est pas valide. Vérifiez les coordonnées du client et des requérants, puis corrigez les adresses erronées.',
 }
 return Object.hasOwn(help,message)?help[message]:message
}
