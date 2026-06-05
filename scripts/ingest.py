"""
Battery Splits — Statcast ingest script.

Pulls pitch-level data from Baseball Savant, aggregates per pitcher+catcher+season,
and upserts into Supabase.
"""

import os
import io
import time
import math
import requests
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

SEASONS = [2025, 2026]
FIP_CONSTANT = 3.15

# Events that record an out
OUT_EVENTS = {
    "strikeout", "strikeout_double_play",
    "field_out", "force_out", "grounded_into_double_play",
    "double_play", "triple_play", "sac_fly", "sac_bunt",
    "fielders_choice_out", "caught_stealing_2b", "caught_stealing_3b",
    "caught_stealing_home", "other_out",
}

HIT_EVENTS = {"single", "double", "triple", "home_run"}
WALK_EVENTS = {"walk", "intent_walk"}
K_EVENTS = {"strikeout", "strikeout_double_play"}

# Baseball Savant chunks by team to avoid timeout on large pulls
MLB_TEAMS = [
    "ARI","ATL","BAL","BOS","CHC","CWS","CIN","CLE","COL","DET",
    "HOU","KC","LAA","LAD","MIA","MIL","MIN","NYM","NYY","OAK",
    "PHI","PIT","SD","SF","SEA","STL","TB","TEX","TOR","WSH",
]


from datetime import date, timedelta

def season_date_chunks(season: int, days: int = 14) -> list[tuple[str, str]]:
    """Return (date_from, date_to) pairs covering the season in chunks."""
    start = date(season, 3, 20)
    end = date(season, 10, 5)
    # Don't go past today
    today = date.today()
    if end > today:
        end = today
    chunks = []
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=days - 1), end)
        chunks.append((cur.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        cur = chunk_end + timedelta(days=1)
    return chunks


def fetch_statcast(season: int, date_from: str, date_to: str) -> pd.DataFrame | None:
    url = (
        "https://baseballsavant.mlb.com/statcast_search/csv"
        f"?all=true&type=details&player_type=pitcher"
        f"&game_date_gt={date_from}&game_date_lt={date_to}"
        "&min_pitches=0&sort_col=pitches&sort_order=desc"
    )
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=180)
            resp.raise_for_status()
            content = resp.text.strip()
            if not content or content.startswith("<!"):
                return None
            df = pd.read_csv(io.StringIO(content), low_memory=False)
            if df.empty or "pitcher" not in df.columns:
                return None
            if len(df) >= 24900:
                print(f"\n  WARNING: {date_from}→{date_to} hit row cap ({len(df)} rows) — shrink chunk size!")
            return df
        except Exception as e:
            print(f"  Attempt {attempt+1} failed for {date_from}→{date_to}: {e}")
            time.sleep(5 * (attempt + 1))
    return None


def get_catcher_name(mlbam_id: int, cache: dict) -> str:
    if mlbam_id in cache:
        return cache[mlbam_id]
    try:
        resp = requests.get(
            f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}?fields=people,fullName",
            timeout=10,
        )
        data = resp.json()
        name = data["people"][0]["fullName"]
    except Exception:
        name = f"Player {mlbam_id}"
    cache[mlbam_id] = name
    return name


def count_outs(events: pd.Series) -> int:
    total = 0
    for ev in events.dropna():
        ev = str(ev).lower()
        if ev in OUT_EVENTS:
            total += 1
        elif ev == "grounded_into_double_play" or ev == "strikeout_double_play":
            total += 2  # already counted above via set; correct for DP
    # Re-count properly: each PA event counts as 1 out if in set, grounded_into_double_play = 2
    return total


def safe_rate(num, denom):
    if not denom or math.isnan(denom) or denom == 0:
        return None
    result = num / denom
    if math.isnan(result) or math.isinf(result):
        return None
    return round(result, 3)


