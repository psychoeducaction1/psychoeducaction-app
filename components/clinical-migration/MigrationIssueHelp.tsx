'use client'
import {buttonClass} from '@/components/Ui'
import {migrationBirthDateConflict,migrationClosedOperationalAssignment,migrationSelectedPerson,type MigrationRow,type MigrationPerson,type MigrationOperationalPerson} from '@/lib/clinical-migration/model'

const dateLabel=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):'Non renseignée'

export function MigrationIssueHelp({row,people,operational,birthFieldId,busy,onRefresh,onNext}:{
 row:MigrationRow;people:MigrationPerson[];operational:MigrationOperationalPerson[];birthFieldId:string;busy:boolean;onRefresh:()=>void;onNext?:()=>void
}){
 const birthConflict=migrationBirthDateConflict(row,people,operational)
 const selected=migrationSelectedPerson(row,people,operational)
 const closed=migrationClosedOperationalAssignment(row,operational)
 const sourceName=row.sourceKey.startsWith('pdf:')?'le PDF':'l’Excel'
 if(!birthConflict&&!closed)return null
 return <section role="alert" aria-label="Pourquoi ce dossier reste à vérifier" className="grid gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
  {closed&&<div className="grid gap-2"><h4 className="font-semibold">L’ancienne assignation est fermée</h4>
   <p>La Direction doit décider si ce dossier doit être repris comme archive ou faire l’objet d’un nouveau suivi si la prise en charge a recommencé.</p>
   <p>Cette décision doit être vérifiée avant l’import. Changer seulement le « Résultat du service » ne suffit pas à débloquer cette ancienne assignation.</p>
   <p>En attendant, passez au dossier suivant : cette fiche restera à vérifier et ses renseignements seront conservés dans la préparation.</p>
   {onNext&&<div><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onNext}>Passer au dossier suivant</button></div>}
  </div>}
  {birthConflict&&selected?.birthDate&&<div className="grid gap-2"><h4 className="font-semibold">La date de naissance diffère entre {sourceName} et le dossier existant</h4>
   <dl className="grid gap-2 sm:grid-cols-2"><div><dt>Date saisie dans cette fiche</dt><dd className="font-semibold">{dateLabel(row.birthDate)}</dd></div><div><dt>Date du dossier existant</dt><dd className="font-semibold">{dateLabel(selected.birthDate)}</dd></div></dl>
   <ol className="list-decimal space-y-1 pl-5"><li>Vérifiez la bonne date à partir d’un document fiable et assurez-vous qu’il s’agit du même client.</li><li>Si la date saisie est erronée, corrigez le champ « Naissance » en haut de cette fiche. Si c’est le dossier existant qui est erroné, demandez sa correction à la Direction.</li><li>Après correction, actualisez les correspondances, vérifiez l’association, puis cliquez sur « Enregistrer et valider ce client ».</li></ol>
   <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={()=>{const field=document.getElementById(birthFieldId);field?.focus();field?.scrollIntoView({block:'center',behavior:'smooth'})}}>Vérifier le champ Naissance</button><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onRefresh}>Actualiser les correspondances</button></div>
  </div>}
 </section>
}
