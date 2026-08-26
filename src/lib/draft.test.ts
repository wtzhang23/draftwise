import { describe, expect, it } from 'vitest';
import { areAllRostersComplete, canTeamDraftPosition, DEFAULT_SETTINGS, isTeamRosterComplete, missingRosterSlots, nextOpenDraftPick, rosterCounts, teamAtPick } from './draft';
import type { Player } from '../types';

describe('draft order', () => {
  it('reverses every round in a snake draft', () => {
    expect(teamAtPick(1, 12, 'snake')).toBe(0);
    expect(teamAtPick(12, 12, 'snake')).toBe(11);
    expect(teamAtPick(13, 12, 'snake')).toBe(11);
    expect(teamAtPick(24, 12, 'snake')).toBe(0);
  });

  it('models third-round reversal', () => {
    expect(teamAtPick(13, 12, 'third-round-reversal')).toBe(11);
    expect(teamAtPick(25, 12, 'third-round-reversal')).toBe(0);
  });

  it('keeps defaults internally consistent', () => {
    expect(DEFAULT_SETTINGS.draftSlot).toBeLessThanOrEqual(DEFAULT_SETTINGS.teams);
  });

  it('counts a trusted position on an unlisted player pick', () => {
    const counts = rosterCounts([{
      id: 'unknown-pick', playerId: 'not-in-pool', displayName: 'Unlisted Rookie',
      position: 'TE', teamIndex: 2, overall: 1,
    }], 2, []);
    expect(counts.TE).toBe(1);
    expect(counts.WR).toBe(0);
  });

  it('marks a full team complete and skips it in the draft order', () => {
    const settings = { ...DEFAULT_SETTINGS, teams: 2, managerNames: ['One', 'Two'], roster: { ...DEFAULT_SETTINGS.roster, QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 } };
    const picks = [{ id: 'one', playerId: 'p1', position: 'QB' as const, teamIndex: 0, overall: 1 }];
    expect(isTeamRosterComplete(picks, 0, settings.roster, [])).toBe(true);
    expect(areAllRostersComplete(picks, settings, [])).toBe(false);
    expect(nextOpenDraftPick(picks, settings, [])).toEqual({ overall: 2, teamIndex: 1 });
  });

  it('returns no next pick after every roster is complete', () => {
    const settings = { ...DEFAULT_SETTINGS, teams: 2, managerNames: ['One', 'Two'], roster: { ...DEFAULT_SETTINGS.roster, QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 } };
    const picks = [
      { id: 'one', playerId: 'p1', position: 'QB' as const, teamIndex: 0, overall: 1 },
      { id: 'two', playerId: 'p2', position: 'QB' as const, teamIndex: 1, overall: 2 },
    ];
    expect(areAllRostersComplete(picks, settings, [])).toBe(true);
    expect(nextOpenDraftPick(picks, settings, [])).toBeNull();
  });

  it('does not mark the same-sized roster complete when required positions are missing', () => {
    const roster = { QB: 1, RB: 1, WR: 0, TE: 0, FLEX: 1, K: 0, DST: 0, BENCH: 1 };
    const picks = [
      { id: '1', playerId: '1', position: 'QB' as const, teamIndex: 0, overall: 1 },
      { id: '2', playerId: '2', position: 'QB' as const, teamIndex: 0, overall: 2 },
      { id: '3', playerId: '3', position: 'RB' as const, teamIndex: 0, overall: 3 },
      { id: '4', playerId: '4', position: 'K' as const, teamIndex: 0, overall: 4 },
    ];
    expect(missingRosterSlots(picks, 0, roster, [])).toBe(1);
    expect(isTeamRosterComplete(picks, 0, roster, [])).toBe(false);
  });

  it('reserves remaining picks for required positions', () => {
    const roster = { QB: 1, RB: 1, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 };
    const picks = [{ id: '1', playerId: '1', position: 'QB' as const, teamIndex: 0, overall: 1 }];
    expect(canTeamDraftPosition(picks, 0, 'QB', roster, [])).toBe(false);
    expect(canTeamDraftPosition(picks, 0, 'RB', roster, [])).toBe(true);
  });

  it('uses a manual pick position before the analytics source position', () => {
    const sourcePlayer = { id: 'hybrid', position: 'WR' } as Player;
    const picks = [{ id: '1', playerId: 'hybrid', position: 'RB' as const, teamIndex: 0, overall: 1 }];
    const counts = rosterCounts(picks, 0, [sourcePlayer]);
    expect(counts.RB).toBe(1);
    expect(counts.WR).toBe(0);
  });
});
