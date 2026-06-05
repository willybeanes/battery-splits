'use client'

const MLB_TEAMS = [
  'ARI','ATL','BAL','BOS','CHC','CWS','CIN','CLE','COL','DET',
  'HOU','KC','LAA','LAD','MIA','MIL','MIN','NYM','NYY','OAK',
  'PHI','PIT','SD','SF','SEA','STL','TB','TEX','TOR','WSH',
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
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </div>
  )
}
