import {randomUUID} from 'node:crypto'
import {isLocalClinicalRuntime,readLocalClinicalRuntime,type DurableClinicalRuntime} from '@/lib/clinical-local/runtime'
import {localRpc} from '@/lib/clinical-local/http'
import {isDurableBillingAck} from '@/lib/clinical-finance/transport'
type WorkerState={running:boolean;timer:ReturnType<typeof setInterval>|null;lastSucceededAt:string|null;lastFailedAt:string|null;failureReported:boolean}
const marker=Symbol.for('pea.clinical.local.billing.worker.v1')
const scope=globalThis as typeof globalThis & {[marker]?:WorkerState}
/** Prepares elapsed fictional encounters. SQL grants this operation solely to service_role. */
export async function runLocalBillingPreparation(runtime:DurableClinicalRuntime):Promise<boolean>{
 const ack=await localRpc<unknown>(runtime,runtime.serviceRoleKey,'lab_billing_batch_service',{p_key:randomUUID()})
 if(!isDurableBillingAck(ack,'batch.prepare'))throw new Error('LOCAL_BILLING_BATCH_UNCONFIRMED')
 return true
}
export async function runLocalCalendarCompletion(runtime:DurableClinicalRuntime):Promise<number>{
 const result=await localRpc<unknown>(runtime,runtime.serviceRoleKey,'lab_calendar_complete_elapsed_service')
 if(!result||typeof result!=='object'||typeof (result as {completed?:unknown}).completed!=='number')throw new Error('LOCAL_CALENDAR_COMPLETION_UNCONFIRMED')
 return (result as {completed:number}).completed
}
/** Materialize only elapsed encounters; a future slot never enters the invoice list. */
export async function prepareElapsedBilling(runtime:DurableClinicalRuntime):Promise<number>{
 const completed=await runLocalCalendarCompletion(runtime)
 if(completed>0)await runLocalBillingPreparation(runtime)
 return completed
}
export function startLocalBillingWorker():boolean{
 if(!isLocalClinicalRuntime()||process.env.PEA_CLINICAL_BILLING_WORKER==='off'||process.env.NEXT_PHASE==='phase-production-build')return false
 if(scope[marker])return true
 const runtime=readLocalClinicalRuntime()
 const state:WorkerState={running:false,timer:null,lastSucceededAt:null,lastFailedAt:null,failureReported:false};scope[marker]=state
 const tick=async()=>{
  if(state.running)return
  state.running=true
  try{await runLocalCalendarCompletion(runtime);await runLocalBillingPreparation(runtime);state.lastSucceededAt=new Date().toISOString();state.failureReported=false}
  catch{state.lastFailedAt=new Date().toISOString();if(!state.failureReported){console.warn('LOCAL_FICTIONAL_BILLING_PREPARATION_UNAVAILABLE');state.failureReported=true}}
  finally{state.running=false}
 }
 state.timer=setInterval(()=>void tick(),60_000);state.timer.unref();void tick()
 return true
}
