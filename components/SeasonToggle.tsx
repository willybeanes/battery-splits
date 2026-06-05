'use client'

import { Season } from '@/lib/types'

interface Props {
  value: Season
  onChange: (s: Season) => void
}

export function SeasonToggle({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Season</span>
      <div className="flex rounded-lg overflow-hidden border border-[#d0cbc3]">
        {([2026, 2025] as Season[]).map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
              value === s
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-white text-[#666] hover:text-[#1a1a1a]'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
