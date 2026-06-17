#!/usr/bin/env python3
"""
Compare Fangraphs event log data against MLB Stats API official game logs
for a specific pitcher's season to find where IP discrepancies originate.

Usage:
  python scripts/compare_fg.py --fg-file path/to/fg_log.txt --mlbam-id 676979 --season 2025

Fangraphs event log format (tab-separated, reverse chronological):
  date  half-inn  batter-abbr  outs-before  bases  score  description  LI  RE  WE  WPA  RE24
"""

import argparse
import re
import requests
from collections import defaultdict
from datetime import datetime

# ─── MLB Stats API helpers ─────────────────────────────────────────────────────

def get_game_log(mlbam_id: int, season: int) -> list[dict]:
    """Fetch per-game pitching stats from MLB Stats API."""
    url = (
        f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}/stats"
        f"?stats=gameLog&season={season}&group=pitching"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()
    splits = data.get("stats", [{}])[0].get("splits", [])
    games = []
    for s in splits:
        d = s.get("date", "")         # "2025-04-01"
        stat = s.get("stat", {})
        ip_str = stat.get("inningsPitched", "0")
        ip_float = float(ip_str)
        whole = int(ip_float)
        frac = round(ip_float - whole, 1)
        outs = whole * 3 + round(frac * 10)
        games.append({
            "date": d,
            "ip_str": ip_str,
            "outs": outs,
            "bf": stat.get("battersFaced", 0),
            "h": stat.get("hits", 0),
            "bb": stat.get("baseOnBalls", 0),
            "so": stat.get("strikeOuts", 0),
            "hr": stat.get("homeRuns", 0),
            "er": stat.get("earnedRuns", 0),
        })
    return sorted(games, key=lambda x: x["date"])


# ─── Fangraphs log parser ──────────────────────────────────────────────────────

OUT_PHRASES = [
    "struck out", "grounded out", "flied out", "lined out", "fouled out",
    "popped out", "reached on error",  # error = 0 outs for batter, but 0 batter out... hmm
    "sacrificed", "sacrifice fly", "caught stealing", "picked off",
    "grounded into a double play", "lined into a double play",
    "grounded into a triple play",
    "reached on fielder's choice",  # 1 out on the runner
    "doubled off",  # line-drive DP, out on base
]

def split_play(desc: str) -> tuple[str, str]:
    """
    Split Fangraphs description into play text and pitch sequence.

    Fangraphs concatenates pitch sequence directly after play with no space:
      "Vladimir Guerrero Jr. struck out looking.Swinging Strike, Ball..."
      "Ernie Clement doubled to left (Liner).Ball, Ball..."
    Secondary plays (runner out, etc.) are separated by ". " (period+space):
      "George Springer grounded into a double play... . Isiah Kiner-Falefa out at second.Called Strike..."

    Strategy: find the FIRST period that is NOT followed by whitespace — that marks
    the boundary between play text and pitch sequence.  This correctly skips
    "Jr.", "Sr.", and ". " secondary-play sentence boundaries.
    """
    m = re.search(r'\.(?!\s)', desc)
    if m is None:
        # ends with ". " only or no period at all — return full desc as play
        return desc.rstrip('. '), ""
    idx = m.start()
    return desc[:idx], desc[idx+1:]


