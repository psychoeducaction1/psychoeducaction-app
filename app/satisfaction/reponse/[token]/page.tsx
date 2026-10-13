'use client'

import { useParams } from 'next/navigation'
import { SatisfactionSurvey } from '@/components/satisfaction/SatisfactionSurvey'

export default function SatisfactionReponsePage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : params.token
  return <SatisfactionSurvey token={token} />
}
