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

type DB = ReturnType<typeof createServiceClient>

// Paginate all rows from pitcher_catcher_stats matching the given seasons + catcher_id filter
async function fetchStatRows(
  db: DB,
  seasons: number[],
  catcherIdFilter: number | 'nonzero' | 'zero'
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  const CHUNK = 1000
  let from = 0
  while (true) {
    let q = db.from('pitcher_catcher_stats').select('*').in('season', seasons)
    if (catcherIdFilter === 'zero')    q = q.eq('catcher_id', 0)
    if (catcherIdFilter === 'nonzero') q = q.neq('catcher_id', 0)
    if (typeof catcherIdFilter === 'number') q = q.eq('catcher_id', catcherIdFilter)
    q = q.range(from, from + CHUNK - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return all
}

// Aggregate totals rows by pitcher_id across seasons
function aggregatePitcherTotals(rows: Record<string, unknown>[]) {
  // Use most-recent season for name/team (higher season number wins)
  const map = new Map<number, { pitcher_id: number; pitcher_name: string; pitcher_team: string | null; season: number; bf: number; outs: number; hits: number; hr: number; bb: number; so: number; er: number }>()
  for (const r of rows) {
    const id = r.pitcher_id as number
    const s  = r.season as number
    if (!map.has(id)) {
      map.set(id, { pitcher_id: id, pitcher_name: r.pitcher_name as string, pitcher_team: r.pitcher_team as string | null, season: s, bf: 0, outs: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0 })
    }
    const a = map.get(id)!
    if (s > a.season) { a.pitcher_name = r.pitcher_name as string; a.pitcher_team = r.pitcher_team as string | null; a.season = s }
    a.bf   += (r.bf   as number) ?? 0
    a.outs += ipToOuts(Number(r.ip ?? 0))
    a.hits += (r.hits as number) ?? 0
    a.hr   += (r.hr   as number) ?? 0
    a.bb   += (r.bb   as number) ?? 0
    a.so   += (r.so   as number) ?? 0
    a.er   += (r.er   as number) ?? 0
  }
  return [...map.values()].map(a => ({ ...a, ip: outsToIp(a.outs), ...deriveRates(a.hits, a.bb, a.so, a.hr, a.er, a.bf, outsToIp(a.outs)) }))
}

async function getCatcherCountMap(db: DB, seasons: number[]): Promise<Map<number, number>> {
  const rows = await fetchStatRows(db, seasons, 'nonzero')
  const map = new Map<number, Set<number>>()
  for (const r of rows) {
    const pid = r.pitcher_id as number
    const cid = r.catcher_id as number
    if (!map.has(pid)) map.set(pid, new Set())
    map.get(pid)!.add(cid)
  }
  return new Map([...map.entries()].map(([k, v]) => [k, v.size]))
}

async function getCatcherMap(db: DB, seasons: number[]): Promise<Map<number, { name: string; team: string | null }>> {
  // Fetch for all seasons; later seasons override name/team
  const sorted = [...seasons].sort((a, b) => a - b)
  const { data } = await db.from('catchers').select('mlbam_id,name,team,season').in('season', sorted).order('season', { ascending: true })
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
  db: DB,
  params: {
    seasons: number[]; team: string; minBf: number; minIp: number
    catcherId: number | null; pitcherId: number | null; mode: string
    sort: string; dir: string; page: number; exportCsv: boolean
  }
) {
  const { seasons, team, minBf, minIp, catcherId, pitcherId, mode, sort, dir, page, exportCsv } = params
  const singleSeason = seasons.length === 1
  const season = Math.max(...seasons)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const PITCHER_CSV_COLS = ['pitcher_id', 'pitcher_name', 'pitcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er']

  // No catcher filter
  if (!catcherId || mode === 'all') {
    // Fast path: single season → server-side sort+page
    if (singleSeason && !catcherId) {
      let query = db
        .from('pitcher_catcher_stats')
        .select('*', { count: 'exact' })
        .eq('season', season)
        .eq('catcher_id', 0)
        .gte('bf', minBf)
        .gte('ip', minIp)
      if (team) query = query.eq('pitcher_team', team)
      if (pitcherId) query = query.eq('pitcher_id', pitcherId)
      query = query.order(sort, { ascending: dir === 'asc', nullsFirst: false })
      if (!exportCsv) query = (query as typeof query).range(from, to)
      const [{ data, error, count }, catcherCountMap] = await Promise.all([query, getCatcherCountMap(db, seasons)])
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rows = (data ?? []).map((r: Record<string, unknown>) => ({ ...r, catcher_count: catcherCountMap.get(r.pitcher_id as number) ?? 0 }))
      if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, rows), `battery-splits-pitchers-${season}.csv`)
      return NextResponse.json({ rows, total: count ?? 0, page, pageSize: PAGE_SIZE })
    }

    // Multi-season (or pitcherId filter): aggregate in memory
    const [rawTotals, catcherCountMap] = await Promise.all([fetchStatRows(db, seasons, 'zero'), getCatcherCountMap(db, seasons)])
    const aggregated = aggregatePitcherTotals(rawTotals)
    const filtered = aggregated.filter(r => {
      if (r.bf < minBf || r.ip < minIp) return false
      if (team && r.pitcher_team !== team) return false
      if (pitcherId && r.pitcher_id !== pitcherId) return false
      return true
    }).map(r => ({ ...r, catcher_count: catcherCountMap.get(r.pitcher_id) ?? 0 }))
    const sorted2 = sortRows(filtered as unknown as Record<string, unknown>[], sort, dir)
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, sorted2), `battery-splits-pitchers-${seasons.join('-')}.csv`)
    return NextResponse.json(paginate(sorted2, page))
  }

  // WAS mode
  if (mode === 'was') {
    const [rawTotals, wasRowsRaw] = await Promise.all([
      fetchStatRows(db, seasons, 'zero'),
      fetchStatRows(db, seasons, catcherId),
    ])
    const catcherCountMap = await getCatcherCountMap(db, seasons)
    // Aggregate totals to determine qualifying threshold
    const aggregated = aggregatePitcherTotals(rawTotals)
    const qualIds = new Set(aggregated.filter(r => r.bf >= minBf && r.ip >= minIp && (!team || r.pitcher_team === team)).map(r => r.pitcher_id))
    // Aggregate was-rows by pitcher
    const wasAgg = aggregatePitcherTotals(wasRowsRaw)
    const filtered = wasAgg.filter(r => qualIds.has(r.pitcher_id))
    const sorted2 = sortRows(
      filtered.map(r => ({ ...r, catcher_count: catcherCountMap.get(r.pitcher_id) ?? 0 })) as unknown as Record<string, unknown>[],
      sort, dir
    )
    const catcherBf = filtered.reduce((s, r) => s + r.bf, 0)
    const { data: catcherData } = await db.from('catchers').select('name').eq('mlbam_id', catcherId).eq('season', season).single()
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, sorted2), `battery-splits-pitchers-with-catcher-${seasons.join('-')}.csv`)
    return NextResponse.json({ ...paginate(sorted2, page), catcherName: catcherData?.name, catcherBf })
  }

  // WASN'T mode
  if (mode === 'wasnt') {
    const [rawTotals, wasRowsRaw, catcherCountMap] = await Promise.all([
      fetchStatRows(db, seasons, 'zero'),
      fetchStatRows(db, seasons, catcherId),
      getCatcherCountMap(db, seasons),
    ])
    const { data: catcherData } = await db.from('catchers').select('name').eq('mlbam_id', catcherId).eq('season', season).single()

    const totalsAgg = aggregatePitcherTotals(rawTotals)
    const wasAgg = new Map(aggregatePitcherTotals(wasRowsRaw).map(r => [r.pitcher_id, r]))

    const rows = []
    for (const total of totalsAgg) {
      if (total.bf < minBf || total.ip < minIp) continue
      if (team && total.pitcher_team !== team) continue
      const was = wasAgg.get(total.pitcher_id)
      const hits = total.hits - (was?.hits ?? 0)
      const hr   = total.hr   - (was?.hr   ?? 0)
      const bb   = total.bb   - (was?.bb   ?? 0)
      const so   = total.so   - (was?.so   ?? 0)
      const er   = total.er   - (was?.er   ?? 0)
      const bf   = total.bf   - (was?.bf   ?? 0)
      const ip   = outsToIp(Math.max(0, ipToOuts(total.ip) - ipToOuts(was?.ip ?? 0)))
      rows.push({
        pitcher_id: total.pitcher_id, pitcher_name: total.pitcher_name,
        pitcher_team: total.pitcher_team, bf, ip, hits, hr, bb, so, er, xfip: null,
        catcher_count: catcherCountMap.get(total.pitcher_id) ?? 0,
        ...deriveRates(hits, bb, so, hr, er, bf, ip),
      })
    }
    const catcherBf = [...wasAgg.values()].reduce((s, r) => s + r.bf, 0)
    const sorted2 = sortRows(rows as unknown as Record<string, unknown>[], sort, dir)
    if (exportCsv) return csvResponse(toCsv(PITCHER_CSV_COLS, sorted2), `battery-splits-pitchers-without-catcher-${seasons.join('-')}.csv`)
    return NextResponse.json({ ...paginate(sorted2, page), catcherName: catcherData?.name, catcherBf })
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
}

