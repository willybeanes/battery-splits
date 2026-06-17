#!/usr/bin/env python3
"""
Game-by-game Retrosheet vs MLB API comparison for a single pitcher/season.
Prints every game, flags discrepancies, and shows the raw event codes
for games where outs differ.

Usage:
  python3 scripts/debug_pitcher.py --mlbam 676979 --season 2025
"""

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest import (
    CACHE_DIR, RETRO_TEAM, load_chadwick_register,
    download_retrosheet, parse_retro_event, outs_to_ip
)

import requests


def get_api_game_log(mlbam_id: int, season: int) -> dict[str, dict]:
    url = (f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}/stats"
           f"?stats=gameLog&season={season}&group=pitching")
    data = requests.get(url, timeout=30).json()
    out = {}
    for s in data.get("stats", [{}])[0].get("splits", []):
        d  = s["date"]
        st = s["stat"]
        ip = float(st.get("inningsPitched", 0))
        w  = int(ip); frac = round((ip - w) * 10)
        out[d] = dict(
            ip_str = st.get("inningsPitched", "0"),
            outs   = w * 3 + frac,
            bf     = st.get("battersFaced", 0),
            h      = st.get("hits", 0),
            bb     = st.get("baseOnBalls", 0),
            so     = st.get("strikeOuts", 0),
            hr     = st.get("homeRuns", 0),
        )
    return out


def retro_games_for_pitcher(mlbam_id: int, season: int, id_map: dict) -> dict[str, dict]:
    pitcher_retros = {k for k, v in id_map.items() if v == mlbam_id}
    if not pitcher_retros:
        sys.exit(f"No Retrosheet ID found for MLBAM {mlbam_id}")

    zip_path = CACHE_DIR / f"retro_{season}eve.zip"
    if not zip_path.exists():
        download_retrosheet(season)

    games: dict[str, dict] = {}

    with zipfile.ZipFile(zip_path) as zf:
        ev_files = sorted(f for f in zf.namelist()
                          if f.upper().endswith((".EVA", ".EVN", ".EV")))

        for ev_file in ev_files:
            with zf.open(ev_file) as raw:
                lines = raw.read().decode("latin-1").splitlines()

            game_date = None
            lineup: dict[int, dict[int, str]] = {0: {}, 1: {}}

            for line in lines:
                line = line.strip()
                if not line:
                    continue
                rec   = line.split(",", 6)
                rtype = rec[0].lower()

                if rtype == "id":
                    gid = rec[1] if len(rec) > 1 else ""
                    if len(gid) >= 11:
                        raw_date = gid[3:11]
                        game_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
                    lineup = {0: {}, 1: {}}

                elif rtype in ("start", "sub"):
                    if len(rec) < 6: continue
                    lineup[int(rec[3])][int(rec[5])] = rec[1]

                elif rtype == "play":
                    if len(rec) < 7 or not game_date: continue
                    batting_team  = int(rec[2])
                    fielding_team = 1 - batting_team
                    if lineup[fielding_team].get(1) not in pitcher_retros:
                        continue

                    code = rec[6].strip()
                    ev   = parse_retro_event(code)

                    if game_date not in games:
                        games[game_date] = {"outs": 0, "bf": 0, "h": 0,
                                            "bb": 0, "so": 0, "hr": 0, "events": []}
                    g = games[game_date]
                    g["outs"] += ev["outs"]
                    if ev["is_batter_pa"]:
                        g["bf"] += 1
                        g["h"]  += ev["hits"]
                        g["bb"] += ev["bb"] + ev["hbp"]
                        g["so"] += ev["so"]
                        g["hr"] += ev["hr"]
                    g["events"].append({"code": code, "is_pa": ev["is_batter_pa"],
                                        "outs": ev["outs"]})
    return games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mlbam",    type=int, default=676979)
    ap.add_argument("--season",   type=int, default=2025)
    ap.add_argument("--show-all", action="store_true")
    args = ap.parse_args()

    print("Loading Chadwick register…")
    id_map = load_chadwick_register()

    print(f"Fetching MLB API game log ({args.mlbam}/{args.season})…")
    api = get_api_game_log(args.mlbam, args.season)

    print(f"Parsing Retrosheet {args.season}…")
    retro = retro_games_for_pitcher(args.mlbam, args.season, id_map)

    all_dates = sorted(set(list(api.keys()) + list(retro.keys())))

    hdr = f"{'Date':12s}  {'API IP':>6}  {'RT IP':>6}  {'Δouts':>5}  {'API BF':>6}  {'RT BF':>5}  {'ΔBF':>4}"
    print(f"\n{hdr}")
    print("-" * len(hdr))

    tot_api_o = tot_rt_o = tot_api_bf = tot_rt_bf = 0
    n_disc = 0

    for date in all_dates:
        a = api.get(date)
        r = retro.get(date)
        if not a:
            print(f"{date}  {'N/A':>6}  {outs_to_ip(r['outs']):>6}  {'?':>5}  {'N/A':>6}  {r['bf']:>5}  {'?':>4}  ← RT only")
            continue
        if not r:
            print(f"{date}  {a['ip_str']:>6}  {'N/A':>6}  {'?':>5}  {a['bf']:>6}  {'N/A':>5}  {'?':>4}  ← API only")
            tot_api_o += a["outs"]; tot_api_bf += a["bf"]
            continue

        dout = a["outs"] - r["outs"]
        dbf  = a["bf"]   - r["bf"]
        tot_api_o += a["outs"]; tot_rt_o  += r["outs"]
        tot_api_bf += a["bf"];  tot_rt_bf += r["bf"]

        flag = f"  ← Δouts={dout:+d}, ΔBF={dbf:+d}" if (dout or dbf) else ""
        if flag: n_disc += 1

        if args.show_all or flag:
            print(f"{date}  {a['ip_str']:>6}  {outs_to_ip(r['outs']):>6}  {dout:>+5}  {a['bf']:>6}  {r['bf']:>5}  {dbf:>+4}{flag}")

    print("-" * len(hdr))
    print(f"{'TOTALS':12s}  {outs_to_ip(tot_api_o):>6}  {outs_to_ip(tot_rt_o):>6}  {tot_api_o-tot_rt_o:>+5}  {tot_api_bf:>6}  {tot_rt_bf:>5}  {tot_api_bf-tot_rt_bf:>+4}")
    print(f"\n{n_disc} discrepant games")

    if not n_disc:
        return

    print("\n── Detail ──")
    for date in all_dates:
        a = api.get(date)
        r = retro.get(date)
        if not a or not r: continue
        dout = a["outs"] - r["outs"]
        dbf  = a["bf"]   - r["bf"]
        if not dout and not dbf: continue

        print(f"\n{date}  API {a['ip_str']} ({a['bf']} BF)  vs  RT {outs_to_ip(r['outs'])} ({r['bf']} BF)  Δouts={dout:+d}")
        print(f"  API: H={a['h']} BB={a['bb']} K={a['so']} HR={a['hr']}")
        print(f"  RT:  H={r['h']}  BB={r['bb']}  K={r['so']}  HR={r['hr']}")
        print(f"  All events (outs | PA/-- | code):")
        for ev in r["events"]:
            pa = "PA" if ev["is_pa"] else "--"
            print(f"    [{ev['outs']}] {pa}  {ev['code']}")


if __name__ == "__main__":
    main()
