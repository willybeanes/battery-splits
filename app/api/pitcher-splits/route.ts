import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pitcher_id = parseInt(searchParams.get('pitcher_id') ?? '0')
  const season = parseInt(searchParams.get('season') ?? '2025')

  if (!pitcher_id) return NextResponse.json([], { status: 400 })

  const db = createServiceClient()
  const [{ data: splits }, { data: catchers }] = await Promise.all([
    db.from('pitcher_catcher_stats').select('*')
      .eq('pitcher_id', pitcher_id).eq('season', season).neq('catcher_id', 0)
      .order('bf', { ascending: false }),
    db.from('catchers').select('mlbam_id,name,team').eq('season', season),
  ])

  const catcherMap = new Map<number, { name: string; team: string | null }>()
  for (const c of catchers ?? []) catcherMap.set(c.mlbam_id, { name: c.name, team: c.team })

  const rows = (splits ?? []).map(r => ({
    catcher_id:   r.catcher_id,
    catcher_name: catcherMap.get(r.catcher_id)?.name ?? `ID ${r.catcher_id}`,
    catcher_team: catcherMap.get(r.catcher_id)?.team ?? null,
    bf: r.bf, ip: r.ip,
    era: r.era, whip: r.whip,
    k_pct: r.k_pct, bb_pct: r.bb_pct,
    fip: r.fip, xfip: r.xfip,
  }))

  return NextResponse.json(rows)
}