// ── catcher tab ───────────────────────────────────────────────────────────────

async function handleCatcherTab(
  db: DB,
  params: { seasons: number[]; team: string; minBf: number; minIp: number; pitcherId: number | null; sort: string; dir: string; page: number; exportCsv: boolean }
) {
  const { seasons, team, minBf, minIp, pitcherId, sort, dir, page, exportCsv } = params

  const [catcherMap, rawRows] = await Promise.all([
    getCatcherMap(db, seasons),
    fetchStatRows(db, seasons, 'nonzero'),
  ])

  const agg = new Map<number, { catcher_id: number; catcher_name: string; catcher_team: string | null; bf: number; outs: number; hits: number; hr: number; bb: number; so: number; er: number }>()
  for (const r of rawRows) {
    const cid = r.catcher_id as number
    const meta = catcherMap.get(cid)
    if (!meta) continue
    if (team && r.pitcher_team !== team) continue
    if (pitcherId && r.pitcher_id !== pitcherId) continue
    if (!agg.has(cid)) agg.set(cid, { catcher_id: cid, catcher_name: meta.name, catcher_team: meta.team, bf: 0, outs: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0 })
    const a = agg.get(cid)!
    a.bf   += (r.bf   as number) ?? 0
    a.outs += ipToOuts(Number(r.ip ?? 0))
    a.hits += (r.hits as number) ?? 0
    a.hr   += (r.hr   as number) ?? 0
    a.bb   += (r.bb   as number) ?? 0
    a.so   += (r.so   as number) ?? 0
    a.er   += (r.er   as number) ?? 0
  }

  const rows = [...agg.values()]
    .map(r => ({ ...r, ip: outsToIp(r.outs) }))
    .filter(r => r.bf >= minBf && r.ip >= minIp)
    .map(r => ({ ...r, ...deriveRates(r.hits, r.bb, r.so, r.hr, r.er, r.bf, r.ip) }))

  const sorted = sortRows(rows, sort, dir)
  const CATCHER_CSV_COLS = ['catcher_id', 'catcher_name', 'catcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er']
  if (exportCsv) return csvResponse(toCsv(CATCHER_CSV_COLS, sorted as unknown as Record<string, unknown>[]), `battery-splits-catchers-${seasons.join('-')}.csv`)
  return NextResponse.json(paginate(sorted, page))
}

