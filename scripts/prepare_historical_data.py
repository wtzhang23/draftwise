"""Prepare leakage-safe historical draft inputs from public nflverse/ffverse archives."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

import pandas as pd

RANKINGS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr.parquet"
OUTCOMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz"
OUTPUT = Path(".cache/historical-backtest.json")
FIRST_SEASON = 2020
LAST_SEASON = 2025
PRESEASON_CUTOFF_MONTH = 9
PRESEASON_CUTOFF_DAY = 1
PLAYER_POOL_SIZE = 210
RANK_VALUE_CEILING = 360
TIER_SIZE = 12
# Beta-style shrinkage keeps one healthy prior season from implying certainty.
AVAILABILITY_PRIOR_ACTIVE_GAMES = 8.5
AVAILABILITY_PRIOR_GAMES = 10
EXPECTED_SEASON_GAMES = 17
MINIMUM_AVAILABILITY = 0.55
MAXIMUM_AVAILABILITY = 0.98
AVAILABLE_SEASON_THRESHOLD = 12


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    value = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", value.lower())
    return re.sub(r"[^a-z0-9]", "", value)


def load_rankings() -> pd.DataFrame:
    columns = ["page_type", "scrape_date", "player", "pos", "team", "ecr"]
    frame = pd.read_parquet(RANKINGS_URL, columns=columns)
    frame["scrape_date"] = pd.to_datetime(frame["scrape_date"])
    frame = frame[frame["page_type"].eq("redraft-overall") & frame["pos"].isin(["QB", "RB", "WR", "TE"])]
    frame["season"] = frame["scrape_date"].dt.year
    cutoff = pd.to_datetime(frame["season"].astype(str) + f"-{PRESEASON_CUTOFF_MONTH:02d}-{PRESEASON_CUTOFF_DAY:02d}")
    frame = frame[frame["scrape_date"] <= cutoff]
    latest = frame.groupby("season")["scrape_date"].transform("max")
    frame = frame[frame["scrape_date"].eq(latest)].copy()
    frame["name_key"] = frame["player"].map(normalize_name)
    return frame.sort_values("ecr").drop_duplicates(["season", "name_key"])


def load_outcomes() -> pd.DataFrame:
    columns = ["player_display_name", "position", "recent_team", "season", "week", "season_type", "fantasy_points_ppr"]
    frame = pd.read_csv(OUTCOMES_URL, usecols=columns)
    frame = frame[frame["season_type"].eq("REG") & frame["position"].isin(["QB", "RB", "WR", "TE"])]
    frame["name_key"] = frame["player_display_name"].map(normalize_name)
    return frame.groupby(["season", "name_key"], as_index=False).agg(
        realized_value=("fantasy_points_ppr", "sum"),
        games=("week", "nunique"),
    )


def main() -> None:
    rankings = load_rankings()
    outcomes = load_outcomes()
    prior_games = outcomes[["season", "name_key", "games"]].copy()
    prior_games["season"] += 1
    seasons = []
    for season in range(FIRST_SEASON, LAST_SEASON + 1):
        preseason = rankings[rankings["season"].eq(season)].head(PLAYER_POOL_SIZE)
        # The archive starts late in 2020; skip any season without a full pre-draft snapshot.
        if len(preseason) < PLAYER_POOL_SIZE:
            continue
        joined = preseason.merge(prior_games, on=["season", "name_key"], how="left")
        joined = joined.merge(outcomes, on=["season", "name_key"], how="left", suffixes=("_prior", "_actual"))
        joined["games_prior"] = joined["games_prior"].fillna(0)
        joined["games_actual"] = joined["games_actual"].fillna(0)
        joined["realized_value"] = joined["realized_value"].fillna(0)
        snapshots, realized = [], []
        for row in joined.itertuples():
            player_id = f"{season}-{row.name_key}"
            probability = (row.games_prior + AVAILABILITY_PRIOR_ACTIVE_GAMES) / (
                EXPECTED_SEASON_GAMES + AVAILABILITY_PRIOR_GAMES
            )
            probability = max(MINIMUM_AVAILABILITY, min(MAXIMUM_AVAILABILITY, probability))
            snapshots.append({
                "playerId": player_id,
                "name": row.player,
                "season": season,
                "position": row.pos,
                # Consensus rank is converted monotonically to a value scale; outcomes remain hidden.
                "projectedValue": max(1, RANK_VALUE_CEILING - float(row.ecr)),
                "adp": float(row.ecr),
                "tier": max(1, math.ceil(float(row.ecr) / TIER_SIZE)),
                "availabilityProbability": probability,
            })
            realized.append({
                "playerId": player_id,
                "season": season,
                "realizedValue": float(row.realized_value),
                "wasAvailable": int(row.games_actual) >= AVAILABLE_SEASON_THRESHOLD,
            })
        seasons.append({"season": season, "preseason": snapshots, "outcomes": realized})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(seasons), encoding="utf-8")
    print(f"Prepared {len(seasons)} seasons and {sum(len(s['preseason']) for s in seasons)} player-seasons at {OUTPUT}")


if __name__ == "__main__":
    main()
