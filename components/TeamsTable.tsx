'use client'

import Image from 'next/image'
import { TeamChemRow, TeamBatteryEntry } from '@/lib/types'
import { fmtIp, fmt } from '@/lib/stats'

const TEAM_NAMES: Record<string, string> = {
  AZ: 'Arizona Diamondbacks', ATL: 'Atlanta Braves', BAL: 'Baltimore Orioles',
  BOS: 'Boston Red Sox', CHC: 'Chicago Cubs', CWS: 'Chicago White Sox',
  CIN: 'Cincinnati Reds', CLE: 'Cleveland Guardians', COL: 'Colorado Rockies',
  DET: 'Detroit Tigers', HOU: 'Houston Astros', KC: 'Kansas City Royals',
  LAA: 'Los Angeles Angels', LAD: 'Los Angeles Dodgers', MIA: 'Miami Marlins',
  MIL: 'Milwaukee Brewers', MIN: 'Minnesota Twins', NYM: 'New York Mets',
  NYY: 'New York Yankees', ATH: 'Oakland Athletics', PHI: 'Philadelphia Phillies',
  PIT: 'Pittsburgh Pirates', SD: 'San Diego Padres', SF: 'San Francisco Giants',
  SEA: 'Seattle Mariners', STL: 'St. Louis Cardinals', TB: 'Tampa Bay Rays',
  TEX: 'Texas Rangers', TOR: 'Toronto Blue Jays', WSH: 'Washington Nationals',
}

// Team abbreviation → MLB team ID for logo URLs
const TEAM_IDS: Record<string, number> = {
  ARI: 109, AZ: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CHW: 145, CWS: 145,
  CIN: 113, CLE: 114, CLG: 114, COL: 115, DET: 116, HOU: 117,
  KC: 118, KCR: 118, LAA: 108, LAD: 119, MIA: 146, MIL: 158,
  MIN: 142, NYM: 121, NYY: 147, OAK: 133, ATH: 133,
  PHI: 143, PIT: 134, SD: 135, SDP: 135, SEA: 136,
  SF: 137, SFG: 137, STL: 138, TB: 139, TBR: 139,
  TEX: 140, TOR: 141, WSH: 120, WSN: 120, WAS: 120,
}

function teamLogoUrl(team: string): string | null {
  const id = TEAM_IDS[team]
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : null
}

function headshot(playerId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${playerId}/headshot/67/current`
}

function chemColor(score: number): string {
  if (score === 50) return '#555'
  if (score > 50) {
    const t = (score - 50) / 50
    return `rgb(${Math.round(26 + t * (5 - 26))},${Math.round(26 + t * (150 - 26))},${Math.round(26 + t * (105 - 26))})`
  } else {
    const t = (50 - score) / 50
    return `rgb(${Math.round(26 + t * (220 - 26))},${Math.round(26 + t * (38 - 26))},${Math.round(26 + t * (38 - 26))})`
  }
}

function BatteryRow({ entry, kind }: { entry: TeamBatteryEntry; kind: 'best' | 'worst' }) {
  const isBest = kind === 'best'
  return (
    <div className={`px-4 py-3 ${isBest ? 'border-b border-[#ece8e1]' : ''}`}>
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`text-[10px] font-black uppercase tracking-widest ${isBest ? 'text-[#0a7a52]' : 'text-[#b02020]'}`}>
          {isBest ? '▲ Best' : '▼ Worst'}
        </span>
        <span className="text-[10px] text-[#bbb]">Chemistry</span>
      </div>

      {/* Players */}
      <div className="flex items-center gap-3">
        {/* Pitcher */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-[#f0ede8] border border-[#e0dbd2]">
            <Image
              src={headshot(entry.pitcher_id)}
              alt={entry.pitcher_name}
              width={40} height={40}
              className="object-cover w-full h-full" style={{ objectPosition: 'center 18%' }}
              unoptimized
            />
          </div>
          <span className="text-[9px] text-[#999] font-medium text-center leading-tight max-w-[48px] truncate">P</span>
        </div>

        {/* Names + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-sm font-semibold text-[#1a1a1a] truncate">{entry.pitcher_name}</span>
            <span className="text-[#ccc] text-xs">/</span>
            <span className="text-sm text-[#555] truncate">{entry.catcher_name}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs font-black font-mono" style={{ color: chemColor(entry.chem_score) }}>
              {entry.chem_score}
            </span>
            <span className="text-[10px] text-[#bbb]">·</span>
            <span className="text-[10px] text-[#999]">Overall Pitcher FIP</span>
            <span className="text-xs font-mono text-[#444]">{fmt(entry.pitcher_fip)}</span>
            <span className="text-[10px] text-[#bbb]">·</span>
            <span className="text-[10px] text-[#999]">Battery FIP</span>
            <span className="text-xs font-mono text-[#444]">{fmt(entry.battery_fip)}</span>
            <span className="text-[10px] text-[#bbb]">·</span>
            <span className="text-[10px] text-[#999]">{fmtIp(entry.ip)} IP</span>
          </div>
        </div>

        {/* Catcher */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-[#f0ede8] border border-[#e0dbd2]">
            <Image
              src={headshot(entry.catcher_id)}
              alt={entry.catcher_name}
              width={40} height={40}
              className="object-cover w-full h-full" style={{ objectPosition: 'center 18%' }}
              unoptimized
            />
          </div>
          <span className="text-[9px] text-[#999] font-medium text-center leading-tight max-w-[48px] truncate">C</span>
        </div>
      </div>
    </div>
  )
}

function TeamCard({ row }: { row: TeamChemRow }) {
  const logo = teamLogoUrl(row.team)
  return (
    <div className="bg-white border border-[#ddd8d0] rounded-2xl shadow-sm overflow-hidden">
      {/* Team header */}
      <div className="px-4 py-3 border-b border-[#ece8e1] flex items-center gap-3 bg-[#faf9f7]">
        {logo ? (
          <Image src={logo} alt={row.team} width={32} height={32} className="object-contain shrink-0" unoptimized />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#e8e4de] shrink-0" />
        )}
        <span className="text-sm font-black tracking-tight text-[#1a1a1a]">{TEAM_NAMES[row.team] ?? row.team}</span>
      </div>

      {/* Batteries */}
      {row.best
        ? <BatteryRow entry={row.best} kind="best" />
        : <div className="px-4 py-3 text-sm text-[#ccc] border-b border-[#ece8e1]">No qualifying battery</div>
      }
      {row.worst
        ? <BatteryRow entry={row.worst} kind="worst" />
        : <div className="px-4 py-3 text-sm text-[#ccc]">No qualifying battery</div>
      }
    </div>
  )
}

interface Props {
  rows: TeamChemRow[]
  loading: boolean
}

export function TeamsTable({ rows, loading }: Props) {
  if (!loading && rows.length === 0) {
    return <p className="text-center text-sm text-[#aaa] py-12">No data available.</p>
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${loading ? 'opacity-50' : ''}`}>
      {rows.map(row => <TeamCard key={row.team} row={row} />)}
    </div>
  )
}