// ── battery tab ───────────────────────────────────────────────────────────────

async function handleBatteryTab(
  db: DB,
  params: { seasons: number[]; team: string; minBf: number; minIp: number; pitcherId: number | null; catcherId: number | null; sort: string; dir: string; page: number; exportCsv: boolean }
) {
  const { seasons, team, minBf, minIp, pitcherId, catcherId, sort, dir, page, exportCsv } = params
  const season = Math.max(...seasons)

  const [catcherMap, rawRows] = await Promise.all([
    getCatcherMap(db, seasons),
    fetchStatRows(db, seasons, 'nonzero'),
  ])

  // Aggregate by (pitcher_id, catcher_id) key across seasons
  type BattKey = string
  const agg = new Map<BattKey, { pitcher_id: number; pitcher_name: string; pitcher_team: string | null; pitcher_season: number; catcher_id: number; bf: number; outs: number; hits: number; hr: number; bb: number; so: number; er: number }>()
  for (const r of rawRows) {
    const pid = r.pitcher_id as number
    const cid = r.catcher_id as number
    const s   = r.season as number
    const key: BattKey = `${pid}:${cid}`
    if (!agg.has(key)) agg.set(key, { pitcher_id: pid, pitcher_name: r.pitcher_name as string, pitcher_team: r.pitcher_team as string | null, pitcher_season: s, catcher_id: cid, bf: 0, outs: 0, hits: 0, hr: 0, bb: 0, so: 0, er: 0 })
    const a = agg.get(key)!
    if (s > a.pitcher_season) { a.pitcher_name = r.pitcher_name as string; a.pitcher_team = r.pitcher_team as string | null; a.pitcher_season = s }
    a.bf   += (r.bf   as number) ?? 0
    a.outs += ipToOuts(Number(r.ip ?? 0))
    a.hits += (r.hits as number) ?? 0
    a.hr   += (r.hr   as number) ?? 0
    a.bb   += (r.bb   as number) ?? 0
    a.so   += (r.so   as number) ?? 0
    a.er   += (r.er   as number) ?? 0
  }

  // Build pitcher aggregate FIP map from totals rows (works for single and multi-season)
  const pitcherTotalsRaw = await fetchStatRows(db, seasons, 'zero')
  const pitcherFipMap = new Map<number, number>()
  for (const t of aggregatePitcherTotals(pitcherTotalsRaw)) {
    if (t.fip != null) pitcherFipMap.set(t.pitcher_id, t.fip)
  }

  // Normalize diffs across all qualifying combos (≥20 IP together)
  let chemMean = 0, chemStd = 1
  const diffs: number[] = []
  for (const a of agg.values()) {
    const ip = outsToIp(a.outs)
    const comboFip = deriveRates(a.hits, a.bb, a.so, a.hr, a.er, a.bf, ip).fip
    const seasonFip = pitcherFipMap.get(a.pitcher_id)
    if (ip >= 20 && seasonFip != null && comboFip != null) diffs.push(seasonFip - comboFip)
  }
  if (diffs.length > 1) {
    chemMean = diffs.reduce((s, d) => s + d, 0) / diffs.length
    chemStd = Math.sqrt(diffs.reduce((s, d) => s + (d - chemMean) ** 2, 0) / diffs.length) || 1
  }

  function normalCdf(z: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(z))
    const d = 0.3989423 * Math.exp(-z * z / 2)
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
    return z > 0 ? 1 - p : p
  }

  const rows = [...agg.values()]
    .map(a => {
      const ip = outsToIp(a.outs)
      const meta = catcherMap.get(a.catcher_id)
      const rates = deriveRates(a.hits, a.bb, a.so, a.hr, a.er, a.bf, ip)
      let chem_score: number | null = null
      if (ip >= 20 && rates.fip != null) {
        const seasonFip = pitcherFipMap.get(a.pitcher_id)
        if (seasonFip != null) {
          const z = ((seasonFip - rates.fip) - chemMean) / chemStd
          chem_score = Math.round(normalCdf(z) * 100)
        }
      }
      return {
        pitcher_id: a.pitcher_id, pitcher_name: a.pitcher_name, pitcher_team: a.pitcher_team,
        catcher_id: a.catcher_id, catcher_name: meta?.name ?? `ID ${a.catcher_id}`, catcher_team: meta?.team ?? null,
        bf: a.bf, ip, hits: a.hits, hr: a.hr, bb: a.bb, so: a.so, er: a.er,
        ...rates, chem_score,
      }
    })
    .filter(r => {
      if (team && r.pitcher_team !== team) return false
      if (pitcherId && r.pitcher_id !== pitcherId) return false
      if (catcherId && r.catcher_id !== catcherId) return false
      if (r.bf < minBf) return false
      if (r.ip < minIp) return false
      return true
    })

  const sorted = sortRows(rows as unknown as Record<string, unknown>[], sort, dir)
  const BATTERY_CSV_COLS = ['pitcher_id', 'pitcher_name', 'pitcher_team', 'catcher_id', 'catcher_name', 'catcher_team', 'bf', 'ip', 'era', 'whip', 'k_pct', 'bb_pct', 'fip', 'hits', 'hr', 'bb', 'so', 'er', 'chem_score']
  if (exportCsv) return csvResponse(toCsv(BATTERY_CSV_COLS, sorted), `battery-splits-battery-${seasons.join('-')}.csv`)
  return NextResponse.json(paginate(sorted, page))
}

