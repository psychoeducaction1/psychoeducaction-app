'use client'

import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { PayrollInvoiceEditor } from '@/components/PayrollInvoiceEditor'

export default function RectifyPayrollInvoicePage() {
  const router = useRouter()
  return <><AppNav /><div className="lg:ml-72"><PayrollInvoiceEditor onClose={() => router.push('/direction/paie')} /></div></>
}
