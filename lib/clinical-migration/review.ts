import {migrationErrors,migrationExistingErrors,type MigrationRow,type MigrationPerson,type MigrationOperationalPerson} from './model.ts'
import {normalizeMigrationRequesters,preparationFromSource,preparationErrors} from './preparation.ts'
import {migrationFieldHelp} from './helpMessages.ts'
export type MigrationReviewEntry={key:string;row:MigrationRow;index:number;issues:string[];state:'ready'|'blocked'|'skipped'}
export function migrationReviewIssues(row:MigrationRow,people:MigrationPerson[],operational:MigrationOperationalPerson[]=[]):string[]{
 if(row.decision==='skip')return[]
 const p=normalizeMigrationRequesters(row,row.preparation??preparationFromSource(row))
 const existing=migrationExistingErrors([row],people,operational)
 const general=migrationErrors([row]).filter(message=>!existing.length||message!=='Ligne 1 : association à confirmer')
 return [...new Set([...general,...existing,...preparationErrors(p)].map(message=>migrationFieldHelp(message.replace(/^Ligne 1 : /,''))))]
}
export function migrationReviewQueue(entries:{row:MigrationRow;index:number}[],people:MigrationPerson[],operational:MigrationOperationalPerson[]=[],availableDocuments?:ReadonlySet<string>):MigrationReviewEntry[]{
 const frequencies=new Map<string,number>();for(const entry of entries)frequencies.set(entry.row.sourceKey,(frequencies.get(entry.row.sourceKey)??0)+1)
 return entries.map(entry=>{const issues=migrationReviewIssues(entry.row,people,operational);if(entry.row.decision!=='skip'&&availableDocuments&&entry.row.documents.some(document=>!availableDocuments.has(document.sha256)))issues.push('Redéposez les PDF originaux de ce dossier avant de l’enregistrer.');if((frequencies.get(entry.row.sourceKey)??0)>1)issues.push('Le fichier contient plusieurs lignes avec le même identifiant. Vérifiez le fichier avant de valider.')
 return{...entry,key:migrationReviewKey(entry.index,entry.row.sourceKey),issues,state:entry.row.decision==='skip'?'skipped':issues.length?'blocked':'ready'}})
}
export function filterMigrationReviewQueue(entries:MigrationReviewEntry[],search:string,filter:'all'|'blocked'|'skipped'='all'):MigrationReviewEntry[]{
 const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
 const words=fold(search).split(/\s+/).filter(Boolean)
 return entries.filter(entry=>(filter==='all'?entry.state!=='skipped':filter==='blocked'?entry.state==='blocked':entry.state==='skipped')&&words.every(word=>fold(entry.row.firstName+' '+entry.row.lastName).includes(word)))
}
/** Never move a new document into a row already hidden as imported. */
export function attachMigrationDocuments(rows:MigrationRow[],sourceIndex:number,targetIndex:number,eligibleIndices:number[]):MigrationRow[]{
 if(sourceIndex===targetIndex||!rows[sourceIndex]||!rows[targetIndex]||!eligibleIndices.includes(sourceIndex)||!eligibleIndices.includes(targetIndex)||rows[targetIndex].decision==='skip')return rows
 const seen=new Set<string>()
 const source=rows[sourceIndex], target=rows[targetIndex]
 const documents=[...target.documents,...source.documents].filter(document=>{if(seen.has(document.sha256))return false;seen.add(document.sha256);return true})
 const normalized=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').trim().toLowerCase()
 const sameIdentity=Boolean(source.birthDate&&source.birthDate===target.birthDate&&
  source.firstName&&source.lastName&&normalized(source.firstName)===normalized(target.firstName)&&normalized(source.lastName)===normalized(target.lastName))
 const pdfReason=source.sourceKey.startsWith('pdf:')&&sameIdentity?source.intake?.consultationReason:''
 const existingReason=target.preparation?.consultationReason??target.intake?.consultationReason
 const warnings=[...target.warnings]
 if(pdfReason&&existingReason&&pdfReason!==existingReason)warnings.push('Le PDF et la fiche indiquent des motifs différents. Vérifiez le motif avant de valider.')
 const prepared={...target,documents,dates:[...new Set([...target.dates,...source.dates])],warnings:[...new Set(warnings)]}
 if(pdfReason&&!existingReason&&source.intake){
  prepared.intake={...(target.intake??source.intake),consultationReason:pdfReason}
  if(prepared.preparation)prepared.preparation={...prepared.preparation,consultationReason:pdfReason}
  prepared.warnings.push('Motif repéré dans le PDF source. Vérifiez-le avant de valider.')
 }
 return rows.flatMap((row,index)=>index===sourceIndex?[]:[index===targetIndex?prepared:row])
}

export function migrationReviewKey(index:number,sourceKey:string):string{return index+':'+sourceKey}
/** Keep an edited client visible until save/navigation, even after fixing its last issue. */
export function visibleMigrationReviewQueue(entries:MigrationReviewEntry[],search:string,filter:'all'|'blocked'|'skipped',selectedKey:string):MigrationReviewEntry[]{
 const filtered=filterMigrationReviewQueue(entries,search,filter)
 const pinned=entries.find(entry=>entry.key===selectedKey&&entry.state!=='skipped')
 return pinned&&!filtered.includes(pinned)?[pinned,...filtered]:filtered
}
