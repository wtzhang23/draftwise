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

export const rosterSize = (roster: RosterSettings): number => Object.values(roster)
  .reduce((total, slots) => total + Math.max(0, slots), 0);

export const teamPickCount = (picks: DraftPick[], teamIndex: number): number => picks
  .filter((pick) => pick.teamIndex === teamIndex).length;

const FLEX_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];

function missingRequiredSlots(counts: Record<Position, number>, roster: RosterSettings): number {
  const directMissing = (Object.keys(counts) as Position[])
    .reduce((missing, position) => missing + Math.max(0, roster[position] - counts[position]), 0);
  const flexEligibleSurplus = FLEX_POSITIONS.reduce(
    (surplus, position) => surplus + Math.max(0, counts[position] - roster[position]),
    0,
  );
  return directMissing + Math.max(0, roster.FLEX - flexEligibleSurplus);
}

/** Number of configured starter/FLEX slots the team's known positions still need. */
export function missingRosterSlots(
  picks: DraftPick[], teamIndex: number, roster: RosterSettings, players: Player[],
): number {
  return missingRequiredSlots(rosterCounts(picks, teamIndex, players), roster);
}

/**
 * A roster is complete only when its configured total is full and its known positions
 * satisfy every direct slot plus FLEX. BENCH contributes to total capacity, not a
 * positional minimum. Picks without a known position cannot satisfy starter slots.
 */
export const isTeamRosterComplete = (
  picks: DraftPick[], teamIndex: number, roster: RosterSettings, players: Player[],
): boolean => teamPickCount(picks, teamIndex) >= rosterSize(roster)
  && missingRosterSlots(picks, teamIndex, roster, players) === 0;

/** Prevents a pick that would leave too few roster spots to meet configured positions. */
export function canTeamDraftPosition(
  picks: DraftPick[], teamIndex: number, position: Position | undefined,
  roster: RosterSettings, players: Player[],
): boolean {
  const currentCount = teamPickCount(picks, teamIndex);
  const capacity = rosterSize(roster);
  if (currentCount >= capacity) return false;
  const counts = rosterCounts(picks, teamIndex, players);
  if (position) counts[position] += 1;
  const spotsRemainingAfterPick = capacity - currentCount - 1;
  return missingRequiredSlots(counts, roster) <= spotsRemainingAfterPick;
}

export const areAllRostersComplete = (picks: DraftPick[], settings: LeagueSettings, players: Player[]): boolean =>
  Array.from({ length: settings.teams }, (_, teamIndex) => teamIndex)
    .every((teamIndex) => isTeamRosterComplete(picks, teamIndex, settings.roster, players));

export function nextOpenDraftPick(picks: DraftPick[], settings: LeagueSettings, players: Player[]): { overall: number; teamIndex: number } | null {
  if (areAllRostersComplete(picks, settings, players)) return null;
  const lastRecordedOverall = picks.reduce((maximum, pick) => Math.max(maximum, pick.overall), 0);
  const firstCandidate = Math.max(picks.length, lastRecordedOverall) + 1;
  const searchLimit = firstCandidate + settings.teams * Math.max(1, rosterSize(settings.roster)) * 2;
  for (let overall = firstCandidate; overall <= searchLimit; overall += 1) {
    const teamIndex = teamAtPick(overall, settings.teams, settings.format);
    if (!isTeamRosterComplete(picks, teamIndex, settings.roster, players)) return { overall, teamIndex };
  }
  return null;
}

export function nextPickForTeam(picksMade: number, teamIndex: number, settings: LeagueSettings): number {
  const max = settings.teams * 30;
  for (let overall = picksMade + 1; overall <= max; overall += 1) {
    if (teamAtPick(overall, settings.teams, settings.format) === teamIndex) return overall;
  }
  return max;
}

export function picksUntilNextTurn(picks: DraftPick[], teamIndex: number, settings: LeagueSettings): number {
  const current = Math.max(picks.length, picks.reduce((maximum, pick) => Math.max(maximum, pick.overall), 0)) + 1;
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
    // A per-pick override represents the user's authoritative correction when a
    // provider and the draft platform disagree about roster eligibility.
    const position = pick.position ?? player?.position;
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
