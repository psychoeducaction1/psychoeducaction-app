export const MIGRATION_PART_BYTES = 262144
type Send = (body: unknown) => Promise<unknown>
function encode(bytes: Uint8Array) { let text=''; for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text) }
export async function uploadMigrationFile(batchId:string,sha256:string,bytes:Uint8Array,send:Send,stopped=()=>false) {
 if(!/^[a-f0-9]{64}$/.test(sha256)||!bytes.length||bytes.length>10485760)throw Error('Fichier invalide.')
 for(let offset=0;offset<bytes.length;offset+=MIGRATION_PART_BYTES){
  if(stopped())throw Error('Transfert interrompu. Reprenez le lot avec les mêmes fichiers.')
  await send({action:'upload.chunk',batchId,data:{sha256,part:offset/MIGRATION_PART_BYTES,base64:encode(bytes.subarray(offset,offset+MIGRATION_PART_BYTES))}})
 }
}
export type MigrationFilePart={name:string;sha256:string;size:number;part:number;base64:string}
export async function downloadMigrationFile(sha:string,read:(part:number)=>Promise<MigrationFilePart>){
 const first=await read(0)
 if(first.sha256!==sha||!Number.isInteger(first.size)||first.size<1||first.size>10485760)throw Error('Archive invalide.')
 const bytes=new Uint8Array(first.size)
 for(let part=0;part<Math.ceil(first.size/MIGRATION_PART_BYTES);part++){
  const data=part===0?first:await read(part)
  if(data.sha256!==sha||data.size!==first.size||data.part!==part||data.name!==first.name||data.base64.length>360000)throw Error('Archive incohérente.')
  const chunk=Uint8Array.from(atob(data.base64.replace(/\s/g,'')),c=>c.charCodeAt(0))
  if(chunk.length!==Math.min(MIGRATION_PART_BYTES,first.size-part*MIGRATION_PART_BYTES))throw Error('Archive incomplète.')
  bytes.set(chunk,part*MIGRATION_PART_BYTES)
 }
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')
 if(actual!==sha)throw Error('L’empreinte de l’archive ne correspond pas.')
 return {name:first.name,bytes}
}
