import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { runRealBillingCron } from '@/lib/clinical-real/billingCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  return runRealBillingCron(request, {
    PEA_CLINICAL_RUNTIME: process.env.PEA_CLINICAL_RUNTIME,
    PEA_REAL_BILLING_JOB_ENABLED: process.env.PEA_REAL_BILLING_JOB_ENABLED,
    CRON_SECRET: process.env.CRON_SECRET,
  }, async () => {
    const { data, error } = await getSupabaseAdmin().rpc('clinical_reconcile_due_billing_job')
    if (error || !data || typeof data !== 'object') throw new Error('BILLING_JOB_FAILED')
    const result = data as Record<string, unknown>
    if (result.status !== 'completed' && result.status !== 'already_running') throw new Error('BILLING_JOB_FAILED')
    return { status: result.status, processedCases: Number(result.processedCases) || 0,
      blockedCases: Number(result.blockedCases) || 0 }
  })
}
