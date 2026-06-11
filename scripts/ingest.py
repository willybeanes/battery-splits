"""
Battery Splits — unified ingest script.

Backends
--------
  Retrosheet  (2000–2025): official play-by-play event files.
               Outs are counted from official event codes → IP matches
               Baseball Reference exactly.
  MLB Stats API (2026+):   real-time official play-by-play.
               Catcher tracked via defensive-switch events.

Usage
-----
  python3 scripts/ingest.py                        # all seasons
  python3 scripts/ingest.py --force 2024 2025      # re-ingest specific seasons
  python3 scripts/ingest.py --season 2026          # single season only
"""

import csv
import io
import json
import math
import os
import re
import sys
import time
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env.local")

SUPABASE_URL         = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

RETROSHEET_SEASONS   = list(range(2000, 2026))   # 2000–2025  (official Retrosheet data)
MLBAPI_SEASONS       = [2026]                     # 2026+      (MLB Stats API)
ALL_SEASONS          = RETROSHEET_SEASONS + MLBAPI_SEASONS

# Seasons whose data is complete; skip re-ingest unless --force is passed.
COMPLETED_SEASONS    = set(range(2000, 2026))     # all Retrosheet seasons are complete

FIP_CONSTANT = 3.15
CACHE_DIR    = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# ── Retrosheet team-code → standard abbreviation ─────────────────────────────

RETRO_TEAM = {
    "ANA": "LAA", "LAA": "LAA", "CAL": "LAA",
    "ARI": "ARI", "ATL": "ATL",
    "BAL": "BAL", "BOS": "BOS",
    "CHA": "CWS", "CHN": "CHC",
    "CIN": "CIN", "CLE": "CLE",
    "COL": "COL", "DET": "DET",
    "FLO": "MIA", "MIA": "MIA",
    "HOU": "HOU", "KCA": "KC",
    "LAN": "LAD", "MIL": "MIL",
    "MIN": "MIN", "MON": "MON",
    "NYA": "NYY", "NYN": "NYM",
    "OAK": "OAK", "ATH": "ATH",
    "PHI": "PHI", "PIT": "PIT",
    "SDN": "SD",  "SEA": "SEA",
    "SFN": "SF",  "SLN": "STL",
    "TBA": "TB",  "TEX": "TEX",
    "TOR": "TOR", "WAS": "WSH",
}

# ── Math helpers ──────────────────────────────────────────────────────────────

