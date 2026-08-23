import type { DraftFormat, DraftPick, LeagueSettings, Player, Position, RosterSettings } from '../types';

export const DEFAULT_SCORING = {
  passingYards: 0.04, passingTd: 4, interception: -1,
  rushingYards: 0.1, rushingTd: 6, reception: 1,
  receivingYards: 0.1, receivingTd: 6,
};

export const DEFAULT_ROSTER: RosterSettings = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DST: 1, BENCH: 6 };

export const defaultManagerNames = (teams: number): string[] => Array.from(
  { length: teams }, (_, index) => `Manager ${index + 1}`,
);

// An open FLEX slot is a partial rather than hard positional need because three positions can fill it.
const FLEX_NEED_SHARE = 0.6;

export const DEFAULT_SETTINGS: LeagueSettings = {
  name: 'Sunday League', teams: 12, managerNames: defaultManagerNames(12), draftSlot: 7, format: 'snake', scoringLabel: 'Full PPR',
  scoring: DEFAULT_SCORING, roster: DEFAULT_ROSTER, auctionBudget: 200,
};

export function teamAtPick(overall: number, teams: number, format: DraftFormat): number {
  const round = Math.floor((overall - 1) / teams) + 1;
  const offset = (overall - 1) % teams;
  if (format === 'linear' || format === 'auction') return offset;
  if (format === 'third-round-reversal') {
    if (round === 1) return offset;
    return round % 2 === 0 ? teams - 1 - offset : offset;
  }
  return round % 2 === 1 ? offset : teams - 1 - offset;
}

export function nextPickForTeam(picksMade: number, teamIndex: number, settings: LeagueSettings): number {
  const max = settings.teams * 30;
  for (let overall = picksMade + 1; overall <= max; overall += 1) {
    if (teamAtPick(overall, settings.teams, settings.format) === teamIndex) return overall;
  }
  return max;
}

export function picksUntilNextTurn(picks: DraftPick[], teamIndex: number, settings: LeagueSettings): number {
  const current = picks.length + 1;
  const next = nextPickForTeam(current, teamIndex, settings);
  return Math.max(1, next - current);
}

export function rosterCounts(picks: DraftPick[], teamIndex: number, players: Player[]): Record<Position, number> {
  const map = Object.fromEntries(players.map((player) => [player.id, player])) as Record<string, Player>;
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  picks.filter((pick) => pick.teamIndex === teamIndex).forEach((pick) => {
    const player = map[pick.playerId];
    // Unlisted Sleeper/manual picks can still carry a trusted position even when
    // no analytics row exists, so they continue to affect opponent roster demand.
    const position = player?.position ?? pick.position;
    if (position) counts[position] += 1;
  });
  return counts;
}

export function starterNeed(position: Position, counts: Record<Position, number>, roster: RosterSettings): number {
  const direct = roster[position] ?? 0;
  if (counts[position] < direct) return direct - counts[position];
  if ((position === 'RB' || position === 'WR' || position === 'TE') && counts.RB + counts.WR + counts.TE < roster.RB + roster.WR + roster.TE + roster.FLEX) return FLEX_NEED_SHARE;
  return 0;
}
