import { readControlledMergeProfile } from './controlledMergeProfile.ts'
import { isRealLocalRehearsal } from '../clinical-real/runtimeIsolation.ts'

type Environment = Record<string, string | undefined>

/** This repository is a LOCAL pilot. A coherent hosted URL is not proof of isolation. */
export function assertUnificationPilot(environment: Environment = process.env): void {
  if (!isRealLocalRehearsal(environment) || environment.PEA_UNIFICATION_PILOT !== 'true'
    || environment.PEA_REAL_AI_SERVER_ENABLED !== 'false'
    || environment.CLINICAL_NOTES_AI_ENABLED !== 'false'
    || environment.PEA_REAL_BILLING_JOB_ENABLED !== 'false'
    || environment.PEA_REAL_INVOICE_EMAIL_MODE !== 'disabled'
    || environment.PEA_REMOTE_SIGNATURE_TEST_DELIVERY !== '0') {
    throw new Error('UNIFICATION_LOCAL_PILOT_REQUIRED')
  }
  for (const [key, value] of Object.entries(environment)) {
    if (value && /^(?:OPENAI_|RESEND_|STRIPE_|SMTP_|SENDGRID_|MAILGUN_|AWS_|S3_|DATABASE_URL$|PGPASSWORD$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/i.test(key)) {
      throw new Error('UNIFICATION_EXTERNAL_CONFIGURATION_REFUSED')
    }
  }
}

export function unificationSecurityHeaders() {
  return [{ key: 'Content-Security-Policy', value: [
    "default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    "media-src 'self' blob:", "connect-src 'self' http://127.0.0.1:56321 ws://127.0.0.1:56321 ws://127.0.0.1:3110",
    "frame-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ') }, { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), display-capture=(self), payment=(), geolocation=()' }]
}

/** Explicit release profile; the default remains the strict local pilot. */
export function assertUnificationRuntime(environment: Environment = process.env): void {
  if (environment.PEA_CONTROLLED_MERGE === 'true') { readControlledMergeProfile(environment); return }
  assertUnificationPilot(environment)
}
