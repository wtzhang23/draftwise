import type { DraftFormat, DraftPick, LeagueSettings, Player } from '../types';
import { DEFAULT_SETTINGS, defaultManagerNames } from './draft';

interface SleeperLeague {
  name: string;
  total_rosters: number;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
}

interface SleeperPick {
  pick_no: number;
  draft_slot: number;
  player_id: string;
  metadata?: { first_name?: string; last_name?: string; player?: string; position?: string; team?: string };
}

export interface SleeperPickImport {
  picks: DraftPick[];
  unmatched: string[];
}

const formatRoster = (positions: string[] = []) => {
  const next = { ...DEFAULT_SETTINGS.roster, QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 };
  positions.forEach((position) => {
    const normalized = position === 'DEF' ? 'DST' : position === 'SUPER_FLEX' || position === 'REC_FLEX' || position === 'WRRB_FLEX' ? 'FLEX' : position;
    if (normalized in next) next[normalized as keyof typeof next] += 1;
  });
  return next;
};

export async function importSleeperLeague(leagueId: string): Promise<LeagueSettings> {
  const response = await fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId.trim())}`);
  if (!response.ok) throw new Error('Sleeper league not found. Check the ID and try again.');
  const league = await response.json() as SleeperLeague;
  const score = league.scoring_settings ?? {};
  return {
    ...DEFAULT_SETTINGS,
    name: league.name || DEFAULT_SETTINGS.name,
    teams: league.total_rosters || DEFAULT_SETTINGS.teams,
    managerNames: defaultManagerNames(league.total_rosters || DEFAULT_SETTINGS.teams),
    roster: formatRoster(league.roster_positions),
    scoringLabel: 'Sleeper import',
    scoring: {
      passingYards: score.pass_yd ?? DEFAULT_SETTINGS.scoring.passingYards,
      passingTd: score.pass_td ?? DEFAULT_SETTINGS.scoring.passingTd,
      interception: score.pass_int ?? DEFAULT_SETTINGS.scoring.interception,
      rushingYards: score.rush_yd ?? DEFAULT_SETTINGS.scoring.rushingYards,
      rushingTd: score.rush_td ?? DEFAULT_SETTINGS.scoring.rushingTd,
      reception: score.rec ?? DEFAULT_SETTINGS.scoring.reception,
      receivingYards: score.rec_yd ?? DEFAULT_SETTINGS.scoring.receivingYards,
      receivingTd: score.rec_td ?? DEFAULT_SETTINGS.scoring.receivingTd,
    },
  };
}

export function sleeperFormat(value: string): DraftFormat {
  if (value === 'linear') return 'linear';
  if (value === 'auction') return 'auction';
  if (value === '3rr') return 'third-round-reversal';
  return 'snake';
}

const normalizeName = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z0-9]/g, '');

const sleeperPosition = (value?: string) => {
  const normalized = value?.toUpperCase() === 'DEF' ? 'DST' : value?.toUpperCase();
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(normalized ?? '')
    ? normalized as DraftPick['position'] : undefined;
};

export async function importSleeperDraftPicks(draftId: string, players: readonly Player[]): Promise<SleeperPickImport> {
  const normalizedId = draftId.trim();
  if (!normalizedId) throw new Error('Enter a Sleeper draft ID.');
  const response = await fetch(`https://api.sleeper.app/v1/draft/${encodeURIComponent(normalizedId)}/picks`);
  if (!response.ok) throw new Error('Sleeper draft not found. Check the draft ID and try again.');
  const sleeperPicks = await response.json() as SleeperPick[];
  const bySleeperId = new Map(players.flatMap((player) => player.externalIds?.sleeper
    ? [[player.externalIds.sleeper, player] as const] : []));
  const byName = new Map(players.flatMap((player) => [player.name, ...(player.aliases ?? [])]
    .map((name) => [normalizeName(name), player] as const)));
  const unmatched: string[] = [];
  const picks = sleeperPicks.flatMap((pick) => {
    const displayName = pick.metadata?.player
      ?? [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(' ');
    const player = bySleeperId.get(pick.player_id) || (displayName ? byName.get(normalizeName(displayName)) : undefined);
    if (!player) {
      unmatched.push(displayName || `Sleeper player ${pick.player_id}`);
      // Preserve the pick even without analytics. This keeps draft order exact;
      // trusted Sleeper position metadata still informs opponents' roster demand.
      return [{
        id: `sleeper-${normalizedId}-${pick.pick_no}`,
        playerId: `unmatched-sleeper-${pick.player_id}`,
        displayName: displayName || `Unlisted player ${pick.player_id}`,
        position: sleeperPosition(pick.metadata?.position),
        team: pick.metadata?.team,
        teamIndex: Math.max(0, pick.draft_slot - 1),
        overall: pick.pick_no,
      }];
    }
    return [{
      id: `sleeper-${normalizedId}-${pick.pick_no}`,
      playerId: player.id,
      teamIndex: Math.max(0, pick.draft_slot - 1),
      overall: pick.pick_no,
    }];
  });
  return { picks: picks.sort((a, b) => a.overall - b.overall), unmatched };
}
