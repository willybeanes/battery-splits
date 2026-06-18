import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function ipToOuts(ip: number): number {
  const innings = Math.floor(ip)
  return innings * 3 + Math.round((ip - innings) * 10)
}

function computeFipConst(totals: { hr: number; bb: number; so: number; ip: number; er: number }[]): number {
  let tER = 0, tOuts = 0, tHR = 0, tBB = 0, tSO = 0
  for (const r of totals) { tER += r.er; tOuts += ipToOuts(r.ip); tHR += r.hr; tBB += r.bb; tSO += r.so }
  const ipDec = tOuts / 3
  if (!ipDec) return 3.15
  return (tER / ipDec) * 9 - (13 * tHR + 3 * tBB - 2 * tSO) / ipDec
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pitcher_id = parseInt(searchParams.get('pitcher_id') ?? '0')
  if (!pitcher_id) return NextResponse.json({ error: 'pitcher_id required' }, { status: 400 })

  const db = createServiceClient()

  const [{ data: rows }, { data: leagueTotals }] = await Promise.all([
    db.from('pitcher_game_logs')
      .select('*')
      .eq('pitcher_id', pitcher_id)
      .eq('season', 2026)
      .order('game_date', { ascending: false }),
    db.from('pitcher_catcher_stats')
      .select('hr,bb,so,ip,er')
      .eq('season', 2026)
      .eq('catcher_id', 0),
  ])

  const fipConst = computeFipConst(
    (leagueTotals ?? []) as { hr: number; bb: number; so: number; ip: number; er: number }[]
  )

  const enriched = (rows ?? []).map(r => {
    const outs  = ipToOuts(Number(r.ip ?? 0))
    const ipDec = outs / 3
    const fip   = ipDec > 0
      ? Math.round(((13 * (r.hr ?? 0) + 3 * (r.bb ?? 0) - 2 * (r.so ?? 0)) / ipDec + fipConst) * 100) / 100
      : null
    return { ...r, fip }
  })

  return NextResponse.json({ rows: enriched, total: enriched.length })
}