def aggregate(df: pd.DataFrame, season: int) -> list[dict]:
    """Aggregate pitch-level data to pitcher+catcher+season rows."""
    required = {"pitcher", "fielder_2", "at_bat_number", "events", "game_pk"}
    if not required.issubset(df.columns):
        missing = required - set(df.columns)
        print(f"  Missing columns: {missing}")
        return []

    df = df.copy()
    # Normalize pitcher name column (Savant uses "player_name" not "pitcher_name")
    if "player_name" in df.columns and "pitcher_name" not in df.columns:
        df["pitcher_name"] = df["player_name"]
    df["fielder_2"] = pd.to_numeric(df["fielder_2"], errors="coerce").fillna(0).astype(int)
    df["pitcher"] = pd.to_numeric(df["pitcher"], errors="coerce").dropna().astype(int)
    df["events"] = df["events"].fillna("")

    # One row per plate appearance (last pitch of each AB)
    pa_df = df.sort_values("pitch_number").groupby(
        ["pitcher", "at_bat_number", "game_pk"], as_index=False
    ).last()

    rows = []
    for (pitcher_id, catcher_id), group in pa_df.groupby(["pitcher", "fielder_2"]):
        pitcher_name = group["pitcher_name"].iloc[0] if "pitcher_name" in group.columns else str(pitcher_id)
        # Determine pitcher's actual team: home pitchers pitch in "Bot" innings, away in "Top"
        if "inning_topbot" in group.columns and "home_team" in group.columns and "away_team" in group.columns:
            row0 = group.iloc[0]
            if str(row0.get("inning_topbot", "")).strip().lower() == "bot":
                pitcher_team = row0["away_team"]
            else:
                pitcher_team = row0["home_team"]
        elif "home_team" in group.columns:
            pitcher_team = group["home_team"].iloc[0]
        else:
            pitcher_team = None

        events = group["events"].str.lower()
        bf = len(group)

        outs = 0
        for ev in events:
            if ev in OUT_EVENTS:
                outs += 1
            if ev in ("grounded_into_double_play", "strikeout_double_play"):
                outs += 1  # extra out for double plays
        ip = round(outs / 3, 1)

        hits = int((events.isin(HIT_EVENTS)).sum())
        hr = int((events == "home_run").sum())
        bb = int((events.isin(WALK_EVENTS)).sum())
        so = int((events.isin(K_EVENTS)).sum())

        # Earned runs: use post_bat_score delta when available
        er = 0
        if "post_bat_score" in group.columns and "bat_score" in group.columns:
            score_delta = pd.to_numeric(group["post_bat_score"], errors="coerce") - \
                          pd.to_numeric(group["bat_score"], errors="coerce")
            er = int(score_delta.clip(lower=0).sum())

        era = safe_rate(er * 9, ip)
        whip = safe_rate(hits + bb, ip)
        k_pct = safe_rate(so * 100, bf)
        bb_pct = safe_rate(bb * 100, bf)
        fip = round((13 * hr + 3 * bb - 2 * so) / ip + FIP_CONSTANT, 3) if ip else None

        # xFIP: estimate HR using xwOBA-derived fly ball HR rate
        xfip = None
        if "estimated_woba_using_speedangle" in group.columns and ip:
            xwoba_vals = pd.to_numeric(group["estimated_woba_using_speedangle"], errors="coerce").dropna()
            if len(xwoba_vals):
                # Crude proxy: expected HR ≈ total BF * league HR/BF rate scaled by xwOBA
                league_hr_rate = 0.032
                avg_xwoba = xwoba_vals.mean()
                expected_hr = bf * league_hr_rate * (avg_xwoba / 0.320) if avg_xwoba > 0 else bf * league_hr_rate
                xfip = round((13 * expected_hr + 3 * bb - 2 * so) / ip + FIP_CONSTANT, 3)

        rows.append({
            "season": season,
            "pitcher_id": int(pitcher_id),
            "pitcher_name": str(pitcher_name),
            "pitcher_team": str(pitcher_team) if pitcher_team else None,
            "catcher_id": int(catcher_id),
            "bf": bf,
            "ip": ip,
            "era": era,
            "whip": whip,
            "k_pct": k_pct,
            "bb_pct": bb_pct,
            "fip": fip,
            "xfip": xfip,
            "hits": hits,
            "hr": hr,
            "bb": bb,
            "so": so,
            "er": er,
        })
    return rows


def merge_rows(existing: list[dict], new_rows: list[dict]) -> list[dict]:
    """Merge rows by (pitcher_id, catcher_id), summing counting stats and re-deriving rates."""
    index: dict[tuple, dict] = {}
    for row in existing + new_rows:
        key = (row["pitcher_id"], row["catcher_id"], row["season"])
        if key not in index:
            index[key] = {**row, "bf": 0, "ip": 0.0, "hits": 0, "hr": 0, "bb": 0, "so": 0, "er": 0}
        r = index[key]
        for col in ("bf", "hits", "hr", "bb", "so", "er"):
            r[col] += row.get(col, 0) or 0
        r["ip"] = round((r["ip"] or 0) + (row.get("ip") or 0), 1)
        r["pitcher_name"] = row["pitcher_name"]
        r["pitcher_team"] = row.get("pitcher_team")

    result = []
    for r in index.values():
        ip = r["ip"]
        bf = r["bf"]
        r["era"] = safe_rate(r["er"] * 9, ip)
        r["whip"] = safe_rate(r["hits"] + r["bb"], ip)
        r["k_pct"] = safe_rate(r["so"] * 100, bf)
        r["bb_pct"] = safe_rate(r["bb"] * 100, bf)
        r["fip"] = round((13 * r["hr"] + 3 * r["bb"] - 2 * r["so"]) / ip + FIP_CONSTANT, 3) if ip else None
        result.append(r)
    return result


