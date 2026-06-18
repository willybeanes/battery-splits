'use client'

import { GameLogRow } from '@/lib/types'
import { fmt, fmtIp } from '@/lib/stats'

function plusColor(val: number | null): string {
  if (val === null) return '#999'
  if (val >= 115) return '#0a7a52'
  if (val >= 105) return '#2a9d6a'
  if (val >= 95)  return '#888'
  if (val >= 85)  return '#c0392b'
  return '#8b0000'
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  rows: GameLogRow[]
  loading: boolean
}

export function GamesTable({ rows, loading }: Props) {
  if (!loading && rows.length === 0) {
    return <p className="text-center text-sm text-[#aaa] py-12">No games found for 2026.</p>
  }

  return (
    <div className={`overflow-x-auto ${loading ? 'opacity-50' : ''}`}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#ece8e1] text-[10px] font-bold uppercase tracking-wider text-[#999]">
            <th className="py-2 px-3 text-left">Date</th>
            <th className="py-2 px-3 text-left">Opp</th>
            <th className="py-2 px-3 text-left">Catcher</th>
            <th className="py-2 px-3 text-right">IP</th>
            <th className="py-2 px-3 text-right">BF</th>
            <th className="py-2 px-3 text-right">H</th>
            <th className="py-2 px-3 text-right">ER</th>
            <th className="py-2 px-3 text-right">BB</th>
            <th className="py-2 px-3 text-right">K</th>
            <th className="py-2 px-3 text-right">HR</th>
            <th className="py-2 px-3 text-right">ERA</th>
            <th className="py-2 px-3 text-right">FIP</th>
            <th className="py-2 px-3 text-right">Stf+</th>
            <th className="py-2 px-3 text-right">Loc+</th>
            <th className="py-2 px-3 text-right">Pit+</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              className="border-b border-[#f5f2ed] hover:bg-[#faf9f7] transition-colors"
            >
              <td className="py-2 px-3 font-medium text-[#1a1a1a] whitespace-nowrap">{fmtDate(row.game_date)}</td>
              <td className="py-2 px-3 text-[#555] whitespace-nowrap">{row.opponent_team ?? '—'}</td>
              <td className="py-2 px-3 text-[#555]">{row.catcher_name ?? '—'}</td>
              <td className="py-2 px-3 text-right font-mono text-[#1a1a1a]">{fmtIp(row.ip)}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.bf}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.hits}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.er}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.bb}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.so}</td>
              <td className="py-2 px-3 text-right font-mono text-[#555]">{row.hr}</td>
              <td className="py-2 px-3 text-right font-mono text-[#444]">{fmt(row.era)}</td>
              <td className="py-2 px-3 text-right font-mono text-[#444]">{fmt(row.fip)}</td>
              <td className="py-2 px-3 text-right font-mono font-bold" style={{ color: plusColor(row.stuff_plus) }}>{row.stuff_plus ?? '—'}</td>
              <td className="py-2 px-3 text-right font-mono font-bold" style={{ color: plusColor(row.location_plus) }}>{row.location_plus ?? '—'}</td>
              <td className="py-2 px-3 text-right font-mono font-bold" style={{ color: plusColor(row.pitching_plus) }}>{row.pitching_plus ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
