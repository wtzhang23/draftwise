import { describe, expect, it } from 'vitest';
import { players } from '../data/players';
import type { DraftState } from '../types';
import { DEFAULT_SETTINGS } from './draft';
import { recommendations, substitutionRiskForPlayer } from './optimizer';

const state: DraftState = {
  settings: DEFAULT_SETTINGS,
  picks: [],
  userTeamIndex: 6,
  riskTolerance: 50,
  scarcityWeight: 50,
  activePosition: 'ALL',
  connections: { sleeperDraftId: '', autoSyncSleeper: false },
};

describe('recommendation engine', () => {
  it('returns every available player in descending score order', () => {
    const result = recommendations(state, players);
    expect(result).toHaveLength(players.length);
    expect(result.every((item, index) => index === 0 || result[index - 1].score >= item.score)).toBe(true);
  });

  it('excludes drafted players', () => {
    const drafted = players[0];
    const result = recommendations({ ...state, picks: [{ id: '1', playerId: drafted.id, teamIndex: 0, overall: 1 }] }, players);
    expect(result.some((item) => item.player.id === drafted.id)).toBe(false);
  });

  it('respects position filters', () => {
    const result = recommendations({ ...state, activePosition: 'TE' }, players);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.player.position === 'TE')).toBe(true);
  });

  it('exposes availability, usage, context and injury signals', () => {
    const result = recommendations(state, players)[0];
    expect(result.availabilityRisk).toBeGreaterThanOrEqual(0);
    expect(result.player.context.coachUsage).toBeGreaterThan(0);
    expect(Number.isFinite(result.contextAdjustment)).toBe(true);
    expect(Number.isFinite(result.injuryPenalty)).toBe(true);
  });

  it('recalculates roster fit when a pick is assigned to the user instead of a peer', () => {
    const selected = players.find((player) => player.position === 'WR')!;
    const comparison = players.find((player) => player.position === 'WR' && player.id !== selected.id)!;
    const pick = { id: 'ownership-test', playerId: selected.id, overall: 1 };
    const peerResult = recommendations({ ...state, picks: [{ ...pick, teamIndex: 0 }] }, players)
      .find((item) => item.player.id === comparison.id)!;
    const userResult = recommendations({ ...state, picks: [{ ...pick, teamIndex: state.userTeamIndex }] }, players)
      .find((item) => item.player.id === comparison.id)!;

    expect(peerResult.rosterFit).toBeGreaterThan(userResult.rosterFit);
    expect(peerResult.score).toBeGreaterThan(userResult.score);
  });

  it('penalizes same-team, same-position competition that raises substitution risk', () => {
    const target = { ...players[0], id: 'target', name: 'Target', team: 'TST', position: 'WR' as const, projectedPoints: 200 };
    const weakTeammate = { ...players[1], id: 'weak', name: 'Weak teammate', team: 'TST', position: 'WR' as const, projectedPoints: 50 };
    const strongTeammate = { ...weakTeammate, id: 'strong', name: 'Strong teammate', projectedPoints: 190 };

    const lowRisk = substitutionRiskForPlayer(target, [target, weakTeammate]);
    const highRisk = substitutionRiskForPlayer(target, [target, strongTeammate]);
    const lowRiskRecommendation = recommendations(state, [target, weakTeammate]).find((item) => item.player.id === target.id)!;
    const highRiskRecommendation = recommendations(state, [target, strongTeammate]).find((item) => item.player.id === target.id)!;

    expect(highRisk).toBeGreaterThan(lowRisk);
    expect(highRiskRecommendation.substitutionRisk).toBe(highRisk);
    expect(highRiskRecommendation.score).toBeLessThan(lowRiskRecommendation.score);
  });
});
