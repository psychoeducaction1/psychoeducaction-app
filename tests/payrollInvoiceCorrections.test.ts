import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { calculatePayroll, type ProfessionalPayrollInfo } from '../lib/payrollCalculator.ts'
import { calculateProfessionalCompensation } from '../lib/professionalCompensation.ts'
import { decimalProduct, decimalSum, formatPayrollQuantity } from '../lib/payrollDecimal.ts'
import { generatePayrollInvoiceDocument, generatePayrollInvoiceDocumentFromData, toPayrollInvoiceData, buildPayrollInvoiceShortNumber } from '../lib/generatePayrollInvoiceDocx.ts'
import { payrollInvoiceSnapshot, validateInvoiceRevision } from '../lib/payrollInvoiceRegistry.ts'

const pro: ProfessionalPayrollInfo = { id: '00000000-0000-4000-8000-000000000001', fullName: 'Professionnel Fictif', email: 'pro@example.invalid',
  payrollCategory: 'psychoeducateur_membre_ordre', professionalTitle: 'Titre du profil fictif', professionalAddress: null, professionalPhone: null }
const header = ['DATE','PROFESSIONNEL','CLIENT','REQUERANT','DESCRIPTION','DETAIL','EMPLACEMENT','PAYE','MONTANT RECLAME','MANDAT']
const period = { startDate: '2026-10-05', endDate: '2026-10-18', dueDate: '2026-10-23' }
function row(amount: number, time = '09:00 - 10:00', description = 'Rencontre', date = '2026-10-06', p = pro) {
  return [`${date}\n${time}`,p.fullName,'DOSSIER-FICTIF-PRIVE','',description,'','','',amount,'']
}
async function textOf(document: ReturnType<typeof generatePayrollInvoiceDocument>) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document))
  return (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g,' ').replace(/&apos;/g,"'")
}

test('Rim : la référence 110/h est distincte du coefficient 110/180 et le total reste 1540', async () => {
  const rim = { ...pro, fullName: 'Rim El Bassit', email: 'fixture@example.invalid', payrollCategory: null }
  const compensation = calculateProfessionalCompensation({ professional: rim, lineType: 'rencontre', clientAmount: 180, durationHours: 1, weeklyMeetingCount: 0 })
  assert.equal(compensation.professionalHourlyRate, 110)
  assert.equal(compensation.professionalRate, 110/180)
  const result = calculatePayroll([header,...Array.from({ length:14 }, () => row(180,'09:00 - 10:00','Rencontre','2026-10-06',rim))],[rim],period).professionalResults[0]
  assert.equal(result.grandTotal,1540)
  assert.equal(toPayrollInvoiceData(result).lineItems[0].unitPay,110)
  const text = await textOf(generatePayrollInvoiceDocument(result,period,null))
  assert.match(text,/110,00/)
  assert.doesNotMatch(text,/0,61|DOSSIER-FICTIF/)
})

test('quantités nulles rémunérées : conserver 42 + 94,50 au calcul, provenance visible et émission bloquée', () => {
  const rows = [header,row(60,'17:30 - 17:30'),row(67.5,'12:45 - 12:45'),row(67.5,'17:00 - 17:00'),
    ...Array.from({ length:7 },()=>row(135))]
  const result=calculatePayroll(rows,[pro],period).professionalResults[0]
  const zero=result.lineItems.filter(i=>i.totalHours===0)
  assert.equal(decimalSum(zero.map(i=>i.totalPay)),136.5)
  assert.deepEqual(zero.flatMap(i=>i.sourceRows!),[2,3,4])
  assert.equal(result.invoiceIssues?.length,3)
  assert.throws(()=>toPayrollInvoiceData(result),/bloquée/)
  assert.throws(()=>generatePayrollInvoiceDocument(result,period,null),/bloquée/)
})

