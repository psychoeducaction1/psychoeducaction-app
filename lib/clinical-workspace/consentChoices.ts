export type AdditionalPersonDecision = 'granted' | 'refused'

export function usesForAdditionalPerson(decision: AdditionalPersonDecision) {
  const accepted = decision === 'granted'
  return { recording: accepted, transcription: accepted, drafting: accepted }
}
