import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../types';
import {
  FantasyProsClientError,
  fetchFantasyProsData,
  fetchFantasyProsStatus,
  normalizeFantasyProsPlayers,
  normalizePlayerName,
} from './fantasypros';

afterEach(() => vi.restoreAllMocks());

describe('FantasyPros normalization', () => {
  it('normalizes punctuation, accents, and common suffixes for merging', () => {
    expect(normalizePlayerName('A.J. D\u00e9mo Jr.')).toBe(normalizePlayerName('AJ Demo'));
  });

  it('merges plausible response envelopes and fills the complete Player model', () => {
    const players = normalizeFantasyProsPlayers({
      rankings: { data: { players: [
        { player_name: 'A.J. Demo Jr.', player_team_id: 'BUF', player_position_id: 'WR', rank_ecr: '18', tier: 2 },
        { player_name: 'Defense Example', player_team_id: 'DEN', player_position_id: 'DEF', rank_ecr: 130 },
      ] } },
      projections: { players: [
        { name: 'AJ Demo', team: 'BUF', position: 'WR', stats: { fantasy_points: '248.5' }, bye_week: 7 },
      ] },
      injuries: { results: [
        { full_name: 'A.J. Demo', injury_status: 'Questionable', injury_probability: 0.4 },
      ] },
    });

    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      name: 'A.J. Demo Jr.', team: 'BUF', position: 'WR', projectedPoints: 248.5,
      adp: 18, tier: 2, injuryRisk: 40, availability: 'Questionable', bye: 7,
    });
    expect(players[0].floor).toBeLessThan(players[0].projectedPoints);
    expect(players[0].ceiling).toBeGreaterThan(players[0].projectedPoints);
    expect(players[0].context.gameAvailability).toBe(60);
    expect(players[1].position).toBe('DST');
  });

  it('enriches a matched live record from fallback data without adding fallback-only players', () => {
    const fallback: Player = {
      id: 'known-id', name: 'Known Player', team: 'OLD', position: 'RB', bye: 9,
      projectedPoints: 200, floor: 140, ceiling: 260, adp: 20, injuryRisk: 10,
      availability: 'Healthy', tier: 2, aliases: ['K. Player'],
      context: {
        offenseQuality: 8, opportunity: 90, roleSecurity: 85, gameAvailability: 90,
        coachUsage: 88, depthChartSecurity: 92, lineOrProtection: 3, schedule: 2,
        teamChangeImpact: 1, uncertainty: 12,
      },
    };
    const extra = { ...fallback, id: 'extra', name: 'Fallback Only' };
    const result = normalizeFantasyProsPlayers({
      rankings: [{ player_name: 'Known Player', team: 'NEW', position: 'RB', rank_ecr: 8 }],
      projections: [{ player_name: 'Known Player', team: 'NEW', position: 'RB', projected_points: 250 }],
    }, [fallback, extra]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'known-id', team: 'NEW', projectedPoints: 250, floor: 140 });
    expect(result[0].context).toEqual(fallback.context);
  });

  it('skips unsupported real-world positions', () => {
    const result = normalizeFantasyProsPlayers({
      rankings: { players: [
        { player_name: 'Linebacker Example', position: 'LB', rank_ecr: 1 },
        { player_name: 'Quarterback Example', position: 'QB', rank_ecr: 2 },
      ] },
    });
    expect(result.map((player) => player.name)).toEqual(['Quarterback Example']);
  });
});

describe('FantasyPros local client', () => {
  it('distinguishes a configured key from confirmed live data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      configured: true, live: false, message: 'Key configured; awaiting first successful fetch.',
    }), { status: 200 })));

    await expect(fetchFantasyProsStatus()).resolves.toEqual({
      configured: true,
      live: false,
      provider: 'fantasypros',
      message: 'Key configured; awaiting first successful fetch.',
    });
    expect(fetch).toHaveBeenCalledWith('/api/fantasypros/status', { signal: undefined });
  });

  it('loads and normalizes data without ever accepting an API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      rankings: [{ player_name: 'Live Player', team: 'KC', position: 'QB', rank_ecr: 5 }],
      projections: [{ player_name: 'Live Player', team: 'KC', position: 'QB', projected_points: 350 }],
      injuries: [],
    }), { status: 200 })));

    const result = await fetchFantasyProsData(2026);
    expect(result.status.live).toBe(true);
    expect(result.players[0].projectedPoints).toBe(350);
    expect(fetch).toHaveBeenCalledWith('/api/fantasypros/data?season=2026', { signal: undefined });
  });

  it('exposes proxy errors with their HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'FantasyPros API key is not configured.' }),
      { status: 503, statusText: 'Service Unavailable' },
    )));

    await expect(fetchFantasyProsStatus()).rejects.toMatchObject({
      message: 'FantasyPros API key is not configured.', statusCode: 503,
    });
  });
});
