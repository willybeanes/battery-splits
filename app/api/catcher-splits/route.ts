import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function ipToOuts(ip: number): number {
  const innings = Math.floor(ip)
  return innings * 3 + Math.round((ip - innings) * 10)
}
function outsToIp(outs: number): number {
  return Math.floor(outs / 3) + (outs % 3) / 10
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
  const catcher_id = parseInt(searchParams.get('catcher_id') ?? '0')
  const seasonsRaw = searchParams.get('seasons')
  const seasonRaw  = searchParams.get('season')
  const seasons = seasonsRaw
    ? seasonsRaw.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : [parseInt(seasonRaw ?? '2026')]

  if (!catcher_id) return NextResponse.json([], { status: 400 })

  const db = createServiceClient()
  const [{ data: splits }, { data: leagueTotals }] = await Promise.all([
    db.from('pitcher_catcher_stats').select('*').eq('catcher_id', catcher_id).in('season', seasons).neq('catcher_id', 0),
    db.from('pitcher_catcher_stats').select('hr,bb,so,ip,er').in('season', seasons).eq('catcher_id', 0),
  ])
  const fipConst = computeFipConst((leagueTotals ?? []) as { hr: number; bb: number; so: number; ip: number; er: number }[])

  // Aggregate across seasons by pitcher_id
  const agg = new Map<number, { pitcher_id: number; pitcher_name: string; pitcher_team: string | null; bf: number; outs: number; hits: number; hr: number; bb: number; so: number; er: number }>()
  for (const r of splits ?? []) {
    const pid = r.pitcher_id
    if (!agg.has(pid)) agg.set(pid, { pitcher_id: pid, pitcher_name: r.pitcher_name ?? `ID ${pid}`, pitcher_team: r.pitcher_team ?? null, bf: 0, outs: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0 })
    const a = agg.get(pid)!
    a.bf   += r.bf   ?? 0
    a.outs += ipToOuts(Number(r.ip ?? 0))
    a.hits += r.hits ?? 0
    a.hr   += r.hr   ?? 0
    a.bb   += r.bb   ?? 0
    a.so   += r.so   ?? 0
    a.er   += r.er   ?? 0
  }

  const rows = [...agg.values()]
    .sort((a, b) => b.bf - a.bf)
    .map(a => {
      const ip = outsToIp(a.outs)
      return {
        pitcher_id:   a.pitcher_id,
        pitcher_name: a.pitcher_name,
        pitcher_team: a.pitcher_team,
        bf: a.bf, ip,
        era:   a.outs > 0 ? Math.round((a.er / (a.outs / 3)) * 9 * 100) / 100 : null,
        whip:  a.outs > 0 ? Math.round(((a.hits + a.bb) / (a.outs / 3)) * 1000) / 1000 : null,
        k_pct: a.bf   > 0 ? Math.round((a.so / a.bf) * 1000) / 10 : null,
        bb_pct:a.bf   > 0 ? Math.round((a.bb / a.bf) * 1000) / 10 : null,
        fip: a.outs > 0 ? Math.round(((13 * a.hr + 3 * a.bb - 2 * a.so) / (a.outs / 3) + fipConst) * 100) / 100 : null,
        xfip: null,
      }
    })

  return NextResponse.json(rows)
}
