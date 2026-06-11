import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const catcher_id = parseInt(searchParams.get('catcher_id') ?? '0')
  const season = parseInt(searchParams.get('season') ?? '2026')

  if (!catcher_id) return NextResponse.json([], { status: 400 })

  const db = createServiceClient()
  const { data: splits } = await db
    .from('pitcher_catcher_stats')
    .select('*')
    .eq('catcher_id', catcher_id)
    .eq('season', season)
    .neq('catcher_id', 0)
    .order('bf', { ascending: false })

  const rows = (splits ?? []).map(r => ({
    pitcher_id:   r.pitcher_id,
    pitcher_name: r.pitcher_name ?? `ID ${r.pitcher_id}`,
    pitcher_team: r.pitcher_team ?? null,
    bf: r.bf, ip: r.ip,
    era: r.era, whip: r.whip,
    k_pct: r.k_pct, bb_pct: r.bb_pct,
    fip: r.fip, xfip: r.xfip,
  }))

  return NextResponse.json(rows)
}
