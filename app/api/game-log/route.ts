import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createServiceClient } from '@/lib/supabase'

let mlbamToFg: Record<string, { fg: number }> | null = null
function getFgId(mlbamId: number): number | null {
  if (!mlbamToFg) {
    try {
      mlbamToFg = JSON.parse(readFileSync(join(process.cwd(), 'public', 'mlbam-fg-map.json'), 'utf-8'))
    } catch { mlbamToFg = {} }
  }
  return mlbamToFg![String(mlbamId)]?.fg ?? null
}

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

const FG_PROXY = 'https://fg-proxy.vercel.app/api/fg-gamelog'

type FgGameData = {
  stuff_plus: number | null; location_plus: number | null; pitching_plus: number | null
  pitches: number | null; strikes: number | null; whiffs: number | null
  strike_pct: number | null; whiff_pct: number | null
}

async function fetchFangraphsStuff(mlbamId: number): Promise<Map<string, FgGameData>> {
  const map = new Map<string, FgGameData>()
  try {
    const fgid = getFgId(mlbamId)
    if (!fgid) return map

    // Fetch Stuff+/Location+/Pitching+ game log (type=52)
    const logRes = await fetch(
      `${FG_PROXY}?path=/api/players/game-log&playerid=${fgid}&position=P&type=52&season=2026`,
      { next: { revalidate: 3600 } }
    )
    if (!logRes.ok) return map
    const log = await logRes.json()
    const games: Record<string, unknown>[] = Array.isArray(log) ? log : (log?.mlb ?? log?.data ?? [])

    for (const g of games) {
      // Date field contains an HTML anchor: <a href="...date=2026-06-15&...">2026-06-15</a>
      // Extract ISO date from the href param or from gamedate field
      const rawDate = (g['gamedate'] ?? g['Date'] ?? '') as string
      const isoDate = normalizeDate(rawDate)
      if (!isoDate) continue
      const pitches   = (g['Pitches'] as number) || 0
      const strikes   = (g['Strikes'] as number) || 0
      const swstrPct  = (g['SwStr%']  as number) || 0
      const whiffs    = pitches > 0 ? Math.round(swstrPct * pitches) : null
      const strikePct = pitches > 0 ? Math.round((strikes / pitches) * 1000) / 10 : null
      const whiffPct  = pitches > 0 ? Math.round(swstrPct * 1000) / 10 : null
      map.set(isoDate, {
        stuff_plus:    toNum(g['sp_stuff']),
        location_plus: toNum(g['sp_location']),
        pitching_plus: toNum(g['sp_pitching']),
        pitches: pitches || null,
        strikes: strikes || null,
        whiffs,
        strike_pct: strikePct,
        whiff_pct:  whiffPct,
      })
    }
  } catch {
    // Fangraphs unavailable — return empty, game log still works
  }
  return map
}

function normalizeDate(s: string): string | null {
  if (!s) return null
  // Already ISO: "2026-04-01"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : Math.round(n)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pitcher_id = parseInt(searchParams.get('pitcher_id') ?? '0')
  if (!pitcher_id) return NextResponse.json({ error: 'pitcher_id required' }, { status: 400 })

  const db = createServiceClient()

  const [{ data: rows }, { data: leagueTotals }, stuffByDate] = await Promise.all([
    db.from('pitcher_game_logs')
      .select('*')
      .eq('pitcher_id', pitcher_id)
      .eq('season', 2026)
      .order('game_date', { ascending: false }),
    db.from('pitcher_catcher_stats')
      .select('hr,bb,so,ip,er')
      .eq('season', 2026)
      .eq('catcher_id', 0),
    fetchFangraphsStuff(pitcher_id),
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
    const stuff = stuffByDate.get(r.game_date as string) ?? { stuff_plus: null, location_plus: null, pitching_plus: null, pitches: null, strikes: null, whiffs: null, strike_pct: null, whiff_pct: null }
    return { ...r, fip, ...stuff }
  })

  return NextResponse.json({ rows: enriched, total: enriched.length })
}