def build_totals(rows: list[dict]) -> list[dict]:
    """Build catcher_id=0 aggregate rows for each pitcher+season."""
    totals: dict[tuple, dict] = {}
    for row in rows:
        if row["catcher_id"] == 0:
            continue
        key = (row["pitcher_id"], row["season"])
        if key not in totals:
            totals[key] = {
                **row,
                "catcher_id": 0,
                "bf": 0, "ip": 0.0, "hits": 0, "hr": 0, "bb": 0, "so": 0, "er": 0,
                "xfip": None,
            }
        t = totals[key]
        for col in ("bf", "hits", "hr", "bb", "so", "er"):
            t[col] += row.get(col, 0) or 0
        t["ip"] = round((t["ip"] or 0) + (row.get("ip") or 0), 1)

    result = []
    for t in totals.values():
        ip = t["ip"]
        bf = t["bf"]
        t["era"] = safe_rate(t["er"] * 9, ip)
        t["whip"] = safe_rate(t["hits"] + t["bb"], ip)
        t["k_pct"] = safe_rate(t["so"] * 100, bf)
        t["bb_pct"] = safe_rate(t["bb"] * 100, bf)
        t["fip"] = round((13 * t["hr"] + 3 * t["bb"] - 2 * t["so"]) / ip + FIP_CONSTANT, 3) if ip else None
        result.append(t)
    return result


def upsert_stats(db: Client, rows: list[dict]):
    BATCH = 500
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i+BATCH]
        db.table("pitcher_catcher_stats").upsert(
            batch,
            on_conflict="season,pitcher_id,catcher_id"
        ).execute()
        print(f"  Upserted {min(i+BATCH, len(rows))}/{len(rows)} stat rows")


def upsert_catchers(db: Client, catcher_records: list[dict]):
    if not catcher_records:
        return
    db.table("catchers").upsert(
        catcher_records,
        on_conflict="mlbam_id,season"
    ).execute()
    print(f"  Upserted {len(catcher_records)} catcher records")


COMPLETED_SEASONS = [2025]  # seasons that are over — skip if data already exists

def season_is_complete(season: int) -> bool:
    end = date(season, 10, 5)
    return date.today() > end

def has_existing_data(db: Client, season: int) -> bool:
    result = db.table("pitcher_catcher_stats").select("id").eq("season", season).limit(1).execute()
    return len(result.data) > 0

def main():
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    name_cache: dict[int, str] = {}

    for season in SEASONS:
        print(f"\n=== Season {season} ===")

        # Skip completed seasons if we already have data
        if season_is_complete(season) and has_existing_data(db, season):
            print(f"  Season {season} is complete and data exists — skipping.")
            continue

        all_rows: list[dict] = []
        catcher_info: dict[int, dict] = {}

        # Always pull the full season so cumulative stats are correct
        chunks = season_date_chunks(season, days=3)
        print(f"  Pulling full season ({len(chunks)} chunks)")
        for i, (date_from, date_to) in enumerate(chunks):
            print(f"  [{i+1}/{len(chunks)}] {date_from} → {date_to}…", end=" ", flush=True)
            df = fetch_statcast(season, date_from, date_to)
            if df is None or df.empty:
                print("empty")
                continue
            print(f"{len(df):,} pitches")

            rows = aggregate(df, season)
            all_rows.extend(rows)

            # Collect catcher metadata
            if "fielder_2" in df.columns and "fielder_2_1" in df.columns:
                for _, row_df in df[["fielder_2", "fielder_2_1"]].drop_duplicates().iterrows():
                    cid = int(row_df["fielder_2"]) if pd.notna(row_df["fielder_2"]) else 0
                    if cid and cid not in catcher_info:
                        cname = str(row_df["fielder_2_1"]) if pd.notna(row_df.get("fielder_2_1")) else None
                        catcher_info[cid] = {"mlbam_id": cid, "name": cname, "team": None, "season": season}
            elif "fielder_2" in df.columns:
                for cid in df["fielder_2"].dropna().unique():
                    cid = int(cid)
                    if cid and cid not in catcher_info:
                        catcher_info[cid] = {"mlbam_id": cid, "name": None, "team": None, "season": season}

            time.sleep(1)  # be polite to Savant

        if not all_rows:
            print(f"  No data for {season}, skipping.")
            continue

        # Fill in catcher names we don't have from the CSV
        print(f"\n  Resolving {len(catcher_info)} catcher names…")
        catcher_records = []
        for cid, info in catcher_info.items():
            if not info["name"]:
                info["name"] = get_catcher_name(cid, name_cache)
                time.sleep(0.1)
            catcher_records.append(info)

        # Merge rows from all teams (a pitcher may have rows from multiple team chunks)
        print(f"  Merging {len(all_rows)} raw rows…")
        merged = merge_rows([], all_rows)

        # Build per-pitcher totals (catcher_id = 0)
        totals = build_totals(merged)
        all_final = merged + totals
        print(f"  Final: {len(all_final)} rows ({len(totals)} total rows)")

        upsert_stats(db, all_final)
        upsert_catchers(db, catcher_records)

    print("\nDone.")


if __name__ == "__main__":
    main()
