'use client'

import { BatteryRow, SortCol, SortDir } from '@/lib/types'
import { StatHeader } from './StatHeader'
import { fmt, fmtIp, fipColor } from '@/lib/stats'

interface Props {
  rows: BatteryRow[]
  total: number
  page: number
  pageSize: number
  sortCol: SortCol
  sortDir: SortDir
  onSort: (col: SortCol) => void
  onPage: (p: number) => void
  loading: boolean
}

export function BatteryTable({ rows, total, page, pageSize, sortCol, sortDir, onSort, onPage, loading }: Props) {
  const totalPages = Math.ceil(total / pageSize)
  const startRank = (page - 1) * pageSize + 1

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-[#e0dbd2]">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-[#f5f2ed] border-b border-[#e0dbd2]">
              <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-10">#</th>
              <StatHeader col="pitcher_name" label="Pitcher"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="catcher_name" label="Catcher"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="pitcher_team" label="Team"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} align="left" />
              <StatHeader col="bf"    label="BF"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="ip"    label="IP"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="era"   label="ERA"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="whip"  label="WHIP" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="k_pct" label="K%"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="bb_pct" label="BB%" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="fip"   label="FIP"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-[#aaa] text-sm">
                  No data available for this filter.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={`${row.pitcher_id}-${row.catcher_id}`}
                className="border-b border-[#ece8e1] hover:bg-[#f8f6f2] transition-colors">
                <td className="px-3 py-2.5 text-center text-xs font-mono text-[#bbb]">{startRank + i}</td>
                <td className="px-3 py-2.5 text-left text-sm font-semibold text-[#1a1a1a] whitespace-nowrap">{row.pitcher_name}</td>
                <td className="px-3 py-2.5 text-left text-sm text-[#444] whitespace-nowrap">{row.catcher_name}</td>
                <td className="px-3 py-2.5 text-left text-xs font-mono text-[#999]">{row.pitcher_team ?? '—'}</td>
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
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[#999]">{startRank}–{Math.min(startRank + rows.length - 1, total)} of {total} combinations</span>
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
