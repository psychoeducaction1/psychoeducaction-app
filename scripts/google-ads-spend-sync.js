/**
 * Google Ads Script à planifier chaque heure pour inclure la journée en cours.
 * Remplacer les deux valeurs ci-dessous avant l'installation dans Google Ads.
 */
const ENDPOINT = 'https://app.psychoeducaction.com/api/public/ad-spend/google';
const INGEST_SECRET = 'REMPLACER_PAR_GOOGLE_ADS_INGEST_SECRET';
const LOOKBACK_DAYS = 45;

// Google Ads Scripts appelle cette fonction globale.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function main() {
  const account = AdsApp.currentAccount();
  const accountId = account.getCustomerId().replace(/[^0-9]/g, '');
  const timeZone = account.getTimeZone();
  const currency = account.getCurrencyCode();
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (LOOKBACK_DAYS - 1));
  const from = Utilities.formatDate(start, timeZone, 'yyyy-MM-dd');
  const to = Utilities.formatDate(today, timeZone, 'yyyy-MM-dd');
  const query = [
    'SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  ].join(' ');
  const rows = [];

  const iterator = AdsApp.search(query);
  while (iterator.hasNext()) {
    const row = iterator.next();
    const amount = Number(row.metrics.costMicros || 0) / 1000000;
    if (!amount) continue;
    rows.push({
      date: row.segments.date,
      campaignId: String(row.campaign.id),
      campaignName: row.campaign.name || `Campagne ${row.campaign.id}`,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    });
  }

  const response = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${INGEST_SECRET}` },
    payload: JSON.stringify({ accountId, currency, from, to, rows }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Synchronisation refusée (${code}): ${response.getContentText()}`);
  }
  Logger.log(response.getContentText());
}
