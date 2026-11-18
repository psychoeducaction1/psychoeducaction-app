import {migrationErrors,migrationExistingErrors,type MigrationRow,type MigrationPerson,type MigrationOperationalPerson} from './model.ts'
import {normalizeMigrationRequesters,preparationFromSource,preparationErrors} from './preparation.ts'
export type MigrationReviewEntry={key:string;row:MigrationRow;index:number;issues:string[];state:'ready'|'blocked'|'skipped'}
export function migrationReviewIssues(row:MigrationRow,people:MigrationPerson[],operational:MigrationOperationalPerson[]=[]):string[]{
 if(row.decision==='skip')return[]
 const p=normalizeMigrationRequesters(row,row.preparation??preparationFromSource(row))
 return [...new Set([...migrationErrors([row]),...migrationExistingErrors([row],people,operational),...preparationErrors(p)].map(message=>message.replace(/^Ligne 1 : /,'')))]
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
 const documents=[...rows[targetIndex].documents,...rows[sourceIndex].documents].filter(document=>{if(seen.has(document.sha256))return false;seen.add(document.sha256);return true})
 return rows.flatMap((row,index)=>index===sourceIndex?[]:[index===targetIndex?{...row,documents,dates:[...new Set([...row.dates,...rows[sourceIndex].dates])]}:row])
}

export function migrationReviewKey(index:number,sourceKey:string):string{return index+':'+sourceKey}
/** Keep an edited client visible until save/navigation, even after fixing its last issue. */
export function visibleMigrationReviewQueue(entries:MigrationReviewEntry[],search:string,filter:'all'|'blocked'|'skipped',selectedKey:string):MigrationReviewEntry[]{
 const filtered=filterMigrationReviewQueue(entries,search,filter)
 const pinned=entries.find(entry=>entry.key===selectedKey&&entry.state!=='skipped')
 return pinned&&!filtered.includes(pinned)?[pinned,...filtered]:filtered
}