def count_outs_from_description(desc: str) -> int | None:
    """
    Estimate outs recorded from a Fangraphs play description.

    split_play strips pitch sequence; we work on the full play text
    (which may include secondary sentences like runner-out descriptions).
    """
    play, _ = split_play(desc)
    play_low = play.lower()

    # Triple play
    if "triple play" in play_low:
        return 3

    # Explicit double play label (GIDP, LIDP, non-force gdp, etc.)
    if "double play" in play_low or "doubled off" in play_low or " gdp " in play_low or play_low.endswith(" gdp") or "non-force gdp" in play_low:
        return 2

    # Caught stealing / picked off — baserunning out, not a batter PA
    if "caught stealing" in play_low or "picked off" in play_low:
        return 1

    # Dropped third strike: "out on a dropped third strike" = out
    # bare "dropped third strike" without "out" means batter reached
    if "out on a dropped third strike" in play_low:
        return 1

    # Batter makes an out
    batter_out = any(p in play_low for p in [
        "struck out", "grounded out", "flied out", "lined out", "fouled out",
        "popped out", "sacrificed", "sacrifice fly",
    ])
    if batter_out:
        # Secondary runner out embedded in same play (fly-ball DP, etc.)
        # e.g. "Rutschman flied out to right. Westburg out at second."
        if "out at" in play_low:
            return 2
        return 1

    # Fielder's choice — one runner out, batter reaches
    if "fielder's choice" in play_low:
        return 1

    # Batter reaches safely; check if a trailing runner was thrown out
    # e.g. "Pages singled to left. Freeman out at third."
    batter_reaches = any(p in play_low for p in [
        "singled", "doubled", "tripled", "homered", "walked",
        "hit by a pitch", "intentional walk", "reached on",
        "reached base on interference",
    ])
    if batter_reaches:
        if "out at" in play_low:
            return 1
        return 0

    # Pure baserunning / non-PA events (standalone advancement rows)
    if any(p in play_low for p in [
        "stolen base", "advanced on a", "balked to", "wild pitch",
        "passed ball",
    ]):
        return None

    return None


def is_batter_pa(desc: str) -> bool:
    """Return True if this row represents a batter plate appearance (not a pure baserunning event)."""
    play, _ = split_play(desc)
    play_low = play.lower()
    # Pure baserunning / non-PA rows
    non_pa = [
        "advanced on a stolen base", "advanced on a wild pitch", "advanced on a passed ball",
        "advanced on a balk", "advanced on a throwing error",
        "advanced on defensive indifference",
        "was caught stealing",   # CS is a baserunning out, not a batter PA
        "balked to",             # e.g. "Cody Bellinger balked to 2B" — runner advancement
        # NOTE: "no result" intentionally excluded — it appears in pitch sequences embedded
        # in legitimate batter PA descriptions and must not exclude them
    ]
    if any(p in play_low for p in non_pa):
        return False
    return True


def parse_fg_log(path: str, season: int = 2025) -> dict[str, dict]:
    """
    Parse a Fangraphs event log file.
    Returns dict of date_str -> {bf, outs, h, bb, so, hr, events: list}
    where date_str is 'YYYY-MM-DD' (we add year from context).
    """
    games = defaultdict(lambda: {"bf": 0, "outs": 0, "h": 0, "bb": 0, "so": 0, "hr": 0, "events": []})

    # We need to infer the year. Dates in FG are M/D format.
    year = season

    with open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue

            date_raw = parts[0].strip()       # e.g. "9/24" or "9/24/2025"
            half_inn = parts[1].strip()        # e.g. "▼ 8"
            desc = parts[6].strip()            # play description

            # Parse date
            if "/" in date_raw:
                chunks = date_raw.split("/")
                if len(chunks) == 3:
                    m, d, y = chunks
                    date_str = f"{y}-{int(m):02d}-{int(d):02d}"
                else:
                    m, d = chunks
                    y = year or 2025
                    date_str = f"{y}-{int(m):02d}-{int(d):02d}"
            else:
                continue

            if desc == "":
                continue

            outs_made = count_outs_from_description(desc)
            pa = is_batter_pa(desc)
            desc_low = desc.lower()

            play_text, _ = split_play(desc)
            play_text_low = play_text.lower()

            g = games[date_str]
            if pa:
                g["bf"] += 1
            if outs_made is not None:
                g["outs"] += outs_made

            # Count hits (use play text only, not pitch sequence)
            if any(p in play_text_low for p in ["singled", "doubled", "tripled", "homered"]):
                g["h"] += 1
            if "homered" in play_text_low:
                g["hr"] += 1
            if "walked" in play_text_low or "intentional walk" in play_text_low:
                g["bb"] += 1
            if "struck out" in play_text_low or "out on a dropped third strike" in play_text_low:
                g["so"] += 1

            g["events"].append({
                "desc": desc,
                "outs_made": outs_made,
                "is_pa": pa,
            })

    return dict(games)


