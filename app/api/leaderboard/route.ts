import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sortRows, deriveRates } from '@/lib/stats'

const PAGE_SIZE = 50

// ── CSV helpers ───────────────────────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => escapeCsv(row[h])).join(','))
  return lines.join('\n')
}

function csvResponse(csv: string, filename: string) {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

// Baseball IP notation helpers (5.2 = 5⅔ innings = 17 outs)
function ipToOuts(ip: number): number {
  const innings = Math.floor(ip)
  const fraction = Math.round((ip - innings) * 10)
  return innings * 3 + fraction
}
function outsToIp(outs: number): number {
  return Math.floor(outs / 3) + (outs % 3) / 10
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Returns set of pitcher_ids who meet the min IP/BF threshold in their TOTALS row
async function getQualifyingPitcherIds(
  db: ReturnType<typeof createServiceClient>,
  season: number, minBf: number, minIp: number, team: string
): Promise<Set<number>> {
  let q = db.from('pitcher_catcher_stats').select('pitcher_id')
    .eq('season', season).eq('catcher_id', 0)
    .gte('bf', minBf).gte('ip', minIp)
  if (team) q = q.eq('pitcher_team', team)
  const { data } = await q.limit(5000)
  return new Set((data ?? []).map((r: { pitcher_id: number }) => r.pitcher_id))
}

async function getCatcherCountMap(
  db: ReturnType<typeof createServiceClient>,
  season: number
): Promise<Map<number, number>> {
  // Supabase's server-side max_rows caps single requests at 1000 regardless of
  // .limit(). Paginate in chunks so we get every pitcher-catcher combination.
  const map = new Map<number, number>()
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data } = await db
      .from('pitcher_catcher_stats')
      .select('pitcher_id')
      .eq('season', season)
      .neq('catcher_id', 0)
      .range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    for (const r of data) {
      map.set(r.pitcher_id, (map.get(r.pitcher_id) ?? 0) + 1)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return map
}

async function getCatcherMap(
  db: ReturnType<typeof createServiceClient>,
  season: number
): Promise<Map<number, { name: string; team: string | null }>> {
  const { data } = await db.from('catchers').select('mlbam_id,name,team').eq('season', season).limit(2000)
  const map = new Map<number, { name: string; team: string | null }>()
  for (const c of data ?? []) map.set(c.mlbam_id, { name: c.name, team: c.team })
  return map
}

function paginate<T>(rows: T[], page: number): { rows: T[]; total: number; page: number; pageSize: number } {
  const total = rows.length
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return { rows: paged, total, page, pageSize: PAGE_SIZE }
}

// ── pitcher tab ───────────────────────────────────────────────────────────────

async function handlePitcherTab(
  db: ReturnType<typeof createServiceClient>,
  params: {
    season: number; team: string; minBf: number; minIp: number
    catcherId: number | null; mode: string
    sort: string; dir: string; page: number; exportCsv: boolean
  }
) {
  const { season, team, minBf, minIp, catcherId, mode, sort, dir, page, exportCsv } = params
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const PITCHER_CSV_COLS = ['pitcher_id', 'pitcher_name', 'pitcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er']

  // No catcher filter — server-side sort+page on totals rows
  if (!catcherId || mode === 'all') {
    let query = db
      .from('pitcher_catcher_stats')
      .select('*', { count: 'exact' })
      .eq('season', season)
      .eq('catcher_id', 0)
      .gte('bf', minBf)
      .gte('ip', minIp)
    if (team) query = query.eq('pitcher_team', team)
    query = query.order(sort, { ascending: dir === 'asc', nullsFirst: false })
    if (!exportCsv) query = (query as typeof query).range(from, to)
    const [{ data, error, count }, catcherCountMap] = await Promise.all([
      query,
      getCatcherCountMap(db, season),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      catcher_count: catcherCountMap.get(r.pitcher_id as number) ?? 0,
    }))
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, rows), `battery-splits-pitchers-${season}.csv`)
    return NextResponse.json({ rows, total: count ?? 0, page, pageSize: PAGE_SIZE })
  }

  // WAS mode
  if (mode === 'was') {
    const [qualIds, { data: wasRows, error }] = await Promise.all([
      getQualifyingPitcherIds(db, season, minBf, minIp, team),
      db.from('pitcher_catcher_stats').select('*')
        .eq('season', season).eq('catcher_id', catcherId).limit(5000),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const [{ data: catcherData }, catcherCountMap] = await Promise.all([
      db.from('catchers').select('name').eq('mlbam_id', catcherId).eq('season', season).single(),
      getCatcherCountMap(db, season),
    ])
    // Filter by pitcher's TOTAL qualifying threshold, not split IP
    const filtered = (wasRows ?? []).filter((r: { pitcher_id: number }) => qualIds.has(r.pitcher_id))
    const sorted = sortRows(
      filtered.map((r: Record<string, unknown>) => ({ ...r, catcher_count: catcherCountMap.get(r.pitcher_id as number) ?? 0 })),
      sort, dir
    )
    const catcherBf = filtered.reduce((s: number, r: { bf: number }) => s + (r.bf ?? 0), 0)
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, sorted), `battery-splits-pitchers-with-catcher-${season}.csv`)
    return NextResponse.json({ ...paginate(sorted, page), catcherName: catcherData?.name, catcherBf })
  }

  // WASN'T mode
  if (mode === 'wasnt') {
    const [{ data: totals }, { data: wasRows }, catcherCountMap] = await Promise.all([
      // Qualify by total IP/BF — not split
      db.from('pitcher_catcher_stats').select('*').eq('season', season).eq('catcher_id', 0)
        .gte('bf', minBf).gte('ip', minIp).limit(5000),
      db.from('pitcher_catcher_stats').select('*').eq('season', season).eq('catcher_id', catcherId).limit(5000),
      getCatcherCountMap(db, season),
    ])
    const { data: catcherData } = await db.from('catchers').select('name')
      .eq('mlbam_id', catcherId).eq('season', season).single()

    const wasMap = new Map<number, Record<string, number>>()
    for (const r of wasRows ?? []) wasMap.set(r.pitcher_id, r)

    const rows = []
    for (const total of totals ?? []) {
      if (team && total.pitcher_team !== team) continue
      const was = wasMap.get(total.pitcher_id)
      const hits = total.hits - (was?.hits ?? 0)
      const hr   = total.hr   - (was?.hr   ?? 0)
      const bb   = total.bb   - (was?.bb   ?? 0)
      const so   = total.so   - (was?.so   ?? 0)
      const er   = total.er   - (was?.er   ?? 0)
      const bf   = total.bf   - (was?.bf   ?? 0)
      const ip   = outsToIp(Math.max(0, ipToOuts(Number(total.ip)) - ipToOuts(Number(was?.ip ?? 0))))
      rows.push({
        pitcher_id: total.pitcher_id, pitcher_name: total.pitcher_name,
        pitcher_team: total.pitcher_team, bf, ip, hits, hr, bb, so, er, xfip: null,
        catcher_count: catcherCountMap.get(total.pitcher_id) ?? 0,
        ...deriveRates(hits, bb, so, hr, er, bf, ip),
      })
    }
    const catcherBf = (wasRows ?? []).reduce((s: number, r: { bf: number }) => s + (r.bf ?? 0), 0)
    const sorted = sortRows(rows, sort, dir)
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, sorted), `battery-splits-pitchers-without-catcher-${season}.csv`)
    return NextResponse.json({ ...paginate(sorted, page), catcherName: catcherData?.name, catcherBf })
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
}

