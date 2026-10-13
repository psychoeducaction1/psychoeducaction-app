export type AcquisitionAttribution = { utm: Record<string, string> | null }

export function acquisitionAttributionFor({ utm }: AcquisitionAttribution) {
  const attribution = utm ?? {}
  const source = (attribution.source || '').trim().toLowerCase()
  const medium = (attribution.medium || '').trim().toLowerCase()
  const googleClick = Boolean(attribution.gclid || attribution.gbraid || attribution.wbraid)
  const metaClick = Boolean(attribution.fbclid)
  const paidMedium = ['cpc', 'ppc', 'paid', 'paid_social', 'paid-social'].includes(medium)
  let platform = source || 'direct'
  if (googleClick || source === 'google_ads' || (source === 'google' && paidMedium)) {
    platform = 'google_ads'
  } else if (metaClick || source === 'meta_ads' ||
    (['facebook', 'instagram', 'meta', 'fb', 'ig'].includes(source) && paidMedium)) {
    platform = 'meta_ads'
  }
  return {
    platform,
    campaign: attribution.campaign?.trim() ||
      (attribution.id?.trim() ? `Campagne ${attribution.id.trim()}` : '(campagne non renseignée)'),
  }
}
