/** One durable original workbook per batch. Failures remain retryable. */
export function createMigrationWorkbookStager(){
 const staged=new Map<string,Promise<void>>()
 return async(batchId:string,sha256:string,upload:()=>Promise<void>,finish:()=>Promise<unknown>):Promise<void>=>{
  const key=batchId+'/'+sha256
  let task=staged.get(key)
  if(!task){task=(async()=>{await upload();await finish()})();staged.set(key,task)}
  try{await task}catch(error){if(staged.get(key)===task)staged.delete(key);throw error}
 }
}
type Receipt={items:{source_key:string;status:string;payload:unknown}[]}
function matchesSubmitted(expected:unknown,actual:unknown):boolean{
 if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((item,index)=>matchesSubmitted(item,actual[index]))
 if(expected&&typeof expected==='object')return Boolean(actual&&typeof actual==='object'&&!Array.isArray(actual)&&Object.entries(expected).filter(([,value])=>value!==undefined).every(([key,value])=>Object.hasOwn(actual,key)&&matchesSubmitted(value,(actual as Record<string,unknown>)[key])))
 return expected===actual
}
const status=(error:unknown)=>error&&typeof error==='object'&&'status' in error?Number(error.status):0
/** A lost response permits one receipt read, never a second write. */
export async function saveMigrationWithReceipt<T extends Receipt>(save:()=>Promise<T>,read:()=>Promise<T>,sourceKey:string,payload:unknown):Promise<T>{
 try{const result=await save();if(!result||!Array.isArray(result.items))throw new Error('MIGRATION_RECEIPT_INVALID');return result}catch(error){
  const code=status(error)
  if(code>=400&&code<500&&code!==408&&code!==429)throw error
  try{
   const receipt=await read(),item=receipt.items.find(item=>item.source_key===sourceKey)
   if(item?.status==='imported'&&matchesSubmitted(payload,item.payload))return receipt
  }catch(readError){if([401,403].includes(status(readError)))throw readError}
  throw new Error('La confirmation de cet enregistrement n’a pas pu être vérifiée. Consultez le rapport du lot avant de réessayer ; aucun nouvel import n’a été lancé automatiquement.')
 }
}
