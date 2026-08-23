import { describe, expect, it } from 'vitest';
import {
  runBacktest,
  type BacktestConfig,
  type HistoricalSeasonInput,
  type PreseasonPlayerSnapshot,
  type RealizedSeasonOutcome,
} from './backtest';

// These fixtures are deliberately synthetic. They test mechanics and comparative
// behavior; they do not claim to describe real players, seasons, or provider data.
const player = (
  playerId: string,
  position: 'RB' | 'WR',
  projectedValue: number,
  adp: number,
  availabilityProbability: number,
  realizedValue: number,
): [PreseasonPlayerSnapshot, RealizedSeasonOutcome] => [{
  playerId,
  name: `Synthetic ${playerId}`,
  season: 2024,
  position,
  projectedValue,
  adp,
  tier: 1,
  availabilityProbability,
}, {
  playerId,
  season: 2024,
  realizedValue,
  wasAvailable: realizedValue > 0,
}];

const syntheticPairs = [
  player('rb-safe-1', 'RB', 100, 1, 0.98, 105),
  player('wr-safe-1', 'WR', 99, 2, 0.98, 104),
  player('rb-safe-2', 'RB', 95, 3, 0.95, 98),
  player('wr-safe-2', 'WR', 94, 4, 0.95, 97),
  player('rb-safe-3', 'RB', 90, 5, 0.92, 93),
  player('wr-safe-3', 'WR', 89, 6, 0.92, 92),
  player('rb-safe-4', 'RB', 84, 7, 0.90, 87),
  player('wr-safe-4', 'WR', 83, 8, 0.90, 86),
  // Attractive raw projections but poor availability make these designed busts.
  player('rb-bust-1', 'RB', 102, 9, 0.10, 0),
  player('wr-bust-1', 'WR', 101, 10, 0.10, 0),
  player('rb-bust-2', 'RB', 88, 11, 0.15, 0),
  player('wr-bust-2', 'WR', 87, 12, 0.15, 0),
  player('rb-depth-1', 'RB', 70, 13, 0.85, 72),
  player('wr-depth-1', 'WR', 69, 14, 0.85, 71),
  player('rb-depth-2', 'RB', 65, 15, 0.80, 66),
  player('wr-depth-2', 'WR', 64, 16, 0.80, 65),
] as const;

const syntheticSeason: HistoricalSeasonInput = {
  season: 2024,
  preseason: syntheticPairs.map(([snapshot]) => snapshot),
  outcomes: syntheticPairs.map(([, outcome]) => outcome),
};

const config: BacktestConfig = {
  seasons: [syntheticSeason],
  teams: 4,
  trialsPerSeason: 80,
  seed: 8675309,
  rosterSlots: [
    { name: 'RB', count: 1, eligiblePositions: ['RB'], starter: true },
    { name: 'WR', count: 1, eligiblePositions: ['WR'], starter: true },
    { name: 'BENCH', count: 1, eligiblePositions: ['RB', 'WR'], starter: false },
  ],
};

describe('provider-agnostic draft backtest', () => {
  it('is deterministic for a seed and reports every required metric', () => {
    const first = runBacktest(config);
    const second = runBacktest(config);

    expect(first).toEqual(second);
    expect(first.scenarios).toBe(80);
    expect(first.results.map((result) => result.strategyId)).toEqual([
      'optimizer', 'adp', 'projection-only', 'need-aware', 'random-top-tier',
    ]);
    for (const result of first.results) {
      expect(Number.isFinite(result.metrics.meanRealizedStarterValue)).toBe(true);
      expect(Number.isFinite(result.metrics.meanRealizedRosterValue)).toBe(true);
      expect(result.metrics.averageRank).toBeGreaterThanOrEqual(1);
      expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.meanRegretVersusHindsightOracle).toBeGreaterThanOrEqual(0);
      expect(result.metrics.availabilityProbabilityBrierScore).not.toBeNull();
    }
    expect(first.pairedComparisons).toHaveLength(4);
    expect(Object.keys(first.sampledUserDraftSlots).length).toBeGreaterThan(1);
    expect(Object.keys(first.sampledOpponentProfiles).length).toBeGreaterThan(1);
  });

  it('lets the sensible risk-adjusted optimizer beat random top-tier drafting', () => {
    const report = runBacktest(config);
    const comparison = report.pairedComparisons.find(
      (item) => item.baselineStrategyId === 'random-top-tier',
    );

    expect(comparison).toBeDefined();
    expect(comparison!.meanStarterValueDelta).toBeGreaterThan(0);
    expect(comparison!.headToHeadWinRate).toBeGreaterThan(0.5);
  });

  it('does not expose realized outcomes at the strategy boundary', () => {
    let inspected = false;
    runBacktest({
      ...config,
      trialsPerSeason: 1,
      optimizer: {
        id: 'boundary-check',
        name: 'Boundary check',
        selectPlayer(context) {
          inspected = true;
          expect('outcomes' in context).toBe(false);
          expect(context.available.every((candidate) => !('realizedValue' in candidate))).toBe(true);
          return context.available[0].playerId;
        },
      },
    });
    expect(inspected).toBe(true);
  });

  it('returns a null Brier score when availability labels are absent', () => {
    const noAvailability: HistoricalSeasonInput = {
      ...syntheticSeason,
      preseason: syntheticSeason.preseason.map(({ availabilityProbability: _ignored, ...snapshot }) => snapshot),
      outcomes: syntheticSeason.outcomes.map(({ wasAvailable: _ignored, ...outcome }) => outcome),
    };
    const report = runBacktest({ ...config, seasons: [noAvailability], trialsPerSeason: 1 });
    expect(report.results[0].metrics.availabilityProbabilityBrierScore).toBeNull();
  });
});
