import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../types';
import { importSleeperDraftPicks } from './sleeper';

const player = (id: string, name: string, sleeper?: string): Player => ({
  id, name, team: 'BUF', position: 'WR', bye: 7, projectedPoints: 200, floor: 150,
  ceiling: 250, adp: 20, injuryRisk: 8, availability: 'Healthy', tier: 2,
  externalIds: sleeper ? { sleeper } : undefined,
  context: { offenseQuality: 0, opportunity: 80, roleSecurity: 80, gameAvailability: 90,
    coachUsage: 80, depthChartSecurity: 80, lineOrProtection: 0, schedule: 0,
    teamChangeImpact: 0, uncertainty: 12 },
});

afterEach(() => vi.restoreAllMocks());

describe('Sleeper draft import', () => {
  it('matches provider IDs first and normalized names as a fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { pick_no: 1, draft_slot: 2, player_id: 's1', metadata: { player: 'Different Label' } },
      { pick_no: 2, draft_slot: 1, player_id: 'unknown', metadata: { player: 'A.J. Demo Jr.' } },
      { pick_no: 3, draft_slot: 3, player_id: 'missing', metadata: { player: 'Missing Player', position: 'TE', team: 'FA' } },
    ]), { status: 200 })));
    const result = await importSleeperDraftPicks('draft-1', [player('one', 'Known Player', 's1'), player('two', 'AJ Demo')]);
    expect(result.picks).toEqual([
      { id: 'sleeper-draft-1-1', playerId: 'one', teamIndex: 1, overall: 1 },
      { id: 'sleeper-draft-1-2', playerId: 'two', teamIndex: 0, overall: 2 },
      { id: 'sleeper-draft-1-3', playerId: 'unmatched-sleeper-missing', displayName: 'Missing Player', position: 'TE', team: 'FA', teamIndex: 2, overall: 3 },
    ]);
    expect(result.unmatched).toEqual(['Missing Player']);
  });
});
