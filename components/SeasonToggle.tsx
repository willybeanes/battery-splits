'use client'

// All available seasons (newest first)
const SEASONS = Array.from({ length: 27 }, (_, i) => 2026 - i) // 2026 down to 2000

interface Props {
  value: number
  onChange: (s: number) => void
}

export function SeasonToggle({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Season</span>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 text-sm font-semibold text-[#1a1a1a] outline-none cursor-pointer"
      >
        {SEASONS.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
}
