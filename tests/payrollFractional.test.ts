import { Packer } from 'docx'
import JSZip from 'jszip'
import { generatePayrollInvoiceDocument } from '../lib/generatePayrollInvoiceDocx.ts'
import { formatPayrollQuantity } from '../lib/payrollDecimal.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { activityHourlyRate, correctActivityTimes } from '../lib/payrollActivityCorrection.ts'
import { calculatePayroll, type ProfessionalPayrollInfo } from '../lib/payrollCalculator.ts'
import { toPayrollInvoiceData } from '../lib/generatePayrollInvoiceDocx.ts'
const pro: ProfessionalPayrollInfo = { id:'fixture', fullName:'Professionnelle fictive', email:'fixture@example.invalid', payrollCategory:'psychoeducateur_membre_ordre', professionalTitle:null, professionalAddress:null, professionalPhone:null }
const header=['DATE','PROFESSIONNEL','CLIENT','REQUERANT','DESCRIPTION','DETAIL','EMPLACEMENT','PAYE','MONTANT RECLAME','MANDAT']
const row=(amount:number,time:string)=>[`2026-11-02\n${time}`,pro.fullName,'','','Rencontre','','','',amount,'']
test('deux rencontres complètes et 40 minutes : tarif 100, quantité 2,666667 et trois rendez-vous',()=>{
  const result=calculatePayroll([header,row(100,'09:00 - 10:00'),row(100,'10:00 - 11:00'),row(66.67,'13:00 - 13:40')],[pro]).professionalResults[0]
  assert.equal(result.meetingCount,3);assert.equal(result.lineItems.length,1)
  assert.ok(Math.abs(result.lineItems[0].totalHours-8/3)<1e-9)
  assert.equal(result.lineItems[0].label,'Rencontre (100 $)')
  assert.equal(toPayrollInvoiceData(result).lineItems[0].label,'Rencontre (100 $)')
  assert.equal(result.grandTotal,160)
})
test('tarifs inférés avec arrondi au cent, sans liste de tarifs imposée',()=>{
  assert.equal(activityHourlyRate(66.67,40/60),100)
  assert.equal(activityHourlyRate(58.33,35/60),100)
  assert.equal(activityHourlyRate(78.75,35/60),135)
  assert.equal(activityHourlyRate(137.91,1),137.91)
})
test('corriger un horaire manquant conserve date, montant et fichier initial; émission permise après recalcul',()=>{
  const rows=[header,row(78.75,'13:00 - 13:00')]
  assert.throws(()=>toPayrollInvoiceData(calculatePayroll(rows,[pro]).professionalResults[0]),/bloquée/)
  const corrected=correctActivityTimes(rows,[{sourceRow:2,startTime:'13:00',endTime:'13:35'}])
  assert.equal(rows[1][0],'2026-11-02\n13:00 - 13:00');assert.equal(corrected[1][8],78.75)
  const invoice=toPayrollInvoiceData(calculatePayroll(corrected,[pro]).professionalResults[0])
  assert.equal(invoice.lineItems[0].label,'Rencontre (135 $)')
  assert.ok(Math.abs(invoice.lineItems[0].quantity-35/60)<1e-9)
  for(const endTime of ['13:00','12:59','24:00','99:99','']) assert.throws(()=>correctActivityTimes(rows,[{sourceRow:2,startTime:'13:00',endTime}]))
  assert.throws(()=>correctActivityTimes(rows,[{sourceRow:99,startTime:'13:00',endTime:'14:00'}]))
})


test('quantités affichées à deux décimales, arrondi demi vers le haut sans modifier la précision de calcul',()=>{
  assert.equal(formatPayrollQuantity(1.5833333333),'1,58')
  assert.equal(formatPayrollQuantity(1.584),'1,58')
  assert.equal(formatPayrollQuantity(1.585),'1,59')
  assert.equal(formatPayrollQuantity(2.6666666667),'2,67')
  assert.equal(formatPayrollQuantity(1.005),'1,01')
  assert.equal(formatPayrollQuantity(2),'2')
})


test('DOCX : quantité 1,58 affichée, précision interne et montant 128,25 conservés',async()=>{
 const period={startDate:'2026-11-02',endDate:'2026-11-15',dueDate:'2026-11-20'}
 const result=calculatePayroll([header,row(78.75,'13:00 - 13:35'),row(135,'10:00 - 11:00')],[pro],period).professionalResults[0]
 const bytes=await Packer.toBuffer(generatePayrollInvoiceDocument(result,period,null))
 const zip=await JSZip.loadAsync(bytes);const text=await zip.file('word/document.xml')!.async('string')
 assert.match(text,/1,58/);assert.doesNotMatch(text,/1,583333/)
 assert.match(text,/128,25/);assert.ok(Math.abs(result.lineItems[0].totalHours-19/12)<1e-9)
})