// ── catcher tab ───────────────────────────────────────────────────────────────

async function handleCatcherTab(
  db: ReturnType<typeof createServiceClient>,
  params: { season: number; team: string; minBf: number; minIp: number; sort: string; dir: string; page: number; exportCsv: boolean }
) {
  const { season, team, minBf, minIp, sort, dir, page, exportCsv } = params

  const [catcherMap, { data: allRows, error }] = await Promise.all([
    getCatcherMap(db, season),
    db.from('pitcher_catcher_stats').select('*').eq('season', season)
      .neq('catcher_id', 0).limit(10000),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by catcher_id
  const agg = new Map<number, {
    catcher_id: number; catcher_name: string; catcher_team: string | null
    bf: number; ip: number; hits: number; hr: number; bb: number; so: number; er: number
  }>()

  for (const r of allRows ?? []) {
    const cid = r.catcher_id
    const meta = catcherMap.get(cid)
    if (!meta) continue
    if (team && r.pitcher_team !== team) continue
    if (!agg.has(cid)) {
      agg.set(cid, {
        catcher_id: cid, catcher_name: meta.name, catcher_team: meta.team,
        bf: 0, ip: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0,
      })
    }
    const a = agg.get(cid)!
    a.bf   += r.bf   ?? 0
    a.ip    = Math.round((a.ip + Number(r.ip ?? 0)) * 10) / 10
    a.hits += r.hits ?? 0
    a.hr   += r.hr   ?? 0
    a.bb   += r.bb   ?? 0
    a.so   += r.so   ?? 0
    a.er   += r.er   ?? 0
  }

  const rows = [...agg.values()]
    .filter(r => r.bf >= minBf && r.ip >= minIp)
    .map(r => ({ ...r, ...deriveRates(r.hits, r.bb, r.so, r.hr, r.er, r.bf, r.ip) }))

  const sorted = sortRows(rows, sort, dir)
  const CATCHER_CSV_COLS = ['catcher_id', 'catcher_name', 'catcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er']
  if (exportCsv) return csvResponse(toCsv(CATCHER_CSV_COLS, sorted as unknown as Record<string, unknown>[]), `battery-splits-catchers-${season}.csv`)
  return NextResponse.json(paginate(sorted, page))
}

// ── battery tab ───────────────────────────────────────────────────────────────

async function handleBatteryTab(
  db: ReturnType<typeof createServiceClient>,
  params: { season: number; team: string; minBf: number; minIp: number; sort: string; dir: string; page: number; exportCsv: boolean }
) {
  const { season, team, minBf, minIp, sort, dir, page, exportCsv } = params

  const [catcherMap, { data: allRows, error }] = await Promise.all([
    getCatcherMap(db, season),
    db.from('pitcher_catcher_stats').select('*').eq('season', season)
      .neq('catcher_id', 0).limit(10000),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (allRows ?? [])
    .filter(r => {
      if (team && r.pitcher_team !== team) return false
      if (!catcherMap.has(r.catcher_id)) return false
      // Apply min IP and min BF to the combination itself, not the pitcher's total
      if ((r.bf ?? 0) < minBf) return false
      if (Number(r.ip ?? 0) < minIp) return false
      return true
    })
    .map(r => {
      const meta = catcherMap.get(r.catcher_id)!
      return {
        pitcher_id: r.pitcher_id, pitcher_name: r.pitcher_name,
        pitcher_team: r.pitcher_team,
        catcher_id: r.catcher_id, catcher_name: meta.name, catcher_team: meta.team,
        bf: r.bf, ip: r.ip, hits: r.hits, hr: r.hr, bb: r.bb, so: r.so, er: r.er,
        era: r.era, whip: r.whip, k_pct: r.k_pct, bb_pct: r.bb_pct,
        fip: r.fip, xfip: r.xfip,
      }
    })

  const sorted = sortRows(rows, sort, dir)
  const BATTERY_CSV_COLS = ['pitcher_id', 'pitcher_name', 'pitcher_team', 'catcher_id', 'catcher_name', 'catcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er']
  if (exportCsv) return csvResponse(toCsv(BATTERY_CSV_COLS, sorted as unknown as Record<string, unknown>[]), `battery-splits-battery-${season}.csv`)
  return NextResponse.json(paginate(sorted, page))
}

// ── main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tab    = searchParams.get('tab') ?? 'pitcher'
  const season = parseInt(searchParams.get('season') ?? '2025')
  const team   = searchParams.get('team') ?? ''
  const minBf  = parseInt(searchParams.get('min_bf') ?? '25')
  const minIp  = parseFloat(searchParams.get('min_ip') ?? '0')
  const catcherIdParam = searchParams.get('catcher_id')
  const catcherId = catcherIdParam ? parseInt(catcherIdParam) : null
  const mode   = searchParams.get('mode') ?? 'all'
  const sort   = searchParams.get('sort') ?? 'fip'
  const dir    = (searchParams.get('dir') ?? 'asc') as 'asc' | 'desc'
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const exportCsv = searchParams.get('export') === '1'

  const db = createServiceClient()

  if (tab === 'pitcher') return handlePitcherTab(db, { season, team, minBf, minIp, catcherId, mode, sort, dir, page, exportCsv })
  if (tab === 'catcher') return handleCatcherTab(db, { season, team, minBf, minIp, sort, dir, page, exportCsv })
  if (tab === 'battery') return handleBatteryTab(db, { season, team, minBf, minIp, sort, dir, page, exportCsv })

  return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
}
