"""
Diagnostic script: show exactly which events are being counted as outs
for a specific pitcher in a given season. Also computes IP using the
outs_when_up delta approach (the proposed fix).

Usage:
  python3 scripts/debug_pitcher.py --pitcher "Crochet, Garrett" --season 2025
  python3 scripts/debug_pitcher.py --pitcher "Wheeler, Zack" --season 2024
"""

import io
import time
import argparse
import requests
import pandas as pd
from datetime import date, timedelta

PA_TERMINAL_EVENTS = {
    "single", "double", "triple", "home_run",
    "strikeout", "strikeout_double_play",
    "field_out", "force_out", "grounded_into_double_play",
    "double_play", "triple_play",
    "sac_fly", "sac_fly_double_play",
    "sac_bunt", "sac_bunt_double_play",
    "fielders_choice", "fielders_choice_out",
    "walk", "intent_walk", "hit_by_pitch",
    "catcher_interf", "fan_interference",
    "other_out",
}

OUT_EVENTS = {
    "strikeout", "strikeout_double_play",
    "field_out", "force_out", "grounded_into_double_play",
    "double_play", "triple_play",
    "sac_fly", "sac_fly_double_play",
    "sac_bunt", "sac_bunt_double_play",
    "fielders_choice_out", "other_out",
}

MULTI_OUT_EVENTS = {
    "grounded_into_double_play", "strikeout_double_play",
    "double_play", "sac_fly_double_play", "sac_bunt_double_play",
}
TRIPLE_OUT_EVENTS = {"triple_play"}


