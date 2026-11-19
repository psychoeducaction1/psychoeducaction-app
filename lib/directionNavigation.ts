/** Presentation only. Existing API, profile and clinical permissions remain authoritative. */
export function usesUnifiedDirectionNavigation(accountId: string | null | undefined, administrationAllowed: boolean, realApplication: boolean): boolean {
 return realApplication && administrationAllowed && (accountId === '3c514611-b530-4f48-84e4-32871b32f320' || accountId === 'ec6a6a4b-9a34-45e7-8bb7-db57d37c40b6')
}
