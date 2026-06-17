'use client'

import { TeamChemRow } from '@/lib/types'
import { fmtIp } from '@/lib/stats'

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
  rows: TeamChemRow[]
  loading: boolean
}

export function TeamsTable({ rows, loading }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e0dbd2]">
      <table className="w-full border-collapse min-w-[700px]">
        <thead>
          <tr className="bg-[#f5f2ed] border-b border-[#e0dbd2]">
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-left w-16">Team</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-left">Best Battery</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-20">Chem</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-16">IP</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-left">Worst Battery</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-20">Chem</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#999] text-center w-16">IP</th>
          </tr>
        </thead>
        <tbody className={loading ? 'opacity-50' : ''}>
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-[#aaa] text-sm">
                No data available.
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr key={row.team} className="border-b border-[#ece8e1] hover:bg-[#f8f6f2] transition-colors">
              <td className="px-4 py-3 text-sm font-black font-mono text-[#1a1a1a]">{row.team}</td>

              {/* Best */}
              {row.best ? (
                <>
                  <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                    <span className="font-semibold">{row.best.pitcher_name}</span>
                    <span className="text-[#aaa] mx-1.5">/</span>
                    <span className="text-[#555]">{row.best.catcher_name}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm font-semibold" style={{ color: chemColor(row.best.chem_score) }}>
                    {row.best.chem_score}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-[#999]">{fmtIp(row.best.ip)}</td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 text-sm text-[#ccc]">—</td>
                  <td className="px-4 py-3 text-center text-[#ccc]">—</td>
                  <td className="px-4 py-3 text-center text-[#ccc]">—</td>
                </>
              )}

              {/* Worst */}
              {row.worst ? (
                <>
                  <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                    <span className="font-semibold">{row.worst.pitcher_name}</span>
                    <span className="text-[#aaa] mx-1.5">/</span>
                    <span className="text-[#555]">{row.worst.catcher_name}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm font-semibold" style={{ color: chemColor(row.worst.chem_score) }}>
                    {row.worst.chem_score}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-[#999]">{fmtIp(row.worst.ip)}</td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 text-sm text-[#ccc]">—</td>
                  <td className="px-4 py-3 text-center text-[#ccc]">—</td>
                  <td className="px-4 py-3 text-center text-[#ccc]">—</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
