import { NextRequest, NextResponse } from 'next/server'
import { isStagingClinicalRuntime } from '@/lib/clinical-staging/runtime'
import { readStagingClinicalRuntime } from '@/lib/clinical-local/runtime'
import { runLocalBillingPreparation,runLocalCalendarCompletion } from '@/lib/clinical-local/billingWorker'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isStagingClinicalRuntime() || !process.env.CRON_SECRET) return NextResponse.json({ error: 'Indisponible.' }, { status: 404 })
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  const { data, error } = await getSupabaseAdmin().rpc('lab_admission_run_reminders')
  if (error) return NextResponse.json({ error: 'Le rappel simulé a échoué.' }, { status: 500 })
  try {
    const runtime=readStagingClinicalRuntime()
    const completed=await runLocalCalendarCompletion(runtime)
    await runLocalBillingPreparation(runtime)
    return NextResponse.json({ simulated: Number(data) || 0, completed })
  } catch {
    return NextResponse.json({ error: 'La préparation des factures fictives a échoué.' }, { status: 500 })
  }
}
