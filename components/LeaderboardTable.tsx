'use client'

import { Fragment, useState, useEffect } from 'react'
import { PitcherRow, PitcherSplitRow, SortCol, SortDir } from '@/lib/types'
import { StatHeader } from './StatHeader'
import { fmt, fmtIp, fipColor } from '@/lib/stats'

interface Props {
  rows: PitcherRow[]
  total: number
  page: number
  pageSize: number
  sortCol: SortCol
  sortDir: SortDir
  onSort: (col: SortCol) => void
  onPage: (p: number) => void
  loading: boolean
  season: number
}

function SplitRows({ pitcherId, season }: { pitcherId: number; season: number }) {
  const [splits, setSplits] = useState<PitcherSplitRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/pitcher-splits?pitcher_id=${pitcherId}&season=${season}`)
      .then(r => r.json())
      .then(data => { setSplits(data); setLoading(false) })
      .catch(() => { setSplits([]); setLoading(false) })
  }, [pitcherId, season])

  if (loading) {
    return (
      <tr className="bg-[#faf8f5]">
        <td colSpan={10} className="px-6 py-3 text-xs text-[#aaa]">Loading splits…</td>
      </tr>
    )
  }

  if (!splits || splits.length === 0) {
    return (
      <tr className="bg-[#faf8f5]">
        <td colSpan={10} className="px-6 py-3 text-xs text-[#aaa]">No catcher splits available.</td>
      </tr>
    )
  }

  return (
    <>
      {splits.map(s => (
        <tr key={s.catcher_id} className="bg-[#faf8f5] border-b border-[#ede8e1]">
          <td />
          <td className="px-3 py-2 text-xs text-[#555] pl-9 whitespace-nowrap">↳ {s.catcher_name}</td>
          <td className="px-3 py-2 text-xs font-mono text-[#999]">{s.catcher_team ?? '—'}</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{s.bf}</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{fmtIp(s.ip)}</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{fmt(s.era)}</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{fmt(s.whip, 3)}</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{fmt(s.k_pct, 1)}%</td>
          <td className="px-3 py-2 text-right text-xs font-mono text-[#555]">{fmt(s.bb_pct, 1)}%</td>
          <td className="px-3 py-2 text-right text-xs font-mono"><span className={fipColor(s.fip)}>{fmt(s.fip)}</span></td>
        </tr>
      ))}
    </>
  )
}

export function LeaderboardTable({
  rows, total, page, pageSize, sortCol, sortDir, onSort, onPage, loading, season
}: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const totalPages = Math.ceil(total / pageSize)
  const startRank = (page - 1) * pageSize + 1

  function toggleExpand(id: number) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-[#e0dbd2]">
        <table className="w-full border-collapse min-w-[800px]">
          <thead>
            <tr className="bg-[#f5f2ed] border-b border-[#e0dbd2]">
              <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-10">#</th>
              <StatHeader col="pitcher_name" label="Pitcher"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="pitcher_team" label="Team"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="bf"     label="BF"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Batters Faced" />
              <StatHeader col="ip"     label="IP"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Innings Pitched" />
              <StatHeader col="era"    label="ERA"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Earned Run Average" />
              <StatHeader col="whip"   label="WHIP" sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Walks + Hits per Inning" />
              <StatHeader col="k_pct"  label="K%"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Strikeout Rate" />
              <StatHeader col="bb_pct" label="BB%"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Walk Rate" />
              <StatHeader col="fip"    label="FIP"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Fielding Independent Pitching" />
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[#aaa] text-sm">
                  No data available for this filter.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const isExpanded = expandedId === row.pitcher_id
              return (
                <Fragment key={row.pitcher_id}>
                  <tr
                    onClick={() => toggleExpand(row.pitcher_id)}
                    className={`border-b border-[#ece8e1] hover:bg-[#f8f6f2] transition-colors cursor-pointer select-none ${isExpanded ? 'bg-[#f5f2ed]' : ''}`}
                  >
                    <td className="px-3 py-2.5 text-center text-xs font-mono text-[#bbb]">{startRank + i}</td>
                    <td className="px-3 py-2.5 text-left text-sm font-semibold text-[#1a1a1a] whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span className={`transition-transform text-[#bbb] text-[10px] inline-block ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {row.pitcher_name}
                        {row.catcher_count !== undefined && row.catcher_count > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-[#aaa]">({row.catcher_count})</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-left text-xs font-mono text-[#999]">{row.pitcher_team ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{row.bf ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmtIp(row.ip)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.era)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.whip, 3)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.k_pct, 1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.bb_pct, 1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm">
                      <span className={fipColor(row.fip)}>{fmt(row.fip)}</span>
                    </td>
                  </tr>
                  {isExpanded && <SplitRows pitcherId={row.pitcher_id} season={season} />}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[#999]">
            {startRank}–{Math.min(startRank + rows.length - 1, total)} of {total} pitchers
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => onPage(page - 1)} disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg bg-white border border-[#d0cbc3] text-[#666] hover:text-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-sm text-[#999]">{page} / {totalPages}</span>
            <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg bg-white border border-[#d0cbc3] text-[#666] hover:text-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
