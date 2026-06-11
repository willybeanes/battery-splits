'use client'

import { Fragment, useState, useEffect } from 'react'
import { CatcherLeaderboardRow, CatcherSplitRow, SortCol, SortDir } from '@/lib/types'
import { StatHeader } from './StatHeader'
import { fmt, fmtIp, fipColor } from '@/lib/stats'

interface Props {
  rows: CatcherLeaderboardRow[]
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

function SplitRows({ catcherId, season }: { catcherId: number; season: number }) {
  const [splits, setSplits] = useState<CatcherSplitRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/catcher-splits?catcher_id=${catcherId}&season=${season}`)
      .then(r => r.json())
      .then(data => { setSplits(data); setLoading(false) })
      .catch(() => { setSplits([]); setLoading(false) })
  }, [catcherId, season])

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
        <td colSpan={10} className="px-6 py-3 text-xs text-[#aaa]">No pitcher splits available.</td>
      </tr>
    )
  }

  return (
    <>
      {splits.map(s => (
        <tr key={s.pitcher_id} className="bg-[#faf8f5] border-b border-[#ede8e1]">
          <td />
          <td className="px-3 py-2 text-xs text-[#555] pl-9 whitespace-nowrap">↳ {s.pitcher_name}</td>
          <td className="px-3 py-2 text-xs font-mono text-[#999]">{s.pitcher_team ?? '—'}</td>
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

export function CatcherTable({ rows, total, page, pageSize, sortCol, sortDir, onSort, onPage, loading, season }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const totalPages = Math.ceil(total / pageSize)
  const startRank = (page - 1) * pageSize + 1

  function toggleExpand(id: number) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-[#e0dbd2]">
        <table className="w-full border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-[#f5f2ed] border-b border-[#e0dbd2]">
              <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-10">#</th>
              <StatHeader col="catcher_name" label="Catcher" sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="catcher_team" label="Team"    sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="bf"    label="BF"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Batters Faced (pitchers threw to this catcher)" />
              <StatHeader col="ip"    label="IP"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="era"   label="ERA"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="ERA of pitchers when this catcher was catching" />
              <StatHeader col="whip"  label="WHIP" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="k_pct" label="K%"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="bb_pct" label="BB%" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="fip"   label="FIP"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
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
              const isExpanded = expandedId === row.catcher_id
              return (
                <Fragment key={`${row.catcher_id}-${i}`}>
                  <tr
                    onClick={() => toggleExpand(row.catcher_id)}
                    className={`border-b border-[#ece8e1] hover:bg-[#f8f6f2] transition-colors cursor-pointer select-none ${isExpanded ? 'bg-[#f5f2ed]' : ''}`}
                  >
                    <td className="px-3 py-2.5 text-center text-xs font-mono text-[#bbb]">{startRank + i}</td>
                    <td className="px-3 py-2.5 text-left text-sm font-semibold text-[#1a1a1a] whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span className={`transition-transform text-[#bbb] text-[10px] inline-block ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {row.catcher_name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-left text-xs font-mono text-[#999]">{row.catcher_team ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{row.bf}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmtIp(row.ip)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.era)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.whip, 3)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.k_pct, 1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[#333]">{fmt(row.bb_pct, 1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm">
                      <span className={fipColor(row.fip)}>{fmt(row.fip)}</span>
                    </td>
                  </tr>
                  {isExpanded && <SplitRows catcherId={row.catcher_id} season={season} />}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[#999]">{startRank}–{Math.min(startRank + rows.length - 1, total)} of {total} catchers</span>
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
