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
  const pitcher_id = parseInt(searchParams.get('pitcher_id') ?? '0')
  const seasonsRaw = searchParams.get('seasons')
  const seasonRaw  = searchParams.get('season')
  const seasons = seasonsRaw
    ? seasonsRaw.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : [parseInt(seasonRaw ?? '2026')]

  if (!pitcher_id) return NextResponse.json([], { status: 400 })

  const db = createServiceClient()
  const [{ data: splits }, { data: catchers }, { data: leagueTotals }] = await Promise.all([
    db.from('pitcher_catcher_stats').select('*')
      .eq('pitcher_id', pitcher_id).in('season', seasons).neq('catcher_id', 0),
    db.from('catchers').select('mlbam_id,name,team,season').in('season', seasons).order('season', { ascending: true }),
    db.from('pitcher_catcher_stats').select('hr,bb,so,ip,er').in('season', seasons).eq('catcher_id', 0),
  ])
  const fipConst = computeFipConst((leagueTotals ?? []) as { hr: number; bb: number; so: number; ip: number; er: number }[])

  // Use most recent season's name/team per catcher
  const catcherMap = new Map<number, { name: string; team: string | null }>()
  for (const c of catchers ?? []) catcherMap.set(c.mlbam_id, { name: c.name, team: c.team })

  // Aggregate across seasons by catcher_id
  const agg = new Map<number, { catcher_id: number; bf: number; outs: number; hits: number; hr: number; bb: number; so: number; er: number }>()
  for (const r of splits ?? []) {
    const cid = r.catcher_id
    if (!agg.has(cid)) agg.set(cid, { catcher_id: cid, bf: 0, outs: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0 })
    const a = agg.get(cid)!
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
        catcher_id:   a.catcher_id,
        catcher_name: catcherMap.get(a.catcher_id)?.name ?? `ID ${a.catcher_id}`,
        catcher_team: catcherMap.get(a.catcher_id)?.team ?? null,
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