test('une minute ou une fraction positive ne devient jamais zéro; absence et téléphone ont leurs propres unités', () => {
  const result=calculatePayroll([header,row(1.35,'09:00 – 09:01'),row(60,'','Absence'),row(33.75,'09:00 - 09:15','Entretien téléphonique')],[pro],period).professionalResults[0]
  const data=toPayrollInvoiceData(result)
  assert.equal(data.lineItems[0].quantity,1/60)
  assert.equal(formatPayrollQuantity(1/60,'h'),'0,016667 h')
  assert.notEqual(formatPayrollQuantity(0.00000001),'0')
  assert.equal(data.lineItems[1].quantity,1)
  assert.equal(data.lineItems[1].unit,'élément')
  assert.equal(data.cancellationLineItems[0].count,1)
  for (const time of ['99:00 - 99:30','10:00 - 09:00','','09:00 - 09:00']) {
    assert.ok(calculatePayroll([header,row(60,time)],[pro],period).professionalResults[0].invoiceIssues?.length)
  }
})

test('une rencontre mentionnant une annulation exige confirmation sans changer automatiquement montant ou seuil',()=>{
  const ambiguous=row(135)
  ambiguous[5]='Frais d’annulation applicables sans préavis'
  const result=calculatePayroll([header,ambiguous,...Array.from({length:9},()=>row(135))],[pro],period).professionalResults[0]
  assert.equal(result.meetingCount,10)
  assert.equal(result.grandTotal,945)
  assert.match(result.invoiceIssues![0],/annulation/)
  assert.throws(()=>toPayrollInvoiceData(result),/bloquée/)
})

test('titre par profil : correction de titre seule, sans catégorie par défaut ni modification des montants',async()=>{
  const before=calculatePayroll([header,row(110),row(110)],[pro],period).professionalResults[0]
  const corrected={...pro,professionalTitle:'Intervenante B.Sc. Ps.éd'}
  const after=calculatePayroll([header,row(110),row(110)],[corrected],period).professionalResults[0]
  assert.equal(after.grandTotal,132)
  assert.equal(after.grandTotal,before.grandTotal)
  assert.equal(after.professional.payrollCategory,before.professional.payrollCategory)
  const text=await textOf(generatePayrollInvoiceDocument(after,period,null))
  assert.match(text,/Intervenante B.Sc. Ps.éd/)
  assert.doesNotMatch(text,/Psychoéducatrice/)
  assert.equal(toPayrollInvoiceData(before).professional.professionalTitle,'Titre du profil fictif')
})

test('décimaux exacts et arrondis au cent par activité, kilomètres source conservés',()=>{
  assert.equal(decimalProduct(1.005,1),1.01)
  assert.equal(decimalProduct(-1.005,1),-1.01)
  assert.equal(decimalProduct(44.63,0.64),28.56)
  assert.equal(decimalSum([0.1,0.2]),0.3)
  assert.equal(decimalSum([decimalProduct(33.75,.7),decimalProduct(33.75,.7)]),47.26)
  assert.throws(()=>decimalProduct(NaN,1),/non finie/)
})

test('snapshot immuable et rectificatif sans signature antérieure; référence comptable complète',async()=>{
  const result=calculatePayroll([header,row(135)],[pro],period).professionalResults[0]
  const snapshot=payrollInvoiceSnapshot(period,toPayrollInvoiceData(result))
  result.professional.professionalTitle='Autre titre ultérieur'
  result.lineItems[0].totalPay=0
  const record={id:pro.id,number:'PEA-AG-021',version:2,reason:'Correction du titre professionnel',snapshot}
  const text=await textOf(generatePayrollInvoiceDocumentFromData(snapshot.invoice,snapshot.period,null,{record}))
  assert.match(text,/Titre du profil fictif/)
  assert.match(text,/RECTIFICATIF NON SIGNÉ/)
  assert.doesNotMatch(text,/Autre titre ultérieur|signature-réelle/)
  assert.equal(buildPayrollInvoiceShortNumber('PEA-2026-000123'),'PEA-2026-000123')
  assert.throws(()=>validateInvoiceRevision('court',1),/motif/)
  assert.throws(()=>validateInvoiceRevision('Correction documentée',0),/version/)
  assert.throws(()=>generatePayrollInvoiceDocumentFromData({...snapshot.invoice,lineItems:[{...snapshot.invoice.lineItems[0],quantity:0}]},period,null),/bloquée/)
})

test('les vraies routes de factures contrôlent les droits et ignorent les montants et pièces jointes falsifiés',()=>{
  const result=spawnSync(process.execPath,['--import','./tests/register-aliases.mjs','--experimental-strip-types','tests/helpers/payrollInvoiceRoutes.mjs'],{encoding:'utf8',windowsHide:true,timeout:30000})
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})
