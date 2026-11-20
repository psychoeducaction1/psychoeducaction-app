import { isLocalClinicalRuntime } from '@/lib/clinical-local/runtime'

type DocumentResponseDiagnostic = {
 status:number
 type:'application/pdf'|'application/json'|'other'|'absent'
 length:number|null
 disposition:'attachment'|'inline'|'other'|'absent'
}
/** Metadata of a response already prepared by a human-triggered download.
 * Never reads the URL, cookie, body, PDF bytes, document ID or filename.
 * This does not establish that a browser received or saved the attachment.
 */
export function documentResponseDiagnostic(method:string,segments:readonly string[],response:Response,environment:Record<string,string|undefined>=process.env):DocumentResponseDiagnostic|null {
 if(environment.PEA_LAB_DOCUMENT_DIAGNOSTICS!=='1'||!isLocalClinicalRuntime(environment))return null
 const authenticated=method==='GET'&&segments.length===4&&segments[0]==='documents'&&segments[3]==='download'
 const portal=method==='POST'&&segments.length===2&&segments[0]==='portal'&&segments[1]==='download'
 if(!authenticated&&!portal)return null
 const type=response.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase()
 const disposition=response.headers.get('Content-Disposition')?.split(';',1)[0].trim().toLowerCase()
 const rawLength=response.headers.get('Content-Length')
 const length=rawLength&&/^\d{1,8}$/.test(rawLength)&&Number(rawLength)<=8*1024*1024?Number(rawLength):null
 return {status:response.status,type:type==='application/pdf'||type==='application/json'?type:type?'other':'absent',length,
  disposition:disposition==='attachment'||disposition==='inline'?disposition:disposition?'other':'absent'}
}
export function logDocumentResponseDiagnostic(method:string,segments:readonly string[],response:Response):void {
 const diagnostic=documentResponseDiagnostic(method,segments,response)
 if(diagnostic)try{console.info('PEA_LAB_DOCUMENT_RESPONSE',JSON.stringify(diagnostic))}catch{
  // Optional diagnostics must never interrupt the original response delivery.
 }
}
