type Runtime = {
  PEA_CLINICAL_RUNTIME?: string
  PEA_REAL_BILLING_JOB_ENABLED?: string
  CRON_SECRET?: string
}

type JobResult = { status: 'completed' | 'already_running'; processedCases?: number; blockedCases?: number }

export async function runRealBillingCron(
  request: Request,
  runtime: Runtime,
  run: () => Promise<JobResult>,
): Promise<Response> {
  if (runtime.PEA_CLINICAL_RUNTIME !== 'real-db'
    || runtime.PEA_REAL_BILLING_JOB_ENABLED !== 'true'
    || !runtime.CRON_SECRET) {
    return Response.json({ error: 'Indisponible.' }, { status: 404 })
  }
  if (request.headers.get('authorization') !== `Bearer ${runtime.CRON_SECRET}`) {
    return Response.json({ error: 'Non autorisé.' }, { status: 401 })
  }
  try {
    const result = await run()
    if (result.status !== 'completed' && result.status !== 'already_running') throw new Error('BILLING_JOB_FAILED')
    return Response.json({ status: result.status,
      processedCases: Number(result.processedCases) || 0,
      blockedCases: Number(result.blockedCases) || 0 })
  } catch {
    return Response.json({ error: 'Le rapprochement planifié a échoué.' }, { status: 500 })
  }
}
