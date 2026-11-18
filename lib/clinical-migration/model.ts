import { preparationFromSource, type MigrationPreparation, type MigrationRequester } from './preparation.ts'
import { extractMigrationIntake, type MigrationIntake } from './intake.ts'
import { identityFromPdf, encounterDatesFromPdf, serviceFromPdf } from '../clinical-real/legacyBatchMatch.ts'
export type MigrationPerson = {address?:string;consultationReason?:string;requesters?:MigrationRequester[];id:string;firstName:string;lastName:string;birthDate:string|null;email:string;phone:string;version:number;cases:{id:string;label:string;status:string;service?:string|null;professionalIds:string[]}[]}
export type MigrationOperationalPerson=MigrationPerson&{professionalId:string;fingerprint:string;status:string;service?:string|null}
export type MigrationDocument = {sha256:string;name:string;bytes:number;pages:number;kind:'notes'|'report'|'consent'|'mandate'|'financial'}
export type MigrationRow = {preparation?:MigrationPreparation;intake?:MigrationIntake;serviceSource?:'existing'|'professional'|'manual';professionalSource?:'existing'|'default'|'manual';supervisorId?:string|null;sourceKey:string;firstName:string;lastName:string;birthDate:string;email:string;phone:string;address:string;service:string;professionalId:string;decision:'create'|'link'|'operational'|'skip'|'';assignmentId?:string;assignmentFingerprint?:string;patientId:string;patientVersion:number;caseId:string;associationConfirmed:boolean;documents:MigrationDocument[];dates:string[];warnings:string[]}
export const fields=['sourceId','firstName','lastName','birthDate','email','phone','address','service'] as const
export type Mapping=Partial<Record<typeof fields[number],number>>
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')
/** Match complete labels, never "PRONOM", requester names or ambiguous MANDAT columns. */
export function detectMigrationColumns(rows:unknown[][]):{headerRow:number;headers:string[];mapping:Mapping;detected:boolean}{
 const aliases:Record<keyof Mapping,string[]>={sourceId:['identifiant','identifiantclient','numerodossier','idclient'],firstName:['prenom','prenomclient'],lastName:['nom','nomdefamille','nomclient'],birthDate:['datedenaissance','naissance'],email:['courriel','email','courrielclient'],phone:['telephone','telephoneclient','cellulaire'],address:['adresse','adressecomplete','adresseclient'],service:['service','servicedemande','typedeservice']}
 for(let headerRow=0;headerRow<Math.min(rows.length,30);headerRow++){
  const headers=(rows[headerRow]??[]).map(v=>String(v??'')),normalized=headers.map(fold),mapping:Mapping={}
  for(const field of fields){for(const alias of aliases[field]){const indices=normalized.flatMap((h,i)=>h===alias?[i]:[]);if(indices.length===1){mapping[field]=indices[0];break}}}
  if(mapping.firstName!==undefined&&mapping.lastName!==undefined)return{headerRow,headers,mapping,detected:true}
 }
 return{headerRow:0,headers:(rows[0]??[]).map(v=>String(v??'')),mapping:{},detected:false}
}
/** Only an unambiguous identity AND destination are preconfirmed. No import is executed. */
export function proposeMigrationAssociation(row:MigrationRow,people:MigrationPerson[],operational:MigrationOperationalPerson[]=[]):MigrationRow{
 if(row.decision==='skip')return row
 row={...row,patientId:'',patientVersion:0,caseId:'',assignmentId:undefined,assignmentFingerprint:undefined,associationConfirmed:false}
 const matches=migrationMatches(row,people).filter(m=>fold(m.person.firstName)===fold(row.firstName)&&fold(m.person.lastName)===fold(row.lastName))
 if(!matches.length){
  const assigned=migrationMatches(row,operational).filter(m=>fold(m.person.firstName)===fold(row.firstName)&&fold(m.person.lastName)===fold(row.lastName))
  if(!assigned.length)return{...row,decision:'create'}
  const found=assigned.length===1?assigned[0]:null
  if(found&&!found.conflict&&found.person.professionalId===row.professionalId&&found.person.status==='open')return{...row,decision:'operational',assignmentId:found.person.id,assignmentFingerprint:found.person.fingerprint,associationConfirmed:true}
  return{...row,decision:'operational'}
 }
 if(matches.length!==1||matches[0].conflict)return{...row,decision:'link',associationConfirmed:false}
 const p=matches[0].person,cases=p.cases.filter(c=>(c.status==='open'||['closed','not_taken'].includes(row.preparation?.outcome??'')&&c.status==='closed')&&c.professionalIds.includes(row.professionalId))
 return{...row,decision:'link',patientId:p.id,patientVersion:p.version,caseId:cases.length===1?cases[0].id:'',associationConfirmed:cases.length===1}
}
export type MigrationProfessionalService={professionalId:string;service:string;configured:boolean}
/** Fill known import metadata only; never create a destination or override a manual/file service. */
export function prefillMigrationRow(row:MigrationRow,people:MigrationPerson[],operational:MigrationOperationalPerson[]=[],services:MigrationProfessionalService[]=[],keepSelectedDestination=false):MigrationRow{
 if(row.decision==='skip')return row
 if(!row.professionalId&&!keepSelectedDestination){
  const exact=migrationMatches(row,people).filter(m=>fold(m.person.firstName)===fold(row.firstName)&&fold(m.person.lastName)===fold(row.lastName))
  const assigned=migrationMatches(row,operational).filter(m=>fold(m.person.firstName)===fold(row.firstName)&&fold(m.person.lastName)===fold(row.lastName))
  if(exact.length<=1&&assigned.length<=1&&![...exact,...assigned].some(m=>m.conflict)){
   const ids=[...new Set([...exact.flatMap(m=>m.person.cases.filter(c=>c.status==='open').flatMap(c=>c.professionalIds)),...assigned.filter(m=>m.person.status==='open').map(m=>m.person.professionalId)])]
   if(ids.length===1)row={...row,professionalId:ids[0],professionalSource:'existing'}
  }
 }
 if(!keepSelectedDestination)row=proposeMigrationAssociation(row,people,operational)
 if(row.serviceSource==='manual')return row
 if(row.service.trim()&&row.service!=='À préciser'&&!['existing','professional'].includes(row.serviceSource??''))return row
 const existing=(row.associationConfirmed||keepSelectedDestination)?(row.decision==='operational'?operational.find(p=>p.id===row.assignmentId&&p.professionalId===row.professionalId)?.service:people.find(p=>p.id===row.patientId)?.cases.find(c=>c.id===row.caseId&&c.status==='open'&&c.professionalIds.includes(row.professionalId))?.service):null
 if(existing&&existing!=='À préciser')return{...row,service:existing,serviceSource:'existing'}
 const options=services.filter(s=>s.professionalId===row.professionalId),configured=options.filter(s=>s.configured)
 const choices=[...new Set((configured.length?configured:options).map(s=>s.service))]
 return choices.length===1?{...row,service:choices[0],serviceSource:'professional'}:{...row,service:'À préciser',serviceSource:undefined}
}
export function migrationResolution(row:MigrationRow,people:MigrationPerson[],operational:MigrationOperationalPerson[]=[]):'existing'|'review'|'new'{
 const resolved=proposeMigrationAssociation({...row,decision:''},people,operational)
 return resolved.associationConfirmed?'existing':resolved.decision==='create'?'new':'review'
}
export function migrationExistingErrors(rows:MigrationRow[],people:MigrationPerson[],operational:MigrationOperationalPerson[]=[]):string[]{
 return rows.flatMap((row,i)=>{
  if(row.decision==='skip')return[]
  const sameName=migrationMatches(row,[...people,...operational]).filter(m=>fold(m.person.firstName)===fold(row.firstName)&&fold(m.person.lastName)===fold(row.lastName))
  if(row.decision==='create'&&sameName.length)return['Ligne '+(i+1)+' : un dossier porte déjà ce nom; vérifiez la correspondance ou ignorez cette ligne avant toute création.']
  const existing=people.find(p=>p.id===row.patientId)?.cases.filter(c=>c.status==='open'&&c.professionalIds.includes(row.professionalId))??[]
  if(row.decision==='link'&&existing.length&&!existing.some(c=>c.id===row.caseId))return['Ligne '+(i+1)+' : sélectionnez le suivi existant du professionnel pour éviter un doublon.']
  return[]
 })
}
export function migrationDate(value:unknown):string {
 if(value===null||value===undefined||value==='')return ''
 if(value instanceof Date){if(Number.isNaN(value.getTime()))throw Error('Date invalide');return value.toISOString().slice(0,10)}
 const text=String(value).trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||new Date(text+'T12:00Z').toISOString().slice(0,10)!==text)throw Error('Date attendue : AAAA-MM-JJ')
 return text
}
export function migrationMatches<T extends MigrationPerson>(row:Pick<MigrationRow,'firstName'|'lastName'|'birthDate'|'email'|'phone'>,people:T[]) {
 return people.filter(p=>{
  const sameName=fold(p.firstName)===fold(row.firstName)&&fold(p.lastName)===fold(row.lastName)
  const sameEmail=Boolean(row.email&&p.email&&row.email.toLowerCase()===p.email.toLowerCase())
  const samePhone=Boolean(row.phone&&p.phone&&row.phone.replace(/\D/g,'').length>=7&&row.phone.replace(/\D/g,'')===p.phone.replace(/\D/g,''))
  return sameName||sameEmail||samePhone
 }).map(person=>({person,conflict:Boolean(row.birthDate&&person.birthDate&&row.birthDate!==person.birthDate),strong:Boolean(row.birthDate&&person.birthDate===row.birthDate&&fold(row.firstName)===fold(person.firstName)&&fold(row.lastName)===fold(person.lastName))}))
}
export function emptyMigrationRow(sourceKey:string):MigrationRow{return {sourceKey,firstName:'',lastName:'',birthDate:'',email:'',phone:'',address:'',service:'À préciser',professionalId:'',decision:'',patientId:'',patientVersion:0,caseId:'',associationConfirmed:false,documents:[],dates:[],warnings:[]}}
export function spreadsheetMigrationRows(rows:unknown[][],mapping:Mapping,namespace:string,headers:string[]=[]):MigrationRow[]{
 return rows.filter(r=>r.some(v=>v!==null&&v!==undefined&&String(v).trim()!=='')).map((cells,index)=>{
 const row=emptyMigrationRow(namespace+':row:'+index)
 row.intake=extractMigrationIntake(headers,cells)
 for(const field of fields){const col=mapping[field];if(col===undefined)continue;const value=cells[col];if(field==='sourceId'){if(value!==null&&value!==undefined&&String(value).trim())row.sourceKey=namespace+':id:'+String(value).trim().toLowerCase().replace(/[^a-z0-9-]/g,'-');continue}
 try{row[field]=field==='birthDate'?migrationDate(value):String(value??'').trim()}catch{row.warnings.push('Date de naissance invalide; corrigez-la.')}
 }
 row.preparation=preparationFromSource(row,headers,cells)
 row.email=row.email.split(/[;,\n]+/)[0].trim();row.phone=row.phone.split(/[;\n]+/)[0].trim()
 if(!row.firstName||!row.lastName)row.warnings.push('Prénom et nom requis.')
 return row
 })
}
export function pdfMigrationRow(name:string,pages:string[],sha256:string,bytes:number):MigrationRow{
 const identity=identityFromPdf(name,pages),row=emptyMigrationRow('pdf:'+sha256)
 if(identity){row.firstName=identity.firstName;row.lastName=identity.lastName;row.birthDate=identity.birthDate??''}
 else row.warnings.push('Identité à préciser.')
 const identities=pages.map(page=>identityFromPdf('',[page])).filter(x=>x!==null)
 if(new Set(identities.map(x=>fold(x.firstName+x.lastName))).size>1)row.warnings.push('Plusieurs identités repérées : association à vérifier.')
 row.service=serviceFromPdf(pages)
 row.documents=[{sha256,name,bytes,pages:pages.length,kind:'notes'}];row.dates=encounterDatesFromPdf(pages);return row
}
export function migrationErrors(rows:MigrationRow[]):string[]{
 const errors:string[]=[],keys=new Set<string>()
 for(const [index,row]of rows.entries()){
  const at='Ligne '+(index+1)+' : '
  if(keys.has(row.sourceKey))errors.push(at+'identifiant source en double');keys.add(row.sourceKey)
  if(row.decision==='skip')continue
  if(row.documents.reduce((sum,d)=>sum+d.bytes,0)>5_242_880)errors.push(at+'les documents de cette ligne dépassent5Mo; séparez-les en plusieurs lots')
  if(!row.decision)errors.push(at+'choisir créer, associer ou ignorer')
  if(!row.firstName||!row.lastName)errors.push(at+'identité manquante')
  if(!row.professionalId)errors.push(at+'professionnel requis')
  if(!row.service.trim()||row.service==='À préciser')errors.push(at+'service requis pour créer le mandat')
  if(row.supervisorId&&row.supervisorId===row.professionalId)errors.push(at+'le superviseur doit être différent du professionnel')
  if((row.decision==='link'||row.decision==='operational')&&(!(row.decision==='operational'?row.assignmentId:row.patientId)||!row.associationConfirmed))errors.push(at+'association à confirmer')
  if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))errors.push(at+'courriel invalide')
  try{if(row.birthDate&&(migrationDate(row.birthDate)<'1900-01-01'||row.birthDate>new Date().toISOString().slice(0,10)))throw Error()}catch{errors.push(at+'naissance invalide')}
 }
 return errors
}

export function validateMigrationFiles(files:{name:string;size:number}[]):void {
 if(files.length>20)throw Error('Maximum 20 fichiers par lot.')
 if(files.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('Le lot dépasse 50 Mo. Utilisez plusieurs lots.')
 for(const file of files){const limit=/\.xlsx$/i.test(file.name)?10*1024*1024:/\.pdf$/i.test(file.name)?5*1024*1024:0
 if(!limit||!Number.isSafeInteger(file.size)||file.size<=0||file.size>limit)throw Error('Formats acceptés : Excel .xlsx (10 Mo maximum), PDF (5 Mo maximum).')
 }
}
