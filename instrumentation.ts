export async function register() {
  if (process.env.PEA_CONTROLLED_MERGE === 'true') {
    const { assertUnificationRuntime } = await import('./lib/clinical-unification/isolation.ts')
    assertUnificationRuntime(process.env)
    const { assertRealClinicalIsolation } = await import('./lib/clinical-real/runtimeIsolation.ts')
    assertRealClinicalIsolation(process.env)
    // The authorized hosted profile keeps the existing assignment transports.
    // Local-only socket/fetch restrictions still apply to every rehearsal below.
    return
  }
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const { assertUnificationPilot } = await import('./lib/clinical-unification/isolation.ts')
    assertUnificationPilot(process.env)
    const { assertRealClinicalIsolation, isRealLocalRehearsal, installRealLocalFetchGuard } = await import('./lib/clinical-real/runtimeIsolation.ts')
    assertRealClinicalIsolation(process.env)
    if (isRealLocalRehearsal(process.env)) installRealLocalFetchGuard(process.env)
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { installDevelopmentHttpGuard, installDevelopmentSocketGuard } = await import('./lib/developmentIsolation.ts')
      const [http, https, net, moduleApi] = await Promise.all([import('node:http'), import('node:https'), import('node:net'), import('node:module')])
      type Scope = Record<string, (...args: unknown[]) => unknown>
      installDevelopmentHttpGuard(http.default as unknown as Scope)
      installDevelopmentHttpGuard(https.default as unknown as Scope)
      installDevelopmentSocketGuard(net.Socket.prototype as unknown as Scope)
      moduleApi.default.syncBuiltinESMExports()
    }
    return
  }
  if (process.env.PEA_CLINICAL_RUNTIME === 'staging-db') {
    const { assertStagingIsolation, installStagingFetchGuard } = await import('./lib/clinical-staging/isolation.ts')
    assertStagingIsolation(process.env)
    if (process.env.NEXT_RUNTIME === 'nodejs') installStagingFetchGuard(process.env)
    return
  }
  const { assertDevelopmentIsolation, installDevelopmentFetchGuard, installDevelopmentSocketGuard, installDevelopmentHttpGuard } = await import('./lib/developmentIsolation.ts')
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const verified = process.env.PEA_CLINICAL_RUNTIME === 'local-db'
      ? (await import('./lib/clinical-local/runtime.ts')).readLocalClinicalRuntime()
      : undefined
    const localRuntime = verified ? await import('./lib/clinical-local/runtime.ts') : null
    const stripeTestEnabled = Boolean(localRuntime?.readStripeTestConfig())
    const openAiPilotKey = localRuntime?.readOpenAiPilotConfig()?.apiKey
    assertDevelopmentIsolation(process.env, verified)
    installDevelopmentFetchGuard(process.env, globalThis, verified, stripeTestEnabled, openAiPilotKey)
    const [http, https, net, moduleApi] = await Promise.all([import('node:http'), import('node:https'), import('node:net'), import('node:module')])
    type Scope = Record<string, (...args: unknown[]) => unknown>
    installDevelopmentHttpGuard(http.default as unknown as Scope)
    installDevelopmentHttpGuard(https.default as unknown as Scope)
    installDevelopmentSocketGuard(net.Socket.prototype as unknown as Scope, stripeTestEnabled, Boolean(openAiPilotKey))
    moduleApi.default.syncBuiltinESMExports()
    if (verified && process.env.PEA_CLINICAL_BILLING_WORKER !== 'off') (await import('./lib/clinical-local/billingWorker.ts')).startLocalBillingWorker()
  } else {
    // No runtime file or privileged credential in an Edge graph. local-db is
    // refused here because its identity proof is only available on Node.
    assertDevelopmentIsolation(process.env)
    installDevelopmentFetchGuard(process.env)
  }
}
