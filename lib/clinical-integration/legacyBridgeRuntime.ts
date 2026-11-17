/** Le laboratoire et le site de test fictif ne peuvent pas activer ce raccordement. */
export function shouldUseClinicalLegacyBridge(environment: Record<string, string | undefined> = process.env) {
  return environment.PEA_CLINICAL_RUNTIME === 'real-db'
    && environment.PEA_CLINICAL_LEGACY_BRIDGE === 'true'
}
