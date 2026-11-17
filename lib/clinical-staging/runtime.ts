type Environment = Record<string, string | undefined>

const STAGING_PROJECT_ID = 'prj_FMczAco54r9EXdYewDjSnPUFZp8U'

export function isStagingClinicalRuntime(environment: Environment = process.env) {
  return environment.PEA_CLINICAL_RUNTIME === 'staging-db'
    && environment.PEA_STAGING_FICTIONAL_ONLY === 'true'
    && environment.PEA_STAGING_PROJECT_REF === 'csnmblsosfgjgljgtwyr'
    && environment.NEXT_PUBLIC_SUPABASE_URL === 'https://csnmblsosfgjgljgtwyr.supabase.co'
    && environment.VERCEL === '1'
    && environment.VERCEL_PROJECT_ID === STAGING_PROJECT_ID
    && environment.PEA_STAGING_VERCEL_PROJECT_ID === STAGING_PROJECT_ID
    && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(environment.NEXT_PUBLIC_APP_URL ?? '')
}

export function stagingAllowedEmails(environment: Environment = process.env): string[] {
  if (!isStagingClinicalRuntime(environment)) return []
  const values = (environment.PEA_STAGING_ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase())
  if (values.length !== 2 || new Set(values).size !== 2
    || values.some(value => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value) || value.endsWith('.invalid'))) {
    throw new Error('STAGING_ALLOWLIST_REFUSED')
  }
  return values
}
