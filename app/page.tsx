'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FilterMode, Catcher, Pitcher, SortDir, TabName,
  LeaderboardResponse, CatcherLeaderboardResponse, BatteryLeaderboardResponse,
} from '@/lib/types'
import { SeasonToggle }    from '@/components/SeasonToggle'
import { CatcherFilter }   from '@/components/CatcherFilter'
import { PitcherFilter }   from '@/components/PitcherFilter'
import { TeamFilter }      from '@/components/TeamFilter'
import { MinBfFilter }          from '@/components/MinBfFilter'
import { MinIpFilter, QUALIFIED_SENTINEL } from '@/components/MinIpFilter'
import { qualifiedIp }          from '@/lib/qualified'
import { TabNav }          from '@/components/TabNav'
import { LeaderboardTable } from '@/components/LeaderboardTable'
import { CatcherTable }    from '@/components/CatcherTable'
import { BatteryTable }    from '@/components/BatteryTable'

type AnyResponse = LeaderboardResponse | CatcherLeaderboardResponse | BatteryLeaderboardResponse

function parseSeasons(sp: URLSearchParams): number[] {
  const multi = sp.get('seasons')
  if (multi) return multi.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
  const single = sp.get('season')
  return [parseInt(single ?? '2026')]
}

function HomeContent() {
  const router = useRouter()
  const sp = useSearchParams()

  const [tab,     setTab]     = useState<TabName>((sp.get('tab') as TabName) ?? 'pitcher')
  const [seasons, setSeasons] = useState<number[]>(parseSeasons(sp))
  const [team,    setTeam]    = useState(sp.get('team') ?? '')
  const [minBf,   setMinBf]   = useState(parseInt(sp.get('min_bf') ?? '0'))
  const [minIp,   setMinIp]   = useState(
    sp.get('min_ip') !== null
      ? parseFloat(sp.get('min_ip')!)
      : (sp.get('tab') === 'battery' ? 0 : QUALIFIED_SENTINEL)
  )
  const [catcher, setCatcher] = useState<Catcher | null>(null)
  const [pitcher, setPitcher] = useState<Pitcher | null>(null)
  const [mode,    setMode]    = useState<FilterMode>((sp.get('mode') as FilterMode) ?? 'all')
  const [sortCol, setSortCol] = useState(sp.get('sort') ?? 'fip')
  const [sortDir, setSortDir] = useState<SortDir>((sp.get('dir') as SortDir) ?? 'asc')
  const [page,    setPage]    = useState(Math.max(1, parseInt(sp.get('page') ?? '1')))
  const [data,       setData]       = useState<AnyResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  // Most recent season drives qualifiedIp and search lookups
  const season = Math.max(...seasons)

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== 'pitcher')            params.set('tab', tab)
    if (seasons.length === 1 && seasons[0] !== 2026) params.set('season', String(seasons[0]))
    if (seasons.length > 1)           params.set('seasons', seasons.join(','))
    if (team)                         params.set('team', team)
    if (minBf !== 0)                  params.set('min_bf', String(minBf))
    if (minIp !== QUALIFIED_SENTINEL) params.set('min_ip', String(minIp))
    if (sortCol !== 'fip')            params.set('sort', sortCol)
    if (sortDir !== 'asc')            params.set('dir', sortDir)
    if (page !== 1)                   params.set('page', String(page))
    if (catcher)                      params.set('catcher_id', String(catcher.mlbam_id))
    if (pitcher)                      params.set('pitcher_id', String(pitcher.mlbam_id))
    if (mode !== 'all')               params.set('mode', mode)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasons.join(','), team, minBf, minIp, catcher?.mlbam_id, pitcher?.mlbam_id, mode, sortCol, sortDir, page])

  useEffect(() => {
    let alive = true

    const params = new URLSearchParams({
      tab, seasons: seasons.join(','), team, min_bf: String(minBf),
      min_ip: String(minIp === QUALIFIED_SENTINEL ? qualifiedIp(season) : minIp),
      sort: sortCol, dir: sortDir, page: String(page),
    })
    if (catcher) {
      params.set('catcher_id', String(catcher.mlbam_id))
      if (tab === 'pitcher') params.set('mode', mode)
    }
    if (pitcher) params.set('pitcher_id', String(pitcher.mlbam_id))

    setLoading(true)
    setData(null)

    fetch(`/api/leaderboard?${params}`)
      .then(res => res.json())
      .then(json => {
        if (!alive) return
        if (json.error) { setError(json.error); setLoading(false); return }
        setData(json)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        if (!alive) return
        setError(String(err))
        setLoading(false)
      })

    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasons.join(','), team, minBf, minIp, catcher?.mlbam_id, pitcher?.mlbam_id, mode, sortCol, sortDir, page])

  function handleTabChange(t: TabName) {
    setTab(t)
    setSortCol('fip')
    setSortDir('asc')
    setPage(1)
    setCatcher(null)
    setPitcher(null)
    setMode('all')
    if (t === 'battery' && minIp === QUALIFIED_SENTINEL) setMinIp(0)
  }

  function handleSort(col: string) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(['bf', 'ip', 'k_pct'].includes(col) ? 'desc' : 'asc')
    }
    setPage(1)
  }

  function handleSeasonsChange(s: number[]) {
    setSeasons(s); setCatcher(null); setPitcher(null); setMode('all'); setMinIp(QUALIFIED_SENTINEL); setPage(1)
  }

  function seasonLabel() {
    if (seasons.length === 1) return `${seasons[0]} Season`
    const sorted = [...seasons].sort((a, b) => a - b)
    const isRange = sorted.every((s, i) => i === 0 || s === sorted[i - 1] + 1)
    if (isRange) return `${sorted[0]}–${sorted[sorted.length - 1]}`
    return `${seasons.length} Seasons`
  }

  function subtitle() {
    const base = seasonLabel()
    if (tab === 'catcher') return `${base} · Pitcher stats by catcher`
    if (tab === 'battery') return `${base} · All pitcher–catcher combinations`
    if (!catcher && !pitcher) return `${base} · All Pitchers`
    if (pitcher && !catcher) return `${base} · ${pitcher.name}`
    if (!catcher) return base
    const bfLabel = (data as LeaderboardResponse)?.catcherBf
      ? ` (${(data as LeaderboardResponse).catcherBf!.toLocaleString()} BF)` : ''
    if (mode === 'was')   return `${base} · With ${catcher.name} catching${bfLabel}`
    if (mode === 'wasnt') return `${base} · Without ${catcher.name} catching${bfLabel}`
    return base
  }

  const total = data?.total ?? 0

  function buildExportUrl() {
    const params = new URLSearchParams({
      tab, seasons: seasons.join(','), team, min_bf: String(minBf),
      min_ip: String(minIp === QUALIFIED_SENTINEL ? qualifiedIp(season) : minIp),
      sort: sortCol, dir: sortDir, page: '1', export: '1',
    })
    if (catcher) {
      params.set('catcher_id', String(catcher.mlbam_id))
      if (tab === 'pitcher') params.set('mode', mode)
    }
    if (pitcher) params.set('pitcher_id', String(pitcher.mlbam_id))
    return `/api/leaderboard?${params}`
  }

  return (
    <main className="min-h-screen bg-[#edeae4] text-[#1a1a1a]">
      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">Battery Splits</h1>
          <p className="text-sm text-[#666] mt-1">
            MLB pitcher leaderboard with catcher presence filter — powered by Retrosheet
          </p>
        </div>

        {/* Main card */}
        <div className="bg-white border border-[#ddd8d0] rounded-2xl shadow-sm overflow-hidden">

          {/* Tab nav */}
          <div className="px-5 pt-4">
            <TabNav value={tab} onChange={handleTabChange} />
          </div>

          {/* Filter bar */}
          <div className="px-5 pt-4 pb-3 border-b border-[#ece8e1] flex flex-col gap-3">
            {/* Row 1: season / team / thresholds + search toggle */}
            <div className="flex flex-wrap items-center gap-4">
              <SeasonToggle value={seasons} onChange={handleSeasonsChange} />
              <div className="w-px h-5 bg-[#e0dbd2] hidden sm:block" />
              <TeamFilter value={team} onChange={t => { setTeam(t); setPage(1) }} />
              <MinBfFilter value={minBf} onChange={n => { setMinBf(n); setPage(1) }} />
              <MinIpFilter value={minIp} onChange={n => { setMinIp(n); setPage(1) }} hideQualified={tab === 'battery'} />
              <button
                onClick={() => setShowSearch(s => !s)}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#888] hover:text-[#1a1a1a] transition-colors rounded-lg hover:bg-[#f5f2ed]"
              >
                Search
                <svg className={`w-3.5 h-3.5 transition-transform ${showSearch ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {/* Row 2: pitcher / catcher search (collapsible) */}
            {showSearch && (
              <div className="flex flex-wrap items-center gap-4">
                {tab !== 'catcher' && (
                  <PitcherFilter
                    season={season}
                    selectedPitcher={pitcher}
                    onPitcherChange={p => { setPitcher(p); setPage(1) }}
                  />
                )}
                {tab !== 'pitcher' && (
                  <CatcherFilter
                    season={season}
                    selectedCatcher={catcher}
                    mode={mode}
                    onCatcherChange={c => { setCatcher(c); setPage(1) }}
                    onModeChange={m => { setMode(m); setPage(1) }}
                    hideMode
                  />
                )}
                {tab === 'pitcher' && (
                  <CatcherFilter
                    season={season}
                    selectedCatcher={catcher}
                    mode={mode}
                    onCatcherChange={c => { setCatcher(c); setPage(1) }}
                    onModeChange={m => { setMode(m); setPage(1) }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Table header line */}
          <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a1a]">{subtitle()}</h2>
              {data && <p className="text-xs text-[#999] mt-0.5">{total.toLocaleString()} {tab === 'catcher' ? 'catchers' : tab === 'battery' ? 'combinations' : 'pitchers'}</p>}
            </div>
            <div className="flex items-center gap-3">
              {loading && <span className="text-xs text-[#999] animate-pulse">Loading…</span>}
              {data && !loading && (
                <a
                  href={buildExportUrl()}
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#d0cbc3] text-[#555] hover:text-[#1a1a1a] hover:border-[#aaa] transition-colors"
                >
                  ↓ Export CSV
                </a>
              )}
            </div>
          </div>

          {error && (
            <div className="mx-5 mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Tables */}
          <div className="px-4 pb-5">
            {tab === 'pitcher' && (
              <LeaderboardTable
                rows={(data as LeaderboardResponse)?.rows ?? []}
                total={total} page={page} pageSize={50}
                sortCol={sortCol} sortDir={sortDir}
                onSort={handleSort} onPage={setPage}
                loading={loading} season={season}
              />
            )}
            {tab === 'catcher' && (
              <CatcherTable
                rows={(data as CatcherLeaderboardResponse)?.rows ?? []}
                total={total} page={page} pageSize={50}
                sortCol={sortCol} sortDir={sortDir}
                onSort={handleSort} onPage={setPage}
                loading={loading} season={season}
              />
            )}
            {tab === 'battery' && (
              <BatteryTable
                rows={(data as BatteryLeaderboardResponse)?.rows ?? []}
                total={total} page={page} pageSize={50}
                sortCol={sortCol} sortDir={sortDir}
                onSort={handleSort} onPage={setPage}
                loading={loading}
              />
            )}
          </div>
        </div>

        <p className="text-xs text-[#aaa] text-center pb-4">
          Data via Baseball Savant · Updated nightly via GitHub Actions
        </p>
      </div>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}
