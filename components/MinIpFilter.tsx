'use client'

import { qualifiedIp } from '@/lib/qualified'

const BASE_OPTIONS = [0, 5, 10, 20, 30, 50, 75, 100]

// -1 is the sentinel value meaning "Qualified" (prorated)
export const QUALIFIED_SENTINEL = -1

interface Props {
  value: number
  onChange: (n: number) => void
  season: number
  hideQualified?: boolean
}

export function MinIpFilter({ value, onChange, season, hideQualified }: Props) {
  const qualIp = qualifiedIp(season)
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Min IP</span>
      <select
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 text-sm text-[#1a1a1a] outline-none cursor-pointer"
      >
        {BASE_OPTIONS.map(n => (
          <option key={n} value={n}>{n}</option>
        ))}
        {!hideQualified && (
          <option value={QUALIFIED_SENTINEL}>Qualified ({qualIp} IP)</option>
        )}
      </select>
    </div>
  )
}
