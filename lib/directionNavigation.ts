/** Presentation only. Existing API, profile and clinical permissions remain authoritative. */
export function usesUnifiedDirectionNavigation(accountId: string | null | undefined, administrationAllowed: boolean, realApplication: boolean): boolean {
 return realApplication && administrationAllowed && accountId === '3c514611-b530-4f48-84e4-32871b32f320'
}
