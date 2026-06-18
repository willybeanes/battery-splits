-- Battery Splits schema
-- Run this in the Supabase SQL editor to initialize your database.

CREATE TABLE IF NOT EXISTS pitcher_catcher_stats (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  pitcher_id INTEGER NOT NULL,
  pitcher_name TEXT NOT NULL,
  pitcher_team TEXT,
  catcher_id INTEGER NOT NULL,        -- 0 = all catchers aggregate
  bf INTEGER DEFAULT 0,
  ip NUMERIC(6,1) DEFAULT 0,
  era NUMERIC(5,2),
  whip NUMERIC(5,3),
  k_pct NUMERIC(5,1),
  bb_pct NUMERIC(5,1),
  fip NUMERIC(5,2),
  xfip NUMERIC(5,2),
  hits INTEGER DEFAULT 0,
  hr INTEGER DEFAULT 0,
  bb INTEGER DEFAULT 0,
  so INTEGER DEFAULT 0,
  er INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, pitcher_id, catcher_id)
);

CREATE INDEX IF NOT EXISTS idx_pcs_season ON pitcher_catcher_stats(season);
CREATE INDEX IF NOT EXISTS idx_pcs_pitcher ON pitcher_catcher_stats(pitcher_id);
CREATE INDEX IF NOT EXISTS idx_pcs_catcher ON pitcher_catcher_stats(catcher_id);

CREATE TABLE IF NOT EXISTS catchers (
  mlbam_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  team TEXT,
  season INTEGER NOT NULL,
  PRIMARY KEY (mlbam_id, season)
);

CREATE INDEX IF NOT EXISTS idx_catchers_name ON catchers(name);

CREATE TABLE IF NOT EXISTS pitcher_game_logs (
  id BIGSERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  game_pk INTEGER NOT NULL,
  game_date DATE NOT NULL,
  pitcher_id INTEGER NOT NULL,
  pitcher_name TEXT NOT NULL,
  pitcher_team TEXT,
  opponent_team TEXT,
  catcher_id INTEGER NOT NULL,
  catcher_name TEXT,
  bf INTEGER DEFAULT 0,
  ip NUMERIC(6,1) DEFAULT 0,
  hits INTEGER DEFAULT 0,
  hr INTEGER DEFAULT 0,
  bb INTEGER DEFAULT 0,
  so INTEGER DEFAULT 0,
  er INTEGER DEFAULT 0,
  era NUMERIC(5,2),
  fip NUMERIC(5,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, game_pk, pitcher_id)
);

CREATE INDEX IF NOT EXISTS idx_pgl_pitcher ON pitcher_game_logs(pitcher_id);
CREATE INDEX IF NOT EXISTS idx_pgl_season ON pitcher_game_logs(season);
CREATE INDEX IF NOT EXISTS idx_pgl_date ON pitcher_game_logs(game_date);

-- Model grade columns (populated by enrich_model_grades.py)
ALTER TABLE pitcher_game_logs ADD COLUMN IF NOT EXISTS sp_stuff NUMERIC(6,2);
ALTER TABLE pitcher_game_logs ADD COLUMN IF NOT EXISTS sp_location NUMERIC(6,2);
ALTER TABLE pitcher_game_logs ADD COLUMN IF NOT EXISTS sp_pitching NUMERIC(6,2);
ALTER TABLE pitcher_game_logs ADD COLUMN IF NOT EXISTS pitches_fg INTEGER;
