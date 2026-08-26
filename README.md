# DraftWise

DraftWise is a local-first fantasy-football draft companion. It records the room's picks, imports or manually configures Sleeper-style league rules, and explains a risk-adjusted recommendation at every selection.

The checked-in player pool is a reproducible, downloaded/derived baseline. It uses current open redraft consensus rankings and rosters plus the latest completed season's results. It is **not** a current medical-status feed or medical advice.

## Getting started

Install a current [Node.js LTS release](https://nodejs.org/), which includes npm. Then clone the repository and install its dependencies:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The generated player pool is committed, so no API keys or data download are required for the first run.

Useful commands:

```bash
npm test
npm run backtest
npm run build
npm run data:download
```

`public/data/player-pool.json` has already been generated, so the app works immediately. Run `npm run data:download` whenever you want to refresh it. The script downloads 2026 PPR redraft ECR from DynastyProcess, 2026 nflverse rosters, and 2025 nflverse regular-season player results. It writes source URLs and a generation timestamp into the output file.

In the app, open **Local real data** in the header to paste a Sleeper draft ID. **Sync picks now** imports the room; auto-sync polls every 10 seconds. Manual entry remains available, including an explicit “record unlisted player” path for spelling/identity gaps. Unmatched picks still advance the board and affect positional demand when Sleeper supplies a position. If Sleeper and an analytics source disagree, use the position selector beside a recorded pick to override its roster eligibility.

League settings define the exact QB, RB, WR, TE, FLEX, K, DST, and bench requirements. A team is complete only when it reaches the configured roster size and fills all required positional slots; the draft entry prevents picks that would make those requirements impossible to satisfy.

## What the prototype models

The recommendation engine separates three questions: projected football output, marginal value to this roster, and the chance a comparable player survives to the next turn. Its auditable inputs include:

- custom scoring and value over replacement;
- positional tier depth, opponents' roster needs, draft format, and ADP-based next-turn survival;
- active-game probability, season injury risk, practice/fitness proxy, coach usage, same-position teammate competition, depth-chart security, and role uncertainty;
- offensive environment, expected opportunity, line/protection quality, schedule, and team-change impact;
- upside, projection uncertainty, market disagreement, roster fit, and user risk/scarcity controls.

All tunable assumptions are named and commented in `src/lib/optimizer.ts`. Context weights are deliberately modest because external projections may already encode team situation; this reduces double counting.

## Active and recommended data stack

- [DynastyProcess data](https://github.com/dynastyprocess/data) for the downloadable current redraft consensus/ECR market signal used by this prototype. Follow its GPL terms and FantasyPros attribution requirements.
- [Sleeper API](https://docs.sleeper.com/) for optional league scoring, roster settings, draft order, picks, and player-ID mapping. The prototype does not rely on Sleeper for projections.
- [nflverse](https://nflreadr.nflverse.com/) for the current rosters, IDs, and prior-season outcomes used by the local baseline. Retain CC BY 4.0 attribution and do not treat its injury dataset as a dependable current-status feed.
- [FantasyPros API](https://www.fantasypros.com/api-data/) remains an optional adapter for licensed projections and injury/status overlays. Prototype and production rights differ; keep credentials and provider responses out of the repository.
- [SportsDataIO](https://sportsdata.io/developers/api-documentation/nfl) or [Sportradar NFL](https://developer.sportradar.com/football/docs/nfl-ig-overview) for a licensed production injury, practice-status, depth-chart, and availability feed.

Players without prior-season results are intentionally extrapolated conservatively: lower floors, higher injury/availability priors, and higher model uncertainty. A live injury/practice provider should override those priors rather than being silently inferred.

## Historical backtesting

`src/lib/backtest.ts` provides a deterministic, provider-agnostic backtest harness. It keeps preseason inputs and realized outcomes in separate types to reduce look-ahead leakage, then runs paired simulations where every strategy receives the same season, user slot, and opponent profiles.

The harness compares the optimizer with ADP, projection-only, need-aware, and random-within-top-tier strategies. It randomizes user draft position with a seeded generator and reports:

- realized starter and full-roster value;
- average league rank and win rate;
- regret versus a hindsight roster oracle;
- head-to-head deltas against each baseline;
- Brier score for preseason availability probabilities.

The automated tests use a clearly labeled synthetic historical fixture. To evaluate real performance, transform each historical season into `HistoricalSeasonInput` with only information published before that season's draft in `preseason`, and join actual season results through `outcomes`. Use multiple seasons as rolling temporal folds—for example, tune on seasons through year N and report untouched results on year N+1. Never choose heuristic weights on the same seasons reported as final evaluation.

An optional real-data pipeline is included for 2021–2025. It downloads each season's final pre-September PPR consensus snapshot from the ffverse archive and joins nflverse regular-season PPR outcomes only after drafting. Its availability prior uses only the preceding season's games played.

```bash
python3 -m venv .venv-backtest
.venv-backtest/bin/pip install -r scripts/requirements-backtest.txt
.venv-backtest/bin/python scripts/prepare_historical_data.py
npm run backtest:historical
```

The first diagnostic run is intentionally not presented as proof of superiority: the prototype optimizer beat random-within-tier drafting but trailed ADP and need-aware baselines on realized starter value. That result exposed an availability double-counting error, which was corrected, but further tuning must use training seasons and a genuinely untouched holdout rather than optimizing against the reported years.

Fair comparisons should run many seeds and all draft slots, preserve identical opponent behavior across paired strategies, publish confidence intervals, and report results by league settings and draft slot as well as in aggregate.
