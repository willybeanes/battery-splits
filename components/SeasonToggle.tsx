'use client'

import { useRef, useEffect, useState } from 'react'

const SEASONS = Array.from({ length: 19 }, (_, i) => 2026 - i) // 2026 down to 2008

interface Props {
  value: number[]
  onChange: (seasons: number[]) => void
  singleSelect?: boolean
}

function label(seasons: number[]): string {
  if (seasons.length === 0) return 'Select…'
  if (seasons.length === 1) return String(seasons[0])
  const sorted = [...seasons].sort((a, b) => a - b)
  const isRange = sorted.every((s, i) => i === 0 || s === sorted[i - 1] + 1)
  if (isRange) return `${sorted[0]}–${sorted[sorted.length - 1]}`
  return `${seasons.length} Seasons`
}

export function SeasonToggle({ value, onChange, singleSelect = false }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(season: number) {
    if (singleSelect) {
      onChange([season])
      setOpen(false)
      return
    }
    if (value.includes(season)) {
      if (value.length === 1) return // keep at least one selected
      onChange(value.filter(s => s !== season))
    } else {
      onChange([...value, season])
    }
  }

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Season</span>
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 text-sm font-semibold text-[#1a1a1a] outline-none cursor-pointer flex items-center gap-2 hover:border-[#aaa] transition-colors min-w-[90px]"
        >
          <span className="flex-1 text-left">{label(value)}</span>
          <svg className={`w-3.5 h-3.5 text-[#aaa] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full mt-1 left-0 bg-white border border-[#d0cbc3] rounded-lg shadow-lg z-50 overflow-hidden py-1 min-w-[110px] max-h-72 overflow-y-auto">
            {SEASONS.map(s => {
              const checked = value.includes(s)
              return (
                <label key={s} className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-[#f5f2ed] transition-colors select-none">
                  <input
                    type={singleSelect ? 'radio' : 'checkbox'}
                    checked={checked}
                    onChange={() => toggle(s)}
                    className="accent-[#1a1a1a] w-3.5 h-3.5"
                  />
                  <span className={`font-mono ${checked ? 'text-[#1a1a1a] font-semibold' : 'text-[#555]'}`}>{s}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
