import { createHash } from 'node:crypto'
import { readBoundedJsonObject } from '../boundedJsonBody.ts'
import { realInvoiceEmailConfiguration, sendRealInvoiceEmail } from '../clinical-real/invoiceEmail.ts'
import type { InvoiceDeliveryList } from '../clinical-finance/manualDelivery.ts'
import { renderInvoiceEmail, type InvoiceEmailTemplate } from '../clinical-finance/invoiceEmailTemplate.ts'

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>
type Dependencies = { rpc: Rpc; configured?: (recipient: string) => unknown; send?: typeof sendRealInvoiceEmail; template?: () => Promise<InvoiceEmailTemplate> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (body: unknown, status = 200) => Response.json(body, {status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
/** Caller has already validated Auth, controlled activation and administrative context. */
export async function handleManualInvoiceDelivery(request: Request, segments: string[], deps: Dependencies): Promise<Response> {
 const configured = deps.configured ?? realInvoiceEmailConfiguration
 if (segments.join('/') === 'delivery/preview' && request.method === 'GET') {
  const query = new URL(request.url).searchParams
  const invoiceId = query.get('invoiceId'), yesterday = query.get('scope') === 'yesterday'
  if (query.size!==1 || !(invoiceId && uuid.test(invoiceId) || yesterday)) return reply({error:'Choisissez une facture ou les factures de la veille.'},400)
  const value = await deps.rpc('clinical_manual_invoice_preview',{p_invoice_id:invoiceId,p_yesterday:yesterday}) as Omit<InvoiceDeliveryList,'enabled'>
  if (!value || !Array.isArray(value.invoices)) return reply({error:'Aperçu indisponible.'},502)
  let enabled = true
  try { configured(value.invoices.find(i=>!i.blockedReason)?.recipient || 'check@example.invalid') } catch { enabled = false }
  return reply({...value,enabled})
 }
 if (segments.join('/') !== 'delivery/send' || request.method !== 'POST') return reply({error:'Ressource introuvable.'},404)
 if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return reply({error:'Demande invalide.'},400)
 const b = await readBoundedJsonObject(request,4096)
 if (Object.keys(b).sort().join(',')!=='confirmed,digest,expectedVersion,invoiceId,key' || b.confirmed!==true || typeof b.invoiceId!=='string' || !uuid.test(b.invoiceId) || typeof b.key!=='string' || !uuid.test(b.key) || typeof b.digest!=='string' || !/^[a-f0-9]{64}$/.test(b.digest) || typeof b.expectedVersion!=='number' || !Number.isInteger(b.expectedVersion) || b.expectedVersion<1) return reply({error:'Confirmez la facture à envoyer.'},400)
 const preview = await deps.rpc('clinical_manual_invoice_preview',{p_invoice_id:b.invoiceId,p_yesterday:false}) as Omit<InvoiceDeliveryList,'enabled'>
 const candidate = preview.invoices.find(i=>i.id===b.invoiceId)
 if (!candidate) return reply({error:'Facture introuvable.'},404)
 // Check delivery activation before any close, numbering, PDF archive or claim.
 try { configured(candidate.recipient) } catch { return reply({code:'EMAIL_DISABLED',error:'Les envois de factures ne sont pas encore activés.'},503) }
 const template = await deps.template?.()
 const emailValues = {
  nom_client: candidate.clientName, nom_payeur: candidate.payerName,
  dates_prestations: candidate.serviceDates.map(day => new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'America/Toronto' }).format(new Date(day + 'T12:00:00Z'))).join(', '),
  montant_total: new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(candidate.totalCents / 100),
 }
 if (template) renderInvoiceEmail(template, 1, emailValues)
 let claim: {canSend:boolean;status:string;id?:string;number?:number;recipient?:string;sha256?:string;base64?:string}
 try { claim = await deps.rpc('clinical_manual_invoice_send_claim',{p_invoice_id:b.invoiceId,p_expected_version:b.expectedVersion,p_digest:b.digest,p_key:b.key}) as typeof claim }
 catch (cause) {
  if (cause && typeof cause==='object' && 'code' in cause && cause.code==='40001') return reply({code:'INVOICE_REVIEW_REQUIRED',error:'Vérifiez de nouveau la facture : son montant, son destinataire ou son état a changé. Aucun envoi lancé.'},409)
  throw cause
 }
 if (!claim.canSend) return claim.status==='sent' ? reply({sent:true,alreadySent:true}) : reply({code:'SEND_REVIEW_REQUIRED',error:'Cet envoi est en cours ou doit être vérifié. Aucun second envoi lancé.'},409)
 let provider: {id:string}
 try {
  const document = await deps.rpc('clinical_billing_document',{p_invoice_id:b.invoiceId,p_kind:'invoice'}) as {base64?:string;sha256?:string}
  if (!document || document.sha256!==claim.sha256) throw new Error('DOCUMENT_INVALID')
  claim.base64=document.base64
  if (claim.id!==b.invoiceId || !claim.base64 || !claim.recipient || !claim.sha256 || !Number.isInteger(claim.number) || createHash('sha256').update(Buffer.from(claim.base64,'base64')).digest('hex')!==claim.sha256) throw new Error('DOCUMENT_INVALID')
  const renderedMessage = template ? renderInvoiceEmail(template, claim.number!, emailValues) : undefined
  provider = await (deps.send ?? sendRealInvoiceEmail)({to:claim.recipient,number:claim.number!,pdfBase64:claim.base64,invoiceId:b.invoiceId,...(renderedMessage ? { renderedMessage } : {})})
 } catch (cause) {
  const status = cause instanceof Error && cause.message==='REAL_INVOICE_PROVIDER_REJECTED'?'failed':'uncertain'
  try { await deps.rpc('clinical_manual_invoice_send_finish',{p_invoice_id:b.invoiceId,p_key:b.key,p_status:status,p_provider_id:null}) } catch { /* A pending claim also prevents duplicate delivery. */ }
  return reply({code:'SEND_UNCONFIRMED',error:'L’envoi n’a pas été confirmé. Vérifiez son état avant de reprendre.'},502)
 }
 try { await deps.rpc('clinical_manual_invoice_send_finish',{p_invoice_id:b.invoiceId,p_key:b.key,p_status:'sent',p_provider_id:provider.id}) }
 catch { return reply({code:'SEND_REVIEW_REQUIRED',error:'La confirmation de l’envoi doit être vérifiée. Ne renvoyez pas cette facture.'},502) }
 return reply({sent:true})
}
