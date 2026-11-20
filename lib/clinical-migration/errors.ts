/** Fixed migration failures only; SQL text and submitted values never cross here. */
const messages: Record<string,string> = {
 MIGRATION_BIRTH_DATE_MISMATCH:'La date de naissance saisie diffère de celle du dossier sélectionné. Vérifiez et corrigez la date avant de valider. Aucune date n’a été remplacée.',
 PATIENT_CHANGED:'L’identité ou la version du dossier ne correspond plus à la fiche sélectionnée. Vérifiez le dossier existant avant de valider.',
 MIGRATION_CONFLICT:'Le lot a changé. Rouvrez son rapport pour reprendre les fiches restantes.',
 OPERATIONAL_ASSOCIATION_CHANGED:'L’assignation a changé. Vérifiez à nouveau le rattachement au dossier existant.',
 CASE_CHANGED:'Le suivi a changé. Vérifiez le suivi sélectionné avant de valider.',
 MIGRATION_SETTINGS_CHANGED:'Les paramètres du service ont changé. Réessayez pour charger leur version actuelle.',
 SUPERVISION_ACCESS_CHANGED:'Les accès de supervision ont changé. Une vérification est nécessaire.',
 MIGRATION_IDENTITY_CONFLICT:'Les informations d’identité se contredisent. Vérifiez le dossier existant avant de valider.',
}
export function migrationRpcFailure(value:unknown):{code:string;message:string;status:409}|null{
 if(!value||typeof value!=='object')return null
 const v=value as {code?:unknown;message?:unknown}
 const code=typeof v.code==='string'&&Object.hasOwn(messages,v.code)?v.code:['PT409','40001','22023'].includes(String(v.code))&&typeof v.message==='string'&&Object.hasOwn(messages,v.message)?v.message:null
 return code?{code,message:messages[code],status:409}:null
}
