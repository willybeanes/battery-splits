export type Season = number
export type FilterMode = 'all' | 'was' | 'wasnt'
export type TabName = 'pitcher' | 'catcher' | 'battery'
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
