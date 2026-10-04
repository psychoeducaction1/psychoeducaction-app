import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildIntakeSlots,
  dateKeyInToronto,
  rangesOverlap,
} from '@/lib/publicIntakeSchedule'
import {
  enforcePublicIntakeRateLimit,
  isAllowedPublicIntakeOrigin,
  publicIntakeJson,
  publicIntakeOptions,
} from '@/lib/publicIntakeSecurity'

export const dynamic = 'force-dynamic'

export function OPTIONS(request: NextRequest) {
  return publicIntakeOptions(request)
}

export async function GET(request: NextRequest) {
  if (!isAllowedPublicIntakeOrigin(request)) {
    return publicIntakeJson(request, { error: 'Origine non autorisée.' }, 403)
  }

  try {
    if (!(await enforcePublicIntakeRateLimit(request, 'availability', 120, 600))) {
      return publicIntakeJson(request, { error: 'Trop de requêtes.' }, 429)
    }

    const from = request.nextUrl.searchParams.get('from') || dateKeyInToronto(new Date())
    const days = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get('days') || 14), 1),
      31
    )
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return publicIntakeJson(request, { error: 'La date de départ est invalide.' }, 400)
    }

    const candidates = buildIntakeSlots(from, days)
    if (candidates.length === 0) {
      return publicIntakeJson(request, { timeZone: 'America/Toronto', slots: [] })
    }

    const firstStart = candidates[0].startAt
    const lastEnd = candidates[candidates.length - 1].bufferEndAt
    const supabase = getSupabaseAdmin()
    await supabase.from('intake_slot_holds').delete().lte('expires_at', new Date().toISOString())

    const [appointments, holds, blocks] = await Promise.all([
      supabase
        .from('intake_appointments')
        .select('start_at, buffer_end_at')
        .eq('status', 'scheduled')
        .gte('start_at', firstStart)
        .lt('start_at', lastEnd),
      supabase
        .from('intake_slot_holds')
        .select('start_at, buffer_end_at')
        .gt('expires_at', new Date().toISOString())
        .gte('start_at', firstStart)
        .lt('start_at', lastEnd),
      supabase
        .from('intake_calendar_blocks')
        .select('start_at, end_at')
        .lt('start_at', lastEnd)
        .gt('end_at', firstStart),
    ])

    const queryError = appointments.error || holds.error || blocks.error
    if (queryError) throw queryError
    const occupied = [
      ...(appointments.data ?? []).map((row) => ({
        start: row.start_at,
        end: row.buffer_end_at,
      })),
      ...(holds.data ?? []).map((row) => ({
        start: row.start_at,
        end: row.buffer_end_at,
      })),
      ...(blocks.data ?? []).map((row) => ({
        start: row.start_at,
        end: row.end_at,
      })),
    ]

    return publicIntakeJson(request, {
      timeZone: 'America/Toronto',
      callMinutes: 15,
      bufferMinutes: 15,
      slots: candidates.filter((slot) =>
        occupied.every((range) =>
          !rangesOverlap(slot.startAt, slot.bufferEndAt, range.start, range.end)
        )
      ),
    })
  } catch {
    return publicIntakeJson(
      request,
      { error: 'Les disponibilités sont temporairement indisponibles.' },
      503
    )
  }
}