def outs_to_ip(outs: int) -> float:
    """17 outs → 5.2  (baseball notation, not decimal)."""
    return int(outs // 3) + (outs % 3) / 10

def ip_to_outs(ip: float) -> int:
    """5.2 → 17."""
    ip = ip or 0
    whole = int(ip)
    frac  = round((ip - whole) * 10)
    return whole * 3 + frac

def safe_rate(num, denom):
    if not denom or denom == 0:
        return None
    v = num / denom
    return None if (math.isnan(v) or math.isinf(v)) else round(v, 3)

def compute_rates(s: dict) -> dict:
    """Fill ip/era/whip/k_pct/bb_pct/fip from counting stats."""
    outs   = s["outs"]
    ip_dec = outs / 3
    bf     = s["bf"]
    s["ip"]     = outs_to_ip(outs)
    s["era"]    = safe_rate(s["er"]  * 9, ip_dec)
    s["whip"]   = safe_rate((s["hits"] + s["bb"]), ip_dec)
    s["k_pct"]  = safe_rate(s["so"]  * 100, bf)
    s["bb_pct"] = safe_rate(s["bb"]  * 100, bf)
    s["fip"]    = (
        round((13 * s["hr"] + 3 * s["bb"] - 2 * s["so"]) / ip_dec + FIP_CONSTANT, 3)
        if ip_dec else None
    )
    return s

# ── Chadwick register  (Retrosheet ID → MLBAM ID) ────────────────────────────

_CHADWICK_FILES = [f"people-{x}.csv" for x in "0123456789abcdef"]

def load_chadwick_register() -> dict[str, int]:
    """Download all Chadwick register shards and return {retro_id: mlbam_id}."""
    cache = CACHE_DIR / "chadwick_register.json"
    if cache.exists():
        with open(cache) as f:
            return json.load(f)

    print("  Downloading Chadwick register…", flush=True)
    mapping: dict[str, int] = {}
    base = "https://raw.githubusercontent.com/chadwickbureau/register/master/data/"
    for fname in _CHADWICK_FILES:
        try:
            resp = requests.get(base + fname, timeout=60)
            resp.raise_for_status()
            reader = csv.DictReader(io.StringIO(resp.text))
            for row in reader:
                retro = (row.get("key_retro") or "").strip()
                mlbam = (row.get("key_mlbam") or "").strip()
                if retro and mlbam:
                    try:
                        mapping[retro] = int(mlbam)
                    except ValueError:
                        pass
        except Exception as e:
            print(f"    Warning: could not fetch {fname}: {e}")

    with open(cache, "w") as f:
        json.dump(mapping, f)
    print(f"  Chadwick: {len(mapping):,} retro→mlbam mappings cached.")
    return mapping

# ── Retrosheet event-code parser ─────────────────────────────────────────────

def _has_error(s: str) -> bool:
    """Return True if s contains a Retrosheet error indicator inside parentheses.

    Handles both forms:
      (E2)        – error by fielder 2           → "(E" present
      (1E4)       – fielder 1 threw to 4, E by 4 → r'\\(\\d+E' matches
      (E1/TH)     – error, even after '/' splits  → "(E" present in truncated token
      (1E4/TH)    – same, digit-E form            → r'\\(\\d+E' matches truncated token
    """
    return "(E" in s or bool(re.search(r'\(\d+E', s))

def _all_parens_have_error(adv: str) -> bool:
    """Return True when EVERY parenthetical group in *adv* contains an 'E'.

    In Retrosheet advance notation 'X' means the runner is out, but an error
    can override that.  The key insight: if ALL parentheticals contain an error
    the putout was never completed and the runner is safe.  But if at least one
    parenthetical is clean (no 'E'), a subsequent fielder completed the out
    despite the error(s), so the runner IS out.

    Examples
    --------
    "1X2(6E4)"           [(6E4)]          all have E   → True  (runner safe)
    "1X3(4E6)(E6)"       [(4E6),(E6)]     all have E   → True  (runner safe)
    "1X3(75)(E6)"        [(75),(E6)]      (75) clean   → False (runner out)
    "1XH(E1/TH)(525)"    [(E1/TH),(525)]  (525) clean  → False (runner out)
    "1X3(E1/TH)(51)"     [(E1/TH),(51)]   (51) clean   → False (runner out)
    "BX3(365)(E7/TH)"    [(365),(E7/TH)]  (365) clean  → False (runner out)
    "1X2(24)"            [(24)]           no E         → False (runner out)
    "1X3"                []               no parens    → False (runner out)
    """
    parens = re.findall(r'\([^)]*\)', adv)
    if not parens:
        return False        # no fielding info → bare X means out
    return all("E" in p for p in parens)

def parse_retro_event(raw: str) -> dict:
    """
    Parse a Retrosheet event code string.

    Returns:
      is_batter_pa  bool  – False for CS, PO, SB, WP, BK, NP, etc.
      outs          int   – outs recorded on this play (0–3)
      hits          int   – 0 or 1
      hr            int   – 0 or 1
      bb            int   – 0 or 1 (walk or intentional walk)
      hbp           int   – 0 or 1
      so            int   – 0 or 1
      runs          int   – runs scored on the play (from advances field)
    """
    r = {"is_batter_pa": True, "outs": 0, "hits": 0, "hr": 0,
         "bb": 0, "hbp": 0, "so": 0, "runs": 0}

    code = raw.strip()

    # ── split BASIC/MODIFIERS.ADVANCES ────────────────────────────────────
    advances = ""
    if "." in code:
        dot = code.index(".")
        advances = code[dot + 1:]
        code = code[:dot]

    modifiers = ""
    if "/" in code:
        sl = code.index("/")
        modifiers = code[sl + 1:].upper()
        code = code[:sl]

    # Compound events: BASIC+SECONDARY  (e.g. K+WP, S8+WP, E3+WP)
    primary   = code.split("+")[0]
    secondary = code.split("+")[1].upper() if "+" in code else ""
    b = primary.upper()

    # ── count runs and runner outs from advances ──────────────────────────
    # Advance format: "2-H" = runner from 2nd scores; "2XH(82)" = runner out at home
    # We defer the runner-out counting until after the primary event is processed,
    # because we only want to add it when the primary recorded 0 outs (to avoid
    # double-counting with FC/DP plays which already account for the runner out).
    for adv in advances.split(";"):
        adv_clean = re.sub(r"\([^)]*\)", "", adv.strip())
        adv_up = adv_clean.upper()
        if adv_up.endswith("H") and "X" not in adv_up:
            r["runs"] += 1

    # ── non-batter-PA events ──────────────────────────────────────────────
    # Events that never produce runner outs in their advance field
    for prefix in ("NP", "DI", "FLE"):
        if b.startswith(prefix):
            r["is_batter_pa"] = False
            return r

    # Non-PA events whose advance field *can* contain runner outs (e.g. a runner
    # thrown out while a wild pitch / stolen-base attempt unfolds).
    for prefix in ("SB", "WP", "PB", "BK"):
        if b.startswith(prefix):
            r["is_batter_pa"] = False
            for adv in advances.split(";"):
                adv_clean = re.sub(r"\([^)]*\)", "", adv.strip()).upper()
                if "X" in adv_clean and adv_clean[0] in ("B", "1", "2", "3"):
                    if not _all_parens_have_error(adv):
                        r["outs"] += 1
            return r

    # OA = "Other Advance" — non-PA baserunning event; advances may contain
    # runner outs (e.g. OA.1X2(26) = runner thrown out at 2nd).
    if b.startswith("OA"):
        r["is_batter_pa"] = False
        for adv in advances.split(";"):
            adv_clean = re.sub(r"\([^)]*\)", "", adv.strip()).upper()
            if "X" in adv_clean and adv_clean[0] in ("B", "1", "2", "3"):
                if not _all_parens_have_error(adv):
                    r["outs"] += 1
        return r

    # Caught stealing / pickoff-caught-stealing
    # Error notation can appear as (E2), (1E4), (6E4), (E1/TH), etc.
    # Use _has_error() which handles both forms and survives '/' splitting.
    if b.startswith("POCS") or b.startswith("CS"):
        r["is_batter_pa"] = False
        if not _has_error(b):   # no error → runner is out
            r["outs"] = 1
        return r

    # Pickoff (not POCS, already handled)
    if b.startswith("PO"):
        r["is_batter_pa"] = False
        if not _has_error(b):
            r["outs"] = 1
        return r

    # ── batter PA events ──────────────────────────────────────────────────

    if b == "K":
        r["so"] = 1
        if secondary.startswith(("WP", "PB")):
            # Dropped third strike on WP/PB: batter reaches ONLY when a "B-"
            # advance is present.  If no "B-", the WP/PB just moved a baserunner
            # and the batter is still out (e.g. K+WP.1-2 → batter out, 1 out).
            batter_advanced = any(
                re.sub(r"\([^)]*\)", "", a.strip()).upper().startswith("B-")
                for a in advances.split(";") if a.strip()
            )
            r["outs"] = 0 if batter_advanced else 1
        elif secondary.startswith("E"):
            r["outs"] = 0   # catcher error on dropped K → batter always reaches
        else:
            r["outs"] = 1

    elif b.startswith("IW"):
        r["bb"] = 1

    elif b == "W":
        r["bb"] = 1

    elif b.startswith("HP"):
        r["hbp"] = 1

    elif b in ("C", "CI", "CF", "FI"):        # catcher/fan interference
        pass                                   # batter reaches, no primary stat

    elif b.startswith("E"):                   # error (batter reaches)
        pass

    elif b.startswith("FC"):                  # fielder's choice
        if "E" not in modifiers:
            # Only credit an out if a runner is actually retired (X in advances)
            # AND the error check passes — use _all_parens_have_error so that a
            # supplemental error paren like (E6) after a clean (75) doesn't mask
            # the out (e.g. 1X3(75)(E6) → out stands; 1X2(6E4) → runner safe).
            for _adv in advances.split(";"):
                _ac = re.sub(r"\([^)]*\)", "", _adv.strip()).upper()
                if "X" in _ac and _ac[0] in ("1", "2", "3"):
                    if not _all_parens_have_error(_adv):
                        r["outs"] = 1
                        break

    elif b[0] == "S":                         # single  (S, S7, S8, S9…)
        r["hits"] = 1

    elif b[0] == "D" and not b.startswith("DI"):  # double
        r["hits"] = 1

    elif b[0] == "T":                         # triple (T, T7…)
        r["hits"] = 1

    elif b.startswith("HR") or (b[0] == "H" and not b.startswith("HP")):  # home run
        r["hits"] = 1
        r["hr"]   = 1

    elif b[0].isdigit() and "E" in b:
        pass   # fielding error reaching on attempt (e.g. 6E3, 4E6): batter safe, 0 outs

    else:
        # Default: fielded out (pure digit sequences: 63, 8, 543, etc.)
        r["outs"] = 1

    # ── modifier adjustments ──────────────────────────────────────────────
    if "TP" in modifiers:
        r["outs"] += 2                  # triple play  → total 3
    elif "DP" in modifiers or "GDP" in modifiers:
        r["outs"] += 1                  # double play  → total 2

    # ── secondary event out (e.g. W+CS3, S8+CS2) ─────────────────────────
    # When the primary event is a non-out (walk, hit, etc.) and the compound
    # secondary is a caught-stealing or pickoff without an error, that runner
    # is out and must be credited to the pitcher.
    if secondary and r["outs"] == 0:
        if (secondary.startswith("CS") or secondary.startswith("PO") or
                secondary.startswith("POCS")):
            if not _has_error(secondary):
                r["outs"] = 1

    # ── runner / batter outs in advances (e.g. S8.2XH, S7.BX2) ─────────
    # Only when the primary event recorded 0 outs — otherwise we'd double-count
    # the out already represented by a fielder's choice or fielded-out play.
    # Covers both baserunner outs (1X/2X/3X) and batter-out-while-advancing (BX):
    #   S7.BX2(74) = single, batter thrown out trying to stretch to 2nd
    #   S8.2XH(82) = single, runner from 2nd thrown out at home
    if r["outs"] == 0 and advances:
        for adv in advances.split(";"):
            adv_clean = re.sub(r"\([^)]*\)", "", adv.strip())
            adv_up = adv_clean.upper()
            if "X" not in adv_up:
                continue
            # Runner is safe only when ALL parentheticals contain an error.
            # A single clean paren means the out was completed despite errors.
            if _all_parens_have_error(adv):
                continue
            runner = adv_up[0]  # 'B' = batter, '1'/'2'/'3' = baserunner
            if runner in ("B", "1", "2", "3"):
                r["outs"] += 1

    return r

# ── Retrosheet season ingest ──────────────────────────────────────────────────

def download_retrosheet(season: int) -> Path:
    path = CACHE_DIR / f"retro_{season}eve.zip"
    if path.exists():
        return path
    url = f"https://www.retrosheet.org/events/{season}eve.zip"
    print(f"  Downloading Retrosheet {season}…", end=" ", flush=True)
    resp = requests.get(url, timeout=120,
                        headers={"User-Agent": "battery-splits-ingest/1.0"})
    resp.raise_for_status()
    path.write_bytes(resp.content)
    print(f"{len(resp.content) // 1024} KB")
    return path

def parse_retrosheet_season(season: int, zip_path: Path, id_map: dict) -> tuple[list, dict]:
    """
    Parse all EV files for a season.
    Returns (raw_pa_list, {mlbam_id: name}).
    """
    pas: list[dict]    = []
    names: dict[int, str] = {}

    with zipfile.ZipFile(zip_path) as zf:
        ev_files = sorted(
            f for f in zf.namelist()
            if f.upper().endswith((".EVA", ".EVN", ".EV"))
        )

        for ev_file in ev_files:
            with zf.open(ev_file) as raw:
                lines = raw.read().decode("latin-1").splitlines()

            vis_team  = None
            home_team = None
            # lineup[team_idx][position] = retro_id  (team 0=visitor, 1=home)
            lineup: dict[int, dict[int, str]] = {0: {}, 1: {}}

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                rec   = line.split(",", 6)
                rtype = rec[0].lower()

                if rtype == "id":
                    vis_team  = None
                    home_team = None
                    lineup    = {0: {}, 1: {}}

                elif rtype == "info":
                    if len(rec) < 3:
                        continue
                    key, val = rec[1].lower(), rec[2]
                    if key == "visteam":
                        vis_team  = RETRO_TEAM.get(val, val)
                    elif key == "hometeam":
                        home_team = RETRO_TEAM.get(val, val)

                elif rtype in ("start", "sub"):
                    if len(rec) < 6:
                        continue
                    retro_id = rec[1]
                    name     = rec[2].strip('"')
                    team_idx = int(rec[3])
                    position = int(rec[5])
                    lineup[team_idx][position] = retro_id

                    mlbam = id_map.get(retro_id)
                    if mlbam and mlbam not in names:
                        names[mlbam] = name

                elif rtype == "play":
                    if len(rec) < 7:
                        continue
                    batting_team  = int(rec[2])
                    event_code    = rec[6].strip()
                    fielding_team = 1 - batting_team

                    pitcher_retro = lineup[fielding_team].get(1)
                    catcher_retro = lineup[fielding_team].get(2)

                    if not pitcher_retro or not catcher_retro:
                        continue

                    pitcher_mlbam = id_map.get(pitcher_retro)
                    catcher_mlbam = id_map.get(catcher_retro)

                    if not pitcher_mlbam or not catcher_mlbam:
                        continue

                    ev     = parse_retro_event(event_code)
                    p_team = home_team if fielding_team == 1 else vis_team

                    pas.append({
                        "season":       season,
                        "pitcher_id":   pitcher_mlbam,
                        "catcher_id":   catcher_mlbam,
                        "pitcher_team": p_team,
                        **ev,
                    })

    return pas, names

def aggregate_pas(pas: list[dict]) -> list[dict]:
    """Roll raw PA list into pitcher-catcher-season stat rows."""
    index: dict[tuple, dict] = {}

    for p in pas:
        key = (p["season"], p["pitcher_id"], p["catcher_id"])
        if key not in index:
            index[key] = {
                "season":       p["season"],
                "pitcher_id":   p["pitcher_id"],
                "catcher_id":   p["catcher_id"],
                "pitcher_team": p.get("pitcher_team"),
                "bf": 0, "outs": 0, "hits": 0, "hr": 0,
                "bb": 0, "so": 0, "er": 0,
            }
        s = index[key]
        if p.get("is_batter_pa"):
            s["bf"]   += 1
            s["hits"] += p.get("hits", 0)
            s["hr"]   += p.get("hr",   0)
            s["bb"]   += p.get("bb",   0) + p.get("hbp", 0)
            s["so"]   += p.get("so",   0)
        s["outs"] += p.get("outs", 0)
        s["er"]   += p.get("runs", 0)   # runs allowed as ER proxy

    rows = []
    for s in index.values():
        rows.append(compute_rates(dict(s)))
    return rows

def build_totals(rows: list[dict]) -> list[dict]:
    """Build catcher_id=0 aggregate rows (one per pitcher+season)."""
    totals: dict[tuple, dict] = {}

    for r in rows:
        if r["catcher_id"] == 0:
            continue
        key = (r["season"], r["pitcher_id"])
        if key not in totals:
            totals[key] = {
                "season":       r["season"],
                "pitcher_id":   r["pitcher_id"],
                "catcher_id":   0,
                "pitcher_team": r.get("pitcher_team"),
                "bf": 0, "outs": 0, "hits": 0, "hr": 0,
                "bb": 0, "so": 0, "er": 0,
            }
        t = totals[key]
        for c in ("bf", "outs", "hits", "hr", "bb", "so", "er"):
            t[c] += r.get(c, 0) or 0
        t["pitcher_team"] = r.get("pitcher_team") or t["pitcher_team"]

    return [compute_rates(dict(t)) for t in totals.values()]

def ingest_retrosheet_season(season: int, db: Client, id_map: dict):
    print(f"\n=== Season {season} (Retrosheet) ===")

    try:
        zip_path = download_retrosheet(season)
    except Exception as e:
        print(f"  ERROR downloading: {e}")
        return

    print("  Parsing event files…", flush=True)
    pas, names = parse_retrosheet_season(season, zip_path, id_map)
    if not pas:
        print("  No PA data found.")
        return

    print(f"  {len(pas):,} play records → aggregating…")
    rows   = aggregate_pas(pas)
    totals = build_totals(rows)

    pitcher_names: dict[int, str] = {}
    for p in pas:
        pid = p["pitcher_id"]
        if pid not in pitcher_names and pid in names:
            pitcher_names[pid] = names[pid]

    all_rows = rows + totals
    for r in all_rows:
        pid = r["pitcher_id"]
        r["pitcher_name"] = pitcher_names.get(pid, names.get(pid, f"Player {pid}"))
        r.pop("outs", None)    # not a DB column

    print(f"  {len(all_rows)} rows ({len(totals)} totals). Upserting…")
    upsert_stats(db, all_rows)

    catcher_records = []
    seen: set[int] = set()
    for r in rows:
        cid = r["catcher_id"]
        if cid and cid not in seen:
            seen.add(cid)
            catcher_records.append({
                "mlbam_id": cid,
                "name":     names.get(cid, f"Catcher {cid}"),
                "team":     None,
                "season":   season,
            })
    upsert_catchers(db, catcher_records)

# ── MLB Stats API backend (2026+) ─────────────────────────────────────────────

def mlb_get(path: str, **params) -> dict:
    url  = f"https://statsapi.mlb.com{path}"
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()

def get_season_game_pks(season: int) -> list[int]:
    data = mlb_get("/api/v1/schedule",
                   sportId=1, season=season, gameType="R",
                   fields="dates,games,gamePk,status,abstractGameState")
    pks = []
    for d in data.get("dates", []):
        for g in d.get("games", []):
            if g.get("status", {}).get("abstractGameState") == "Final":
                pks.append(g["gamePk"])
    return pks

def process_mlb_game(game_pk: int) -> tuple[list[dict], dict[int, str]]:
    """Returns (pa_rows, {mlbam_id: name})."""
    try:
        bs = mlb_get(f"/api/v1/game/{game_pk}/boxscore")
    except Exception:
        return [], {}

    player_team:  dict[int, str] = {}
    player_names: dict[int, str] = {}
    current_catcher: dict[int, int] = {}   # fielding_team_id → catcher_mlbam

    away_id = bs["teams"]["away"]["team"]["id"]
    home_id = bs["teams"]["home"]["team"]["id"]

    for side, tid in (("away", away_id), ("home", home_id)):
        team_data = bs["teams"][side]
        abbr      = team_data["team"].get("abbreviation", "")
        for p in team_data.get("players", {}).values():
            pid   = p["person"]["id"]
            player_team[pid]  = abbr
            player_names[pid] = p["person"]["fullName"]

            all_pos   = [x.get("code") for x in p.get("allPositions", [])]
            order_raw = p.get("battingOrder", "")
            try:
                is_starter = int(order_raw) % 100 == 0
            except (ValueError, TypeError):
                is_starter = False

            if "2" in all_pos and is_starter:
                current_catcher[tid] = pid

    # Build a quick lookup: player_id → team_id (for catcher sub tracking)
    player_tid: dict[int, int] = {}
    for side, tid in (("away", away_id), ("home", home_id)):
        for p in bs["teams"][side].get("players", {}).values():
            player_tid[p["person"]["id"]] = tid

    try:
        pbp = mlb_get(f"/api/v1/game/{game_pk}/playByPlay")
    except Exception:
        return [], player_names

    pas: list[dict]  = []
    prev_score = {"away": 0, "home": 0}

    for play in pbp.get("allPlays", []):
        # Check playEvents for defensive catcher substitutions and baserunning outs
        baserunning_outs = 0
        for pe in play.get("playEvents", []):
            det     = pe.get("details", {})
            ev_type = det.get("eventType", "")
            desc    = det.get("description", "").lower()
            new_pid = pe.get("player", {}).get("id")
            if ev_type in ("defensive_switch", "defensive_substitution") \
               and new_pid and "catcher" in desc:
                tid = player_tid.get(new_pid)
                if tid is not None:
                    current_catcher[tid] = new_pid
            elif det.get("isOut") and ev_type in (
                "caught_stealing_2b", "caught_stealing_3b", "caught_stealing_home",
                "pickoff_1b", "pickoff_2b", "pickoff_3b",
                "pickoff_caught_stealing_2b", "pickoff_caught_stealing_3b",
                "pickoff_caught_stealing_home",
                "runner_double_play", "runner_out",
            ):
                baserunning_outs += 1

        result = play.get("result", {})
        play_type = result.get("type")

        about   = play.get("about", {})
        matchup = play.get("matchup", {})
        half    = about.get("halfInning", "top")

        if half == "top":
            fielding_tid = home_id
        else:
            fielding_tid = away_id

        if baserunning_outs:
            pitcher_id = matchup.get("pitcher", {}).get("id")
            catcher_id = current_catcher.get(fielding_tid)
            if pitcher_id and catcher_id:
                pas.append({
                    "season":       None,
                    "pitcher_id":   pitcher_id,
                    "catcher_id":   catcher_id,
                    "pitcher_team": player_team.get(pitcher_id),
                    "is_batter_pa": False,
                    "outs":         baserunning_outs,
                    "hits": 0, "hr": 0, "bb": 0, "hbp": 0, "so": 0, "runs": 0,
                })
        if half == "top":
            batting_key = "away"
        else:
            batting_key = "home"

        pitcher_id = matchup.get("pitcher", {}).get("id")
        catcher_id = current_catcher.get(fielding_tid)

        if not pitcher_id or not catcher_id:
            continue

        ev_type = result.get("eventType", "")
        is_out  = result.get("isOut", False)

        # Runs scored this PA
        cur_away = result.get("awayScore", prev_score["away"])
        cur_home = result.get("homeScore", prev_score["home"])
        runs = max(0, (cur_away if batting_key == "away" else cur_home)
                   - prev_score[batting_key])
        prev_score["away"] = cur_away
        prev_score["home"] = cur_home

        hits = 1 if ev_type in ("single", "double", "triple", "home_run") else 0
        hr   = 1 if ev_type == "home_run" else 0
        bb   = 1 if ev_type in ("walk", "intent_walk", "hit_by_pitch") else 0
        so   = 1 if ev_type in ("strikeout", "strikeout_double_play") else 0

        n_outs = 0
        if is_out:
            if ev_type in ("grounded_into_double_play", "strikeout_double_play",
                           "double_play", "sac_fly_double_play", "sac_bunt_double_play"):
                n_outs = 2
            elif ev_type == "triple_play":
                n_outs = 3
            else:
                n_outs = 1

        pas.append({
            "season":       None,    # filled by caller
            "pitcher_id":   pitcher_id,
            "catcher_id":   catcher_id,
            "pitcher_team": player_team.get(pitcher_id),
            "is_batter_pa": True,
            "outs":         n_outs,
            "hits":         hits,
            "hr":           hr,
            "bb":           bb,
            "hbp":          0,
            "so":           so,
            "runs":         runs,
        })

    # Replace run-based ER proxy with official earnedRuns from boxscore,
    # allocated to catchers proportionally by BF share per pitcher.
    official_er: dict[int, int] = {}  # pitcher_id → official earnedRuns
    for side in ("away", "home"):
        for p in bs["teams"][side].get("players", {}).values():
            pid = p["person"]["id"]
            er  = p.get("stats", {}).get("pitching", {}).get("earnedRuns")
            if er is not None:
                official_er[pid] = int(er)

    if official_er:
        # Count BF per (pitcher, catcher) from this game's PAs
        from collections import defaultdict
        bf_map: dict[tuple[int,int], int] = defaultdict(int)
        for pa in pas:
            if pa["is_batter_pa"]:
                bf_map[(pa["pitcher_id"], pa["catcher_id"])] += 1

        # BF total per pitcher
        bf_total: dict[int, int] = defaultdict(int)
        for (pid, _), bf in bf_map.items():
            bf_total[pid] += bf

        # Allocate official ER to each PA's runs field via a correction pass
        # Strategy: zero out run-based ER on all PAs, then add corrected ER
        # as a synthetic entry per (pitcher, catcher) combination.
        for pa in pas:
            pa["runs"] = 0  # clear run-based ER

        for (pid, cid), bf in bf_map.items():
            total_bf = bf_total.get(pid, 0)
            if total_bf == 0:
                continue
            er = official_er.get(pid, 0)
            # Proportional allocation, rounding down; remainder goes to highest-BF catcher
            allocated = (er * bf) // total_bf
            if allocated:
                pas.append({
                    "season":       None,
                    "pitcher_id":   pid,
                    "catcher_id":   cid,
                    "pitcher_team": player_team.get(pid),
                    "is_batter_pa": False,
                    "outs": 0, "hits": 0, "hr": 0, "bb": 0, "hbp": 0, "so": 0,
                    "runs": allocated,
                })

        # Distribute any remainder (from floor division) to the catcher with most BF
        for pid, er in official_er.items():
            pairs = [(cid, bf) for (p, cid), bf in bf_map.items() if p == pid]
            if not pairs:
                continue
            allocated_sum = sum((er * bf) // bf_total[pid] for _, bf in pairs)
            remainder = er - allocated_sum
            if remainder:
                best_cid = max(pairs, key=lambda x: x[1])[0]
                pas.append({
                    "season":       None,
                    "pitcher_id":   pid,
                    "catcher_id":   best_cid,
                    "pitcher_team": player_team.get(pid),
                    "is_batter_pa": False,
                    "outs": 0, "hits": 0, "hr": 0, "bb": 0, "hbp": 0, "so": 0,
                    "runs": remainder,
                })

    return pas, player_names

def ingest_mlbapi_season(season: int, db: Client):
    print(f"\n=== Season {season} (MLB Stats API) ===")
    print("  Fetching schedule…", flush=True)

    try:
        pks = get_season_game_pks(season)
    except Exception as e:
        print(f"  ERROR: {e}")
        return

    print(f"  {len(pks)} completed games.")

    all_pas:   list[dict]    = []
    all_names: dict[int, str] = {}

    for i, gk in enumerate(pks, 1):
        if i % 100 == 0 or i == 1:
            print(f"  Game {i}/{len(pks)}…", flush=True)
        try:
            pas, names = process_mlb_game(gk)
        except Exception as e:
            print(f"  Warning: game {gk} failed: {e}")
            continue
        for p in pas:
            p["season"] = season
        all_pas.extend(pas)
        all_names.update(names)
        time.sleep(0.05)    # ~20 req/s

    if not all_pas:
        print("  No data.")
        return

    print(f"  {len(all_pas):,} PAs → aggregating…")
    rows   = aggregate_pas(all_pas)
    totals = build_totals(rows)
    all_rows = rows + totals

    pitcher_names = {r["pitcher_id"]: all_names.get(r["pitcher_id"], str(r["pitcher_id"]))
                     for r in rows}
    for r in all_rows:
        pid = r["pitcher_id"]
        r["pitcher_name"] = pitcher_names.get(pid, all_names.get(pid, f"Player {pid}"))
        r.pop("outs", None)

    print(f"  {len(all_rows)} rows ({len(totals)} totals). Upserting…")
    upsert_stats(db, all_rows)

    catcher_records = []
    seen: set[int] = set()
    for r in rows:
        cid = r["catcher_id"]
        if cid and cid not in seen:
            seen.add(cid)
            catcher_records.append({
                "mlbam_id": cid,
                "name":     all_names.get(cid, f"Catcher {cid}"),
                "team":     None,
                "season":   season,
            })
    upsert_catchers(db, catcher_records)

# ── DB helpers ────────────────────────────────────────────────────────────────

def upsert_stats(db: Client, rows: list[dict], batch: int = 500):
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        db.table("pitcher_catcher_stats").upsert(
            chunk, on_conflict="season,pitcher_id,catcher_id"
        ).execute()
        print(f"  Upserted {min(i + batch, len(rows))}/{len(rows)} stat rows")

def upsert_catchers(db: Client, records: list[dict]):
    if not records:
        return
    db.table("catchers").upsert(records, on_conflict="mlbam_id,season").execute()
    print(f"  Upserted {len(records)} catcher records")

def has_data(db: Client, season: int) -> bool:
    r = db.table("pitcher_catcher_stats").select("id").eq("season", season).limit(1).execute()
    return len(r.data) > 0

def delete_season(db: Client, season: int):
    db.table("pitcher_catcher_stats").delete().eq("season", season).execute()
    db.table("catchers").delete().eq("season", season).execute()
    print(f"  Deleted existing {season} data.")

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]

    # --force [year ...]  → re-ingest even if complete
    force_seasons: set[int] = set()
    if "--force" in args:
        idx = args.index("--force")
        for a in args[idx + 1:]:
            if a.isdigit():
                force_seasons.add(int(a))
        if not force_seasons:
            force_seasons = set(ALL_SEASONS)

    # --season year  → run only this season
    single: int | None = None
    if "--season" in args:
        idx = args.index("--season")
        if idx + 1 < len(args):
            single = int(args[idx + 1])

    seasons = [single] if single else ALL_SEASONS

    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Load Chadwick register once if any Retrosheet seasons are being processed
    retro_needed = any(s in set(RETROSHEET_SEASONS) for s in seasons)
    id_map: dict[str, int] = load_chadwick_register() if retro_needed else {}

    for season in seasons:
        forced = season in force_seasons

        if not forced and season in COMPLETED_SEASONS and has_data(db, season):
            print(f"\n=== Season {season} — complete, data exists. Skipping. "
                  f"(pass --force {season} to re-run)")
            continue

        if forced:
            delete_season(db, season)

        if season in set(RETROSHEET_SEASONS):
            ingest_retrosheet_season(season, db, id_map)
        else:
            ingest_mlbapi_season(season, db)

    print("\nDone.")

if __name__ == "__main__":
    main()
