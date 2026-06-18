'use client'

import { TabName } from '@/lib/types'

const TABS: { id: TabName; label: string; desc: string }[] = [
  { id: 'pitcher', label: 'Pitcher',  desc: 'Pitcher leaderboard with catcher filter' },
  { id: 'catcher', label: 'Catcher',  desc: 'Pitcher stats aggregated by catcher' },
  { id: 'battery', label: 'Battery',  desc: 'Every pitcher–catcher combination' },
  { id: 'teams',   label: 'Teams',    desc: 'Best and worst chemistry battery per team' },
  { id: 'games',   label: 'Games',    desc: 'Game-by-game log for a pitcher (2026)' },
]

interface Props {
  value: TabName
  onChange: (t: TabName) => void
}

export function TabNav({ value, onChange }: Props) {
  return (
    <div className="flex gap-0 border-b border-[#e0dbd2]">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.desc}
          className={`px-5 py-3 text-sm font-bold transition-colors border-b-2 -mb-px ${
            value === t.id
              ? 'border-[#1a1a1a] text-[#1a1a1a]'
              : 'border-transparent text-[#999] hover:text-[#444]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