def ip_str(outs: int) -> str:
    return f"{outs // 3}.{outs % 3}"


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fg-file", required=True, help="Path to Fangraphs event log TSV")
    parser.add_argument("--mlbam-id", type=int, default=676979, help="MLBAM ID (default: Crochet 676979)")
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--show-all", action="store_true", help="Show all games, not just discrepancies")
    args = parser.parse_args()

    print(f"Fetching MLB Stats API game log for player {args.mlbam_id}, season {args.season}...")
    api_games = get_game_log(args.mlbam_id, args.season)
    api_by_date = {g["date"]: g for g in api_games}
    print(f"  {len(api_games)} games from MLB API")

    print(f"\nParsing Fangraphs log: {args.fg_file}")
    fg_games = parse_fg_log(args.fg_file, season=args.season)
    # Inject year into any dates that are missing it
    fg_by_date = {}
    for d, g in fg_games.items():
        if d.startswith("None"):
            # patch year
            d = d.replace("None", str(args.season))
        if not d[:4].isdigit():
            d = f"{args.season}-" + d
        fg_by_date[d] = g
    print(f"  {len(fg_by_date)} games from Fangraphs log")

    # Align by date
    all_dates = sorted(set(list(api_by_date.keys()) + list(fg_by_date.keys())))

    header = f"{'Date':12s}  {'API IP':>6}  {'FG IP':>6}  {'Δouts':>5}  {'API BF':>6}  {'FG BF':>6}  {'ΔBF':>4}"
    print(f"\n{header}")
    print("-" * len(header))

    total_api_outs = 0
    total_fg_outs = 0
    total_api_bf = 0
    total_fg_bf = 0
    discrepant = 0

    for date in all_dates:
        api = api_by_date.get(date)
        fg  = fg_by_date.get(date)

        if api is None:
            print(f"{date}  {'N/A':>6}  {ip_str(fg['outs']):>6}  {'N/A':>5}  {'N/A':>6}  {fg['bf']:>6}  {'N/A':>4}  ← FG only")
            continue
        if fg is None:
            print(f"{date}  {ip_str(api['outs']):>6}  {'N/A':>6}  {'N/A':>5}  {api['bf']:>6}  {'N/A':>6}  {'N/A':>4}  ← API only")
            total_api_outs += api["outs"]
            total_api_bf += api["bf"]
            continue

        delta_outs = api["outs"] - fg["outs"]
        delta_bf   = api["bf"]   - fg["bf"]

        total_api_outs += api["outs"]
        total_fg_outs  += fg["outs"]
        total_api_bf   += api["bf"]
        total_fg_bf    += fg["bf"]

        flag = ""
        if delta_outs != 0 or delta_bf != 0:
            flag = f"  ← Δouts={delta_outs:+d}, ΔBF={delta_bf:+d}"
            discrepant += 1

        if args.show_all or flag:
            print(f"{date}  {ip_str(api['outs']):>6}  {ip_str(fg['outs']):>6}  {delta_outs:>+5}  {api['bf']:>6}  {fg['bf']:>6}  {delta_bf:>+4}{flag}")

    print("-" * len(header))
    print(f"{'TOTALS':12s}  {ip_str(total_api_outs):>6}  {ip_str(total_fg_outs):>6}  {total_api_outs-total_fg_outs:>+5}  {total_api_bf:>6}  {total_fg_bf:>6}  {total_api_bf-total_fg_bf:>+4}")
    print(f"\n{discrepant} games with discrepancies out of {len(all_dates)} total starts")

    if discrepant > 0:
        print("\n── Detail on discrepant games ──")
        for date in all_dates:
            api = api_by_date.get(date)
            fg  = fg_by_date.get(date)
            if not api or not fg:
                continue
            delta_outs = api["outs"] - fg["outs"]
            delta_bf   = api["bf"]   - fg["bf"]
            if delta_outs == 0 and delta_bf == 0:
                continue
            print(f"\n{date}: API {ip_str(api['outs'])} IP ({api['bf']} BF)  vs  FG {ip_str(fg['outs'])} IP ({fg['bf']} BF)")
            print(f"  API: H={api['h']} BB={api['bb']} K={api['so']} HR={api['hr']}")
            print(f"  FG:  H={fg['h']}  BB={fg['bb']}  K={fg['so']} HR={fg['hr']}")
            print(f"  FG events for this game:")
            for ev in fg.get("events", []):
                if ev["outs_made"] or not ev["is_pa"]:
                    marker = f"[{ev['outs_made']} out(s)]" if ev["outs_made"] else "[non-PA]"
                    print(f"    {marker:12s} {ev['desc'][:80]}")


if __name__ == "__main__":
    main()
