export type Season = number
export type FilterMode = 'all' | 'was' | 'wasnt'
export type TabName = 'pitcher' | 'catcher' | 'battery' | 'teams' | 'games'
export type SortDir = 'asc' | 'desc'
export type SortCol = string

export interface PitcherRow {
  pitcher_id: number
  pitcher_name: string
  pitcher_team: string | null
  catcher_id?: number
  catcher_count?: number
  bf: number
  ip: number
  era: number | null
  whip: number | null
  k_pct: number | null
  bb_pct: number | null
  fip: number | null
  xfip: number | null
  hits: number
  hr: number
  bb: number
  so: number
  er: number
}

export interface CatcherLeaderboardRow {
  catcher_id: number
  catcher_name: string
  catcher_team: string | null
  bf: number
  ip: number
  era: number | null
  whip: number | null
  k_pct: number | null
  bb_pct: number | null
  fip: number | null
  hits: number
  hr: number
  bb: number
  so: number
  er: number
}

export interface BatteryRow {
  pitcher_id: number
  pitcher_name: string
  pitcher_team: string | null
  catcher_id: number
  catcher_name: string
  catcher_team: string | null
  bf: number
  ip: number
  era: number | null
  whip: number | null
  k_pct: number | null
  bb_pct: number | null
  fip: number | null
  xfip: number | null
  hits: number
  hr: number
  bb: number
  so: number
  er: number
  chem_score: number | null
}

export interface PitcherSplitRow {
  catcher_id: number
  catcher_name: string
  catcher_team: string | null
  bf: number
  ip: number
  era: number | null
  whip: number | null
  k_pct: number | null
  bb_pct: number | null
  fip: number | null
  xfip: number | null
}

export interface CatcherSplitRow {
  pitcher_id: number
  pitcher_name: string
  pitcher_team: string | null
  bf: number
  ip: number
  era: number | null
  whip: number | null
  k_pct: number | null
  bb_pct: number | null
  fip: number | null
  xfip: number | null
}

export interface Catcher {
  mlbam_id: number
  name: string
  team: string | null
}

export interface Pitcher {
  mlbam_id: number
  name: string
  team: string | null
}

export interface LeaderboardResponse {
  rows: PitcherRow[]
  total: number
  page: number
  pageSize: number
  catcherName?: string
  catcherBf?: number
}

export interface CatcherLeaderboardResponse {
  rows: CatcherLeaderboardRow[]
  total: number
  page: number
  pageSize: number
}

export interface BatteryLeaderboardResponse {
  rows: BatteryRow[]
  total: number
  page: number
  pageSize: number
}

export interface TeamBatteryEntry {
  pitcher_id: number
  pitcher_name: string
  catcher_id: number
  catcher_name: string
  chem_score: number
  ip: number
  battery_fip: number | null
  pitcher_fip: number | null
}

export interface TeamChemRow {
  team: string
  best: TeamBatteryEntry | null
  worst: TeamBatteryEntry | null
}

export interface TeamsLeaderboardResponse {
  rows: TeamChemRow[]
  total: number
}

export interface GameLogRow {
  id: number
  season: number
  game_pk: number
  game_date: string
  pitcher_id: number
  pitcher_name: string
  pitcher_team: string | null
  opponent_team: string | null
  catcher_id: number
  catcher_name: string | null
  bf: number
  ip: number
  hits: number
  hr: number
  bb: number
  so: number
  er: number
  era: number | null
  fip: number | null
  stuff_plus: number | null
  location_plus: number | null
  pitching_plus: number | null
  pitches: number | null
  strikes: number | null
  whiffs: number | null
  strike_pct: number | null
  whiff_pct: number | null
}

export interface GameLogResponse {
  rows: GameLogRow[]
  total: number
}
