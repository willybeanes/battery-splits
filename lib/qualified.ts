/**
 * Returns the prorated "qualified" IP threshold for a given season.
 * Formula: 1 IP per team game played (standard MLB qualifier).
 * For completed seasons, returns 162.
 * For the current season, prorates based on days elapsed.
 */

const SEASON_DATES: Record<number, { start: string; end: string }> = {
  2025: { start: '2025-03-20', end: '2025-09-28' },
  2026: { start: '2026-03-26', end: '2026-09-27' },
}

const SEASON_GAMES = 162

export function qualifiedIp(season: number): number {
  const dates = SEASON_DATES[season]
  if (!dates) return SEASON_GAMES

  const today = new Date()
  const start = new Date(dates.start)
  const end   = new Date(dates.end)

  // Season not started yet
  if (today < start) return 1

  // Season complete
  if (today > end) return SEASON_GAMES

  const elapsed = today.getTime() - start.getTime()
  const total   = end.getTime()   - start.getTime()

  return Math.max(1, Math.round((elapsed / total) * SEASON_GAMES))
}
