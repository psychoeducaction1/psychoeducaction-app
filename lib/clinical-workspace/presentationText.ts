/** Presentation only. Real deployment wording never changes a feature or send gate. */
export function clinicalUiText(laboratory: string, application: string, real = process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE === 'true'): string {
  return real ? application : laboratory
}
