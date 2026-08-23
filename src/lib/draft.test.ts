import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, rosterCounts, teamAtPick } from './draft';

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
});
