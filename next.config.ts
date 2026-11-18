import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BROWSER_TRANSCRIPTION_ASSETS } from './lib/clinical-workspace/browserAssets.ts'
import { controlledClinicalHeaders } from './lib/clinical-unification/controlledMergeProfile.ts'
import type { NextConfig } from 'next'
import { assertUnificationRuntime, unificationSecurityHeaders } from './lib/clinical-unification/isolation.ts'
import { readLocalClinicalRuntime } from './lib/clinical-local/runtime.ts'
import { assertDevelopmentIsolation, developmentLegacyApiRewrites, developmentLegacyPageRedirects, developmentSecurityHeaders } from './lib/developmentIsolation.ts'
import { assertStagingIsolation, stagingSecurityHeaders } from './lib/clinical-staging/isolation.ts'
import { assertRealClinicalIsolation, isRealLocalRehearsal } from './lib/clinical-real/runtimeIsolation.ts'

// This independent checkout cannot start with an inherited hosted environment.
assertUnificationRuntime(process.env)
const controlled = process.env.PEA_CONTROLLED_MERGE === 'true'
const runtime = process.env.PEA_CLINICAL_RUNTIME
const local = runtime === 'local-db'
const staging = runtime === 'staging-db'
const real = runtime === 'real-db'
if (local) assertDevelopmentIsolation(process.env, readLocalClinicalRuntime())
if (staging) assertStagingIsolation(process.env)
if (real) { assertRealClinicalIsolation(process.env); assertUnificationRuntime(process.env) }

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  // Preserve PDF.js's Node-local worker import; bundling moves pdf.mjs away
  // from pdf.worker.mjs and breaks extraction of archived notes in Next.
  serverExternalPackages: ['pdfjs-dist'],
  ...(controlled && process.env.PEA_CONTROLLED_BUILD_CHECK === 'true' ? { distDir: '.next-controlled-merge-preflight' } : isRealLocalRehearsal(process.env) ? { distDir: process.env.PEA_REAL_LOCAL_BUILD === 'true'
    ? '.next-real-build' : '.next-real-rehearsal' } : {}),
  env: {
    NEXT_PUBLIC_PEA_BROWSER_TRANSCRIPTION_READY: BROWSER_TRANSCRIPTION_ASSETS.every(file => existsSync(join(process.cwd(), 'public/clinical-model', file))) ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CONTROLLED_MERGE: controlled ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CLINICAL_REAL: real ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION: real ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CLINICAL_IMPORT_ENABLED: real && (controlled ? process.env.PEA_CLINICAL_IMPORT_ENABLED === 'true' : process.env.PEA_CLINICAL_IMPORT_ENABLED !== 'false') ? 'true' : 'false',
    NEXT_PUBLIC_PEA_MIGRATION_PREVIEW: controlled && process.env.PEA_MIGRATION_PREVIEW === 'true' ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CLINICAL_ASSIGNMENT_NAV: real && process.env.PEA_CLINICAL_ASSIGNMENT_NAV_ENABLED === 'true' ? 'true' : 'false',
    NEXT_PUBLIC_PEA_CLINICAL_LINK_STATUS: real && process.env.PEA_CLINICAL_LEGACY_BRIDGE === 'true' ? 'true' : 'false',
  },
  outputFileTracingExcludes: { '/*': ['./.local-clinical/**', './.pilot-private/**', './.env*', './output/**'] },
  outputFileTracingIncludes: {
    // App Router serves mandates through [[...segments]], not a mandates route file.
    '/api/clinical-workspace/**': ['./public/psychoeducaction-email-logo.png', './public/fonts/SignatureCursive.ttf'],
  },
  ...(local || staging || real ? {
    headers: async () => controlled ? ['/clinique/:path*', '/administration/:path*', '/signature-convention', '/api/clinical-workspace/:path*', '/procedures/:path*', '/api/procedures/:path*'].map(source => ({ source, headers: controlledClinicalHeaders(process.env) })) : [{ source: '/:path*', headers: real ? unificationSecurityHeaders() : staging ? stagingSecurityHeaders() : developmentSecurityHeaders(process.env.NODE_ENV === 'production') }],
    redirects: async () => real ? [] : developmentLegacyPageRedirects(),
    rewrites: async () => ({ beforeFiles: real ? [] : developmentLegacyApiRewrites(), afterFiles: [], fallback: [] }),
  } : {}),
}

export default nextConfig
