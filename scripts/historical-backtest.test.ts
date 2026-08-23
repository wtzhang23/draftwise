import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runBacktest, type HistoricalSeasonInput } from '../src/lib/backtest';

describe('real historical paired backtest', () => {
  it('evaluates the optimizer across every prepared prior season', () => {
    const seasons = JSON.parse(readFileSync('.cache/historical-backtest.json', 'utf8')) as HistoricalSeasonInput[];
    const report = runBacktest({
      seasons,
      teams: 12,
      // Ten paired rooms per season provides repeated random slots while staying practical in CI.
      trialsPerSeason: 10,
      seed: 20260822,
      rosterSlots: [
        { name: 'QB', count: 1, eligiblePositions: ['QB'], starter: true },
        { name: 'RB', count: 2, eligiblePositions: ['RB'], starter: true },
        { name: 'WR', count: 2, eligiblePositions: ['WR'], starter: true },
        { name: 'TE', count: 1, eligiblePositions: ['TE'], starter: true },
        { name: 'FLEX', count: 2, eligiblePositions: ['RB', 'WR', 'TE'], starter: true },
        { name: 'BENCH', count: 2, eligiblePositions: ['QB', 'RB', 'WR', 'TE'], starter: false },
      ],
    });

    console.log(`\nHistorical paired backtest: ${report.scenarios} scenarios (${seasons.map((s) => s.season).join(', ')})`);
    console.table(report.results.map(({ strategyName, metrics }) => ({
      strategy: strategyName,
      starter_points: metrics.meanRealizedStarterValue.toFixed(1),
      roster_points: metrics.meanRealizedRosterValue.toFixed(1),
      average_rank: metrics.averageRank.toFixed(2),
      win_rate: `${(metrics.winRate * 100).toFixed(1)}%`,
      oracle_regret: metrics.meanRegretVersusHindsightOracle.toFixed(1),
      availability_brier: metrics.availabilityProbabilityBrierScore?.toFixed(3) ?? 'n/a',
    })));
    console.table(report.pairedComparisons.map((comparison) => ({
      baseline: comparison.baselineStrategyId,
      starter_delta: comparison.meanStarterValueDelta.toFixed(1),
      rank_improvement: comparison.meanRankImprovement.toFixed(2),
      head_to_head: `${(comparison.headToHeadWinRate * 100).toFixed(1)}%`,
    })));

    expect(seasons.map((season) => season.season)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(report.scenarios).toBe(50);
    expect(report.results).toHaveLength(5);
  }, 60_000);
});
