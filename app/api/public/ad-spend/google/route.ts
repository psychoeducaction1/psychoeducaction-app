import { NextRequest, NextResponse } from 'next/server'
import { parseGoogleAdsIngestPayload } from '@/lib/adSpend'
import { ingestGoogleAdsSpend } from '@/lib/adSpendSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const secret = process.env.GOOGLE_ADS_INGEST_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'GOOGLE_ADS_INGEST_SECRET est manquant.' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  try {
    const payload = parseGoogleAdsIngestPayload(await request.json())
    const expectedAccountId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/[^0-9]/g, '')
    if (!expectedAccountId || payload.accountId !== expectedAccountId) {
      return NextResponse.json({ error: 'Compte Google Ads inattendu.' }, { status: 403 })
    }
    const result = await ingestGoogleAdsSpend(payload)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Synchronisation Google Ads impossible.',
    }, { status: 400 })
  }
}
