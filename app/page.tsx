'use client'

import { useState, useEffect } from 'react'
import {
  Season, FilterMode, Catcher, SortDir, TabName,
  LeaderboardResponse, CatcherLeaderboardResponse, BatteryLeaderboardResponse,
} from '@/lib/types'
import { SeasonToggle }    from '@/components/SeasonToggle'
import { CatcherFilter }   from '@/components/CatcherFilter'
import { TeamFilter }      from '@/components/TeamFilter'
import { MinBfFilter }          from '@/components/MinBfFilter'
import { MinIpFilter, QUALIFIED_SENTINEL } from '@/components/MinIpFilter'
import { qualifiedIp }          from '@/lib/qualified'
import { TabNav }          from '@/components/TabNav'
import { LeaderboardTable } from '@/components/LeaderboardTable'
import { CatcherTable }    from '@/components/CatcherTable'
import { BatteryTable }    from '@/components/BatteryTable'

type AnyResponse = LeaderboardResponse | CatcherLeaderboardResponse | BatteryLeaderboardResponse

export default function Home() {
  const [tab,     setTab]     = useState<TabName>('pitcher')
  const [season,  setSeason]  = useState<Season>(2026)
  const [team,    setTeam]    = useState('')
  const [minBf,   setMinBf]   = useState(0)
  const [minIp,   setMinIp]   = useState(-1) // -1 = Qualified
  const [catcher, setCatcher] = useState<Catcher | null>(null)
  const [mode,    setMode]    = useState<FilterMode>('all')
  const [sortCol, setSortCol] = useState('fip')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page,    setPage]    = useState(1)
  const [data,    setData]    = useState<AnyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    const params = new URLSearchParams({
      tab, season: String(season), team, min_bf: String(minBf),
      min_ip: String(minIp === QUALIFIED_SENTINEL ? qualifiedIp(season) : minIp),
      sort: sortCol, dir: sortDir, page: String(page),
    })
    if (tab === 'pitcher' && catcher) {
      params.set('catcher_id', String(catcher.mlbam_id))
      params.set('mode', mode)
    }

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
  }, [tab, season, team, minBf, minIp, catcher?.mlbam_id, mode, sortCol, sortDir, page])

  // Reset sort + page when tab changes
  function handleTabChange(t: TabName) {
    setTab(t)
    setSortCol('fip')
    setSortDir('asc')
    setPage(1)
    setCatcher(null)
    setMode('all')
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

  function handleSeasonChange(s: Season) {
    setSeason(s); setCatcher(null); setMode('all'); setMinIp(QUALIFIED_SENTINEL); setPage(1)
  }

  function subtitle() {
    const base = `${season} Season`
    if (tab === 'catcher') return `${base} · Pitcher stats by catcher`
    if (tab === 'battery') return `${base} · All pitcher–catcher combinations`
    if (!catcher) return `${base} · All Catchers`
    const bfLabel = (data as LeaderboardResponse)?.catcherBf
      ? ` (${(data as LeaderboardResponse).catcherBf!.toLocaleString()} BF)` : ''
    if (mode === 'was')   return `${base} · With ${catcher.name} catching${bfLabel}`
    if (mode === 'wasnt') return `${base} · Without ${catcher.name} catching${bfLabel}`
    return base
  }

  const total = data?.total ?? 0

  function buildExportUrl() {
    const params = new URLSearchParams({
      tab, season: String(season), team, min_bf: String(minBf),
      min_ip: String(minIp === QUALIFIED_SENTINEL ? qualifiedIp(season) : minIp),
      sort: sortCol, dir: sortDir, page: '1', export: '1',
    })
    if (tab === 'pitcher' && catcher) {
      params.set('catcher_id', String(catcher.mlbam_id))
      params.set('mode', mode)
    }
    return `/api/leaderboard?${params}`
  }

  return (
    <main className="min-h-screen bg-[#edeae4] text-[#1a1a1a]">
      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">Battery Splits</h1>
          <p className="text-sm text-[#666] mt-1">
            MLB pitcher leaderboard with catcher presence filter — powered by Baseball Savant Statcast
          </p>
        </div>

        {/* Main card */}
        <div className="bg-white border border-[#ddd8d0] rounded-2xl shadow-sm overflow-hidden">

          {/* Tab nav */}
          <div className="px-5 pt-4">
            <TabNav value={tab} onChange={handleTabChange} />
          </div>

          {/* Filter bar */}
          <div className="px-5 py-4 border-b border-[#ece8e1] flex flex-wrap items-center gap-4">
            <SeasonToggle value={season} onChange={handleSeasonChange} />
            <div className="w-px h-5 bg-[#e0dbd2] hidden sm:block" />
            <TeamFilter value={team} onChange={t => { setTeam(t); setPage(1) }} />
            <MinBfFilter value={minBf} onChange={n => { setMinBf(n); setPage(1) }} />
            <MinIpFilter value={minIp} onChange={n => { setMinIp(n); setPage(1) }} season={season} />
            {tab === 'pitcher' && (
              <>
                <div className="w-px h-5 bg-[#e0dbd2] hidden sm:block" />
                <CatcherFilter
                  season={season}
                  selectedCatcher={catcher}
                  mode={mode}
                  onCatcherChange={c => { setCatcher(c); setPage(1) }}
                  onModeChange={m => { setMode(m); setPage(1) }}
                />
              </>
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
                loading={loading}
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
