import { describe, expect, it } from 'vitest';
import type { DraftPick, DraftState, Player, Position, RosterSettings } from '../types';
import { DEFAULT_SETTINGS } from './draft';
import { calculateTeamStrengths } from './teamStrength';

function player(id: string, position: Position, projectedPoints: number, risk = 0): Player {
  return {
    id, name: id, team: 'TST', position, bye: 1, projectedPoints,
    floor: projectedPoints * 0.8, ceiling: projectedPoints * 1.2, adp: 1,
    injuryRisk: risk, availability: 'Active', tier: 1,
    context: {
      offenseQuality: 5, opportunity: 75, roleSecurity: 75,
      gameAvailability: 90, coachUsage: 80, depthChartSecurity: 75,
      lineOrProtection: 5, schedule: 5, teamChangeImpact: 0, uncertainty: 0,
    },
  };
}

function draftState(roster: RosterSettings, picks: DraftPick[], teams = 2): DraftState {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      teams,
      managerNames: Array.from({ length: teams }, (_, index) => `Team ${index + 1}`),
      roster,
    },
    picks,
    userTeamIndex: 0,
    riskTolerance: 50,
    scarcityWeight: 50,
    activePosition: 'ALL',
    connections: { sleeperDraftId: '', autoSyncSleeper: false },
  };
}

function picks(teamIndex: number, ids: string[]): DraftPick[] {
  return ids.map((playerId, index) => ({
    id: `${teamIndex}-${playerId}`,
    playerId,
    teamIndex,
    overall: index + 1,
  }));
}

describe('calculateTeamStrengths', () => {
  it('optimizes direct starters before selecting FLEX from remaining RB/WR/TE players', () => {
    const roster = { QB: 0, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 0, DST: 0, BENCH: 1 };
    const pool = [
      player('rb-elite', 'RB', 240),
      player('rb-flex', 'RB', 210),
      player('wr-starter', 'WR', 220),
      player('te-starter', 'TE', 180),
      player('wr-bench', 'WR', 160),
    ];
    const [summary] = calculateTeamStrengths(draftState(roster, picks(0, pool.map(({ id }) => id))), pool);

    expect(summary.starters.find((slot) => slot.slot === 'RB')?.playerId).toBe('rb-elite');
    expect(summary.starters.find((slot) => slot.slot === 'WR')?.playerId).toBe('wr-starter');
    expect(summary.starters.find((slot) => slot.slot === 'TE')?.playerId).toBe('te-starter');
    expect(summary.starters.find((slot) => slot.slot === 'FLEX')?.playerId).toBe('rb-flex');
    expect(summary.benchDepth).toBeGreaterThan(0);
  });

  it('uses conservative missing-slot estimates so extra weak picks do not automatically win', () => {
    const roster = { QB: 1, RB: 1, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 2 };
    const pool = [
      player('elite-qb', 'QB', 430),
      player('weak-qb', 'QB', 220),
      player('weak-rb', 'RB', 95),
      player('weak-bench-1', 'RB', 80),
      player('weak-bench-2', 'RB', 70),
    ];
    const state = draftState(roster, [
      ...picks(0, ['elite-qb']),
      ...picks(1, ['weak-qb', 'weak-rb', 'weak-bench-1', 'weak-bench-2']),
    ]);
    const summaries = calculateTeamStrengths(state, pool);

    expect(summaries[0].rosterFilled).toBe(1);
    expect(summaries[0].missingStarterSlots).toBe(1);
    expect(summaries[0].overallScore).toBeGreaterThan(summaries[1].overallScore);
  });

  it('caps roster progress at capacity and marks complete rosters without overflow', () => {
    const roster = { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 1 };
    const pool = [player('qb', 'QB', 300), player('bench', 'QB', 280), player('overflow', 'QB', 260)];
    const [summary] = calculateTeamStrengths(draftState(roster, picks(0, ['qb', 'bench', 'overflow'])), pool);

    expect(summary.rosterTotal).toBe(2);
    expect(summary.rosterFilled).toBe(2);
    expect(summary.complete).toBe(true);
    expect(summary.overflowCount).toBe(1);
    expect(summary.starters.some((starter) => starter.playerId === 'overflow')).toBe(false);
  });

  it('ranks deterministically and handles unlisted or invalid player data without NaN', () => {
    const roster = { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 };
    const invalid = player('invalid', 'QB', Number.NaN, Number.NaN);
    const state = draftState(roster, [
      ...picks(0, ['strong']),
      { id: 'unknown', playerId: 'not-in-pool', displayName: 'Mystery QB', position: 'QB', teamIndex: 1, overall: 2 },
      ...picks(2, ['invalid']),
    ], 3);
    const summaries = calculateTeamStrengths(state, [player('strong', 'QB', 360), invalid]);

    expect(summaries.map((summary) => summary.rank)).toEqual([1, 2, 3]);
    expect(summaries[1].unknownPlayerCount).toBe(1);
    expect(summaries.every((summary) => Number.isFinite(summary.overallScore))).toBe(true);
    expect(summaries.every((summary) => Number.isFinite(summary.averageRisk))).toBe(true);
  });
});
