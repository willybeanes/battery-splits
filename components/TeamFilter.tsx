'use client'

// Display label → DB value (Retrosheet abbreviations)
const MLB_TEAMS: { label: string; value: string }[] = [
  { label: 'ARI', value: 'AZ'  },
  { label: 'ATL', value: 'ATL' },
  { label: 'BAL', value: 'BAL' },
  { label: 'BOS', value: 'BOS' },
  { label: 'CHC', value: 'CHC' },
  { label: 'CWS', value: 'CWS' },
  { label: 'CIN', value: 'CIN' },
  { label: 'CLE', value: 'CLE' },
  { label: 'COL', value: 'COL' },
  { label: 'DET', value: 'DET' },
  { label: 'HOU', value: 'HOU' },
  { label: 'KC',  value: 'KC'  },
  { label: 'LAA', value: 'LAA' },
  { label: 'LAD', value: 'LAD' },
  { label: 'MIA', value: 'MIA' },
  { label: 'MIL', value: 'MIL' },
  { label: 'MIN', value: 'MIN' },
  { label: 'NYM', value: 'NYM' },
  { label: 'NYY', value: 'NYY' },
  { label: 'ATH', value: 'ATH' },
  { label: 'PHI', value: 'PHI' },
  { label: 'PIT', value: 'PIT' },
  { label: 'SD',  value: 'SD'  },
  { label: 'SF',  value: 'SF'  },
  { label: 'SEA', value: 'SEA' },
  { label: 'STL', value: 'STL' },
  { label: 'TB',  value: 'TB'  },
  { label: 'TEX', value: 'TEX' },
  { label: 'TOR', value: 'TOR' },
  { label: 'WSH', value: 'WSH' },
]

interface Props {
  value: string
  onChange: (team: string) => void
  label?: string
}

export function TeamFilter({ value, onChange, label = 'Team' }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 text-sm text-[#1a1a1a] outline-none cursor-pointer"
      >
        <option value="">All Teams</option>
        {MLB_TEAMS.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
    </div>
  )
}