// ── main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tab    = searchParams.get('tab') ?? 'pitcher'
  const team   = searchParams.get('team') ?? ''
  const minBf  = parseInt(searchParams.get('min_bf') ?? '25')
  const minIp  = parseFloat(searchParams.get('min_ip') ?? '0')
  const catcherIdParam = searchParams.get('catcher_id')
  const catcherId = catcherIdParam ? parseInt(catcherIdParam) : null
  const pitcherIdParam = searchParams.get('pitcher_id')
  const pitcherId = pitcherIdParam ? parseInt(pitcherIdParam) : null
  const mode   = searchParams.get('mode') ?? 'all'
  const sort   = searchParams.get('sort') ?? 'fip'
  const dir    = (searchParams.get('dir') ?? 'asc') as 'asc' | 'desc'
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const exportCsv = searchParams.get('export') === '1'

  // Accept both ?seasons=2024,2025 and legacy ?season=2026
  const seasonsRaw = searchParams.get('seasons')
  const seasonRaw  = searchParams.get('season')
  const seasons = seasonsRaw
    ? seasonsRaw.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : [parseInt(seasonRaw ?? '2026')]

  const db = createServiceClient()

  if (tab === 'pitcher') return handlePitcherTab(db, { seasons, team, minBf, minIp, catcherId, pitcherId, mode, sort, dir, page, exportCsv })
  if (tab === 'catcher') return handleCatcherTab(db, { seasons, team, minBf, minIp, pitcherId, sort, dir, page, exportCsv })
  if (tab === 'battery') return handleBatteryTab(db, { seasons, team, minBf, minIp, pitcherId, catcherId, sort, dir, page, exportCsv })

  return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
}
