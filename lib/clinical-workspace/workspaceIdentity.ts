export type ClinicalIdentityMode = 'isolated_fixture' | 'isolated_local' | 'isolated_stage' | 'isolated_unified'

/** The staging database uses the durable local SQL contract under a separate, pinned project. */
export function workspaceMatchesIdentity(
  identityMode: ClinicalIdentityMode | undefined,
  workspace: { mode: string; durable: boolean },
): boolean {
  if (!identityMode) return false
  if (identityMode === 'isolated_unified') return workspace.mode === 'isolated_unified' && workspace.durable === true
  if (identityMode === 'isolated_fixture') return workspace.mode === 'isolated_fixture' && workspace.durable === false
  return workspace.mode === 'isolated_local' && workspace.durable === true
}

export function isDurableIdentity(mode: ClinicalIdentityMode | undefined): boolean {
  return mode === 'isolated_local' || mode === 'isolated_stage' || mode === 'isolated_unified'
}
