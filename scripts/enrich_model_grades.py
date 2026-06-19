"""
Enrich pitcher_game_logs with per-game model grades (Stuff+, Location+, Pitching+)
fetched from Fangraphs via fg-proxy.

Usage:
  python3 scripts/enrich_model_grades.py           # all pitchers in 2026
  python3 scripts/enrich_model_grades.py 669160    # single pitcher by MLBAM ID
"""

import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env.local")

SUPABASE_URL         = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
FG_PROXY             = "https://fg-proxy.vercel.app/api/fg-gamelog"

# Load MLBAM → fgid map
MAP_PATH = Path(__file__).parent.parent / "public" / "mlbam-fg-map.json"
with open(MAP_PATH) as f:
    MLBAM_TO_FG: dict[str, dict] = json.load(f)


def fetch_fg_gamelog(fgid: int) -> list[dict]:
    """Fetch Fangraphs type=52 game log for a pitcher via fg-proxy."""
    url = f"{FG_PROXY}?path=/api/players/game-log&playerid={fgid}&position=P&type=52&season=2026"
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        data = r.json()
        games = data.get("mlb", data) if isinstance(data, dict) else data
        # Skip the season-total row (date contains "2050")
        return [g for g in (games or []) if "2050" not in str(g.get("Date", ""))]
    except Exception as e:
        print(f"    WARNING: fg-proxy fetch failed: {e}")
        return []


def _parse_fg_date(raw: str) -> str:
    """Extract YYYY-MM-DD from Fangraphs Date field (HTML anchor or plain string)."""
    import re
    m = re.search(r'date=(\d{4}-\d{2}-\d{2})', raw)
    if m:
        return m.group(1)
    m = re.search(r'\d{4}-\d{2}-\d{2}', raw)
    return m.group(0) if m else ""


def build_date_map(games: list[dict]) -> dict[str, dict]:
    """Build gamedate → model grades map from Fangraphs game list."""
    result = {}
    for g in games:
        date = _parse_fg_date(str(g.get("Date") or g.get("gamedate") or ""))
        if not date:
            continue
        pitches = int(g.get("Pitches") or 0)
        result[date] = {
            "sp_stuff":    round(g["sp_stuff"],    2) if g.get("sp_stuff")    else None,
            "sp_location": round(g["sp_location"], 2) if g.get("sp_location") else None,
            "sp_pitching": round(g["sp_pitching"], 2) if g.get("sp_pitching") else None,
            "pitches_fg":  pitches if pitches else None,
        }
    return result


def mlbam_lookup_fallback(mlbam_id: int) -> dict | None:
    """Look up a player via MLB Stats API + Fangraphs playerSearch when not in local map."""
    try:
        r = requests.get(
            f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}?fields=people,fullName,firstName,lastName",
            timeout=10,
        )
        r.raise_for_status()
        person = r.json()["people"][0]
        first = person.get("firstName", "")
        last  = person.get("lastName", "")
        full  = person.get("fullName", f"{first} {last}").strip()
    except Exception as e:
        print(f"    MLB API lookup failed for {mlbam_id}: {e}")
        return None

    # Search Fangraphs via fg-proxy
    try:
        sr = requests.get(
            f"{FG_PROXY}?path=/api/players/playerSearch&playerName={requests.utils.quote(last)}&position=P",
            timeout=15,
        )
        sr.raise_for_status()
        results = sr.json() or []
        for p in results:
            if str(p.get("playerid", "")).isdigit() and (
                p.get("Name", "").lower() == full.lower()
                or (last.lower() in p.get("Name", "").lower() and first.lower() in p.get("Name", "").lower())
            ):
                fgid = int(p["playerid"])
                entry = {"fg": fgid, "first": first, "last": last}
                MLBAM_TO_FG[str(mlbam_id)] = entry
                # Persist to map file
                with open(MAP_PATH, "w") as f:
                    json.dump(MLBAM_TO_FG, f)
                print(f"    Resolved via fallback: {full} → fgid={fgid} (cached)")
                return entry
    except Exception as e:
        print(f"    Fangraphs playerSearch failed for {full}: {e}")

    print(f"    Could not resolve fgid for {full} ({mlbam_id})")
    return None


def enrich_pitcher(db, mlbam_id: int) -> int:
    """Fetch grades for one pitcher and update all their 2026 game log rows. Returns rows updated."""
    entry = MLBAM_TO_FG.get(str(mlbam_id))
    if not entry:
        entry = mlbam_lookup_fallback(mlbam_id)
    if not entry:
        print(f"  {mlbam_id}: not in mlbam-fg-map, skipping")
        return 0

    fgid = entry["fg"]
    name = f"{entry['first']} {entry['last']}"
    games = fetch_fg_gamelog(fgid)
    if not games:
        print(f"  {name} ({mlbam_id}): no Fangraphs game log data")
        return 0

    date_map = build_date_map(games)

    # Fetch this pitcher's game log rows from DB
    res = db.table("pitcher_game_logs").select("id,game_date").eq("pitcher_id", mlbam_id).eq("season", 2026).execute()
    rows = res.data or []

    updated = 0
    for row in rows:
        game_date = str(row["game_date"])
        grades = date_map.get(game_date)
        if not grades:
            continue
        db.table("pitcher_game_logs").update(grades).eq("id", row["id"]).execute()
        updated += 1

    print(f"  {name} ({mlbam_id}): fgid={fgid}, {len(games)} FG games, {updated}/{len(rows)} DB rows updated")
    return updated


def main():
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Determine which pitcher IDs to enrich
    if len(sys.argv) > 1:
        mlbam_ids = [int(a) for a in sys.argv[1:] if a.isdigit()]
    else:
        # All unique pitcher IDs in 2026 game logs (paginate past Supabase 1000-row limit)
        all_rows: list[dict] = []
        offset = 0
        page_size = 1000
        while True:
            res = db.table("pitcher_game_logs").select("pitcher_id").eq("season", 2026).range(offset, offset + page_size - 1).execute()
            batch = res.data or []
            all_rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        mlbam_ids = list({r["pitcher_id"] for r in all_rows})
        print(f"Found {len(mlbam_ids)} pitchers in 2026 game logs")

    total_updated = 0
    for i, mlbam_id in enumerate(mlbam_ids, 1):
        print(f"[{i}/{len(mlbam_ids)}]", end=" ")
        total_updated += enrich_pitcher(db, mlbam_id)
        time.sleep(0.3)  # ~3 req/s to fg-proxy

    print(f"\nDone. {total_updated} total rows updated.")


if __name__ == "__main__":
    main()