def outs_to_ip(outs):
    return int(outs // 3) + (outs % 3) / 10


def season_date_chunks(season, days=14):
    start = date(season, 3, 20)
    end = min(date(season, 10, 5), date.today())
    chunks = []
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=days - 1), end)
        chunks.append((cur.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        cur = chunk_end + timedelta(days=1)
    return chunks


def fetch_statcast(date_from, date_to):
    url = (
        "https://baseballsavant.mlb.com/statcast_search/csv"
        f"?all=true&type=details&player_type=pitcher"
        f"&game_date_gt={date_from}&game_date_lt={date_to}"
        "&min_pitches=0&sort_col=pitches&sort_order=desc"
    )
    try:
        resp = requests.get(url, timeout=180)
        resp.raise_for_status()
        content = resp.text.strip()
        if not content or content.startswith("<!"):
            return None
        df = pd.read_csv(io.StringIO(content), low_memory=False)
        return df if not df.empty and "pitcher" in df.columns else None
    except Exception as e:
        print(f"  Fetch error: {e}")
        return None


def compute_outs_delta(pa_df):
    """
    Compute outs_delta for each PA using outs_when_up differences.
    For consecutive PAs in the same half-inning, delta = next.outs_when_up - current.outs_when_up.
    For the LAST PA in each half-inning, use event codes (minimal reliance on event codes).
    """
    pa_df = pa_df.copy()
    pa_df["outs_delta"] = 0

    has_owu = (
        "outs_when_up" in pa_df.columns
        and "inning" in pa_df.columns
        and "inning_topbot" in pa_df.columns
    )
    if not has_owu:
        print("  WARNING: outs_when_up column missing, falling back to event codes")
        for idx, row in pa_df.iterrows():
            ev = str(row["events"]).lower()
            if ev in TRIPLE_OUT_EVENTS:
                pa_df.loc[idx, "outs_delta"] = 3
            elif ev in MULTI_OUT_EVENTS:
                pa_df.loc[idx, "outs_delta"] = 2
            elif ev in OUT_EVENTS:
                pa_df.loc[idx, "outs_delta"] = 1
        return pa_df

    pa_df["outs_when_up"] = pd.to_numeric(pa_df["outs_when_up"], errors="coerce").fillna(0).astype(int)

    for (game_pk, inning, topbot), group in pa_df.groupby(["game_pk", "inning", "inning_topbot"]):
        sorted_g = group.sort_values("at_bat_number")
        idxs = sorted_g.index.tolist()
        owu  = sorted_g["outs_when_up"].tolist()
        evs  = sorted_g["events"].str.lower().tolist()

        # Non-last PAs: use outs_when_up delta (reliable, no event codes)
        for i in range(len(idxs) - 1):
            pa_df.loc[idxs[i], "outs_delta"] = max(0, owu[i + 1] - owu[i])

        # Last PA of inning: use event codes (outs can't be verified via next PA)
        last_ev = evs[-1]
        if last_ev in TRIPLE_OUT_EVENTS:
            pa_df.loc[idxs[-1], "outs_delta"] = 3
        elif last_ev in MULTI_OUT_EVENTS:
            pa_df.loc[idxs[-1], "outs_delta"] = 2
        elif last_ev in OUT_EVENTS:
            pa_df.loc[idxs[-1], "outs_delta"] = 1
        # else: non-out (walk, hit, error, etc.) → 0

    return pa_df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pitcher", required=True, help='e.g. "Crochet, Garrett"')
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--chunks", type=int, default=3, help="Days per chunk")
    args = parser.parse_args()

    target_name = args.pitcher.lower()
    season = args.season
    chunks = season_date_chunks(season, days=args.chunks)

    # We need ALL pitchers' PA data (not just target) so that outs_when_up
    # deltas are computed correctly across the full half-inning sequence.
    all_pa_rows = []

    print(f"\nFetching {season} data ({len(chunks)} chunks) — pulling full game data for outs_when_up accuracy...")
    for i, (d_from, d_to) in enumerate(chunks):
        print(f"  [{i+1}/{len(chunks)}] {d_from}→{d_to}", end=" ", flush=True)
        df = fetch_statcast(d_from, d_to)
        if df is None:
            print("empty")
            continue

        if "player_name" in df.columns and "pitcher_name" not in df.columns:
            df["pitcher_name"] = df["player_name"]

        df["events"] = df["events"].fillna("")
        df["fielder_2"] = pd.to_numeric(df["fielder_2"], errors="coerce").fillna(0).astype(int)

        # ALL pitchers' PA rows (needed for outs_when_up deltas)
        pa_df = df.sort_values("pitch_number").groupby(
            ["pitcher", "at_bat_number", "game_pk"], as_index=False
        ).last()
        pa_df = pa_df[pa_df["events"].str.lower().isin(PA_TERMINAL_EVENTS)]

        if len(pa_df) == 0:
            print("0 PA rows")
            continue

        # Compute outs_delta for all PAs using outs_when_up
        pa_df = compute_outs_delta(pa_df)

        # Check if target pitcher is in this chunk
        if "pitcher_name" in pa_df.columns:
            target_rows = pa_df[pa_df["pitcher_name"].str.lower() == target_name]
            print(f"{len(target_rows)} PAs for {args.pitcher}")
        else:
            print(f"{len(pa_df)} total PAs")

        all_pa_rows.append(pa_df)
        time.sleep(1)

    if not all_pa_rows:
        print("No data found.")
        return

    combined = pd.concat(all_pa_rows, ignore_index=True)

    # Filter to target pitcher
    if "pitcher_name" in combined.columns:
        pitcher_pa = combined[combined["pitcher_name"].str.lower() == target_name].copy()
    else:
        print("No pitcher_name column — can't filter. Aborting.")
        return

    if pitcher_pa.empty:
        print(f"No PAs found for '{args.pitcher}' in {season}.")
        return

    # ── Event distribution ────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"PA event breakdown for {args.pitcher} ({season})")
    print(f"{'='*60}")
    event_counts = pitcher_pa["events"].str.lower().value_counts()
    total_bf = len(pitcher_pa)
    outs_event_single = 0
    outs_event_multi  = 0
    outs_owu_delta    = int(pitcher_pa["outs_delta"].sum())

    for ev, cnt in event_counts.items():
        is_out    = ev in OUT_EVENTS
        is_multi  = ev in MULTI_OUT_EVENTS
        is_triple = ev in TRIPLE_OUT_EVENTS
        out_per   = 1 + (1 if is_multi else 0) + (2 if is_triple else 0) if is_out else 0
        if is_out:
            outs_event_single += cnt
            outs_event_multi  += cnt * out_per
        tag = ""
        if is_multi:    tag = f" ← MULTI_OUT (+2)"
        elif is_triple: tag = f" ← TRIPLE_OUT (+3)"
        elif is_out:    tag = f" ← 1 out"
        print(f"  {ev:<35} {cnt:>5}{tag}")

    print(f"\n{'─'*60}")
    print(f"  Total BF:                     {total_bf}")
    print()
    print(f"  Method 1 — event codes, 1/PA: {outs_event_single} outs  →  {outs_to_ip(outs_event_single)} IP")
    print(f"  Method 2 — event codes, MULTI: {outs_event_multi} outs  →  {outs_to_ip(outs_event_multi)} IP")
    print(f"  Method 3 — outs_when_up delta: {outs_owu_delta} outs  →  {outs_to_ip(outs_owu_delta)} IP  ← PROPOSED FIX")
    print()
    print("  (Compare Method 3 to official IP on baseball-reference)")

    # Show any PAs where outs_delta differs from event-based expectation
    mismatch = []
    for _, row in pitcher_pa.iterrows():
        ev = str(row["events"]).lower()
        if ev in MULTI_OUT_EVENTS:
            expected = 2
        elif ev in TRIPLE_OUT_EVENTS:
            expected = 3
        elif ev in OUT_EVENTS:
            expected = 1
        else:
            expected = 0
        actual_delta = int(row["outs_delta"])
        if actual_delta != expected:
            mismatch.append({
                "event": ev,
                "expected_outs": expected,
                "actual_outs": actual_delta,
                "game_pk": row.get("game_pk"),
                "inning": row.get("inning"),
                "topbot": row.get("inning_topbot"),
                "at_bat": row.get("at_bat_number"),
                "outs_when_up": row.get("outs_when_up"),
            })

    if mismatch:
        print(f"\n  ⚠️  {len(mismatch)} PA(s) where outs_when_up delta ≠ event-based count:")
        print(f"  {'Event':<35} {'Exp':>5} {'Got':>5}  {'game_pk':>10}  inn  topbot")
        print("  " + "─" * 70)
        for m in mismatch[:30]:
            print(f"  {m['event']:<35} {m['expected_outs']:>5} {m['actual_outs']:>5}  {str(m['game_pk']):>10}  {m['inning']:>3}  {m['topbot']}")
        if len(mismatch) > 30:
            print(f"  ... and {len(mismatch)-30} more")


if __name__ == "__main__":
    main()
