/**
 * Returns the prorated "qualified" IP threshold for a given season.
 * Formula: 1 IP per team game played (standard MLB qualifier).
 * For completed seasons, returns 162 (or 60 for 2020 shortened season).
 * For the current season, prorates based on days elapsed.
 */

const SEASON_DATES: Record<number, { start: string; end: string; games: number }> = {
  2000: { start: '2000-04-03', end: '2000-10-01', games: 162 },
  2001: { start: '2001-04-01', end: '2001-10-07', games: 162 },
  2002: { start: '2002-03-31', end: '2002-10-06', games: 162 },
  2003: { start: '2003-03-30', end: '2003-09-28', games: 162 },
  2004: { start: '2004-04-04', end: '2004-10-03', games: 162 },
  2005: { start: '2005-04-03', end: '2005-10-02', games: 162 },
  2006: { start: '2006-04-02', end: '2006-10-01', games: 162 },
  2007: { start: '2007-04-01', end: '2007-09-30', games: 162 },
  2008: { start: '2008-03-25', end: '2008-09-29', games: 162 },
  2009: { start: '2009-04-05', end: '2009-10-04', games: 162 },
  2010: { start: '2010-04-04', end: '2010-10-03', games: 162 },
  2011: { start: '2011-03-31', end: '2011-09-28', games: 162 },
  2012: { start: '2012-03-28', end: '2012-10-03', games: 162 },
  2013: { start: '2013-03-31', end: '2013-09-29', games: 162 },
  2014: { start: '2014-03-22', end: '2014-09-28', games: 162 },
  2015: { start: '2015-04-05', end: '2015-10-04', games: 162 },
  2016: { start: '2016-04-03', end: '2016-10-02', games: 162 },
  2017: { start: '2017-04-02', end: '2017-10-01', games: 162 },
  2018: { start: '2018-03-29', end: '2018-09-30', games: 162 },
  2019: { start: '2019-03-20', end: '2019-09-29', games: 162 },
  2020: { start: '2020-07-23', end: '2020-09-27', games:  60 }, // COVID shortened
  2021: { start: '2021-04-01', end: '2021-10-03', games: 162 },
  2022: { start: '2022-04-07', end: '2022-10-05', games: 162 },
  2023: { start: '2023-03-30', end: '2023-10-01', games: 162 },
  2024: { start: '2024-03-20', end: '2024-09-29', games: 162 },
  2025: { start: '2025-03-20', end: '2025-09-28', games: 162 },
  2026: { start: '2026-03-26', end: '2026-09-27', games: 162 },
}

export function qualifiedIp(season: number): number {
  const s = SEASON_DATES[season]
  if (!s) return 162

  const today = new Date()
  const start = new Date(s.start)
  const end   = new Date(s.end)

  if (today < start) return 1
  if (today > end)   return s.games

  const elapsed = today.getTime() - start.getTime()
  const total   = end.getTime()   - start.getTime()

  return Math.max(1, Math.round((elapsed / total) * s.games))
}
