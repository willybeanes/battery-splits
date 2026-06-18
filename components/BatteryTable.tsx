'use client'

import { BatteryRow, SortCol, SortDir } from '@/lib/types'
import { StatHeader } from './StatHeader'
import { fmt, fmtIp, fipColor } from '@/lib/stats'

function plusColor(val: number | null): string {
  if (val === null) return '#ccc'
  if (val >= 115) return '#0a7a52'
  if (val >= 105) return '#2a9d6a'
  if (val >= 95)  return '#888'
  if (val >= 85)  return '#c0392b'
  return '#8b0000'
}

function chemColor(score: number): string {
  if (score === 50) return '#1a1a1a'
  if (score > 50) {
    const t = (score - 50) / 50
    return `rgb(${Math.round(26 + t * (5 - 26))},${Math.round(26 + t * (150 - 26))},${Math.round(26 + t * (105 - 26))})`
  } else {
    const t = (50 - score) / 50
    return `rgb(${Math.round(26 + t * (220 - 26))},${Math.round(26 + t * (38 - 26))},${Math.round(26 + t * (38 - 26))})`
  }
}

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
              <StatHeader col="fip"        label="FIP"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <StatHeader col="chem_score" label="Chem" sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Chemistry Score: percentile rank of (pitcher season FIP − combo FIP). Requires 20 IP together. 100 = catcher most helps pitcher's FIP." />
              <StatHeader col="battery_stuff_plus"    label="Stf+"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Pitch-weighted Stuff+ for this battery (2026 only)" />
              <StatHeader col="battery_loc_plus"      label="Loc+"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Pitch-weighted Location+ for this battery (2026 only)" />
              <StatHeader col="battery_pitching_plus" label="Pit+"  sortCol={sortCol} sortDir={sortDir} onSort={onSort} title="Pitch-weighted Pitching+ for this battery (2026 only)" />
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={15} className="px-4 py-12 text-center text-[#aaa] text-sm">
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
                <td className="px-3 py-2.5 text-right font-mono text-sm">
                  {row.chem_score == null
                    ? <span className="text-[#ccc]">—</span>
                    : <span className="font-semibold" style={{ color: chemColor(row.chem_score) }}>{row.chem_score}</span>
                  }
                </td>
                {(['battery_stuff_plus', 'battery_loc_plus', 'battery_pitching_plus'] as const).map(k => (
                  <td key={k} className="px-3 py-2.5 text-right font-mono text-sm font-semibold">
                    <span style={{ color: plusColor(row[k]) }}>{row[k] ?? '—'}</span>
                  </td>
                ))}
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
