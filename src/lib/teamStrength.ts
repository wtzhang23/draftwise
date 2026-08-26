import type { DraftPick, DraftState, Player, Position, RosterSettings } from '../types';
import { REPLACEMENT_POINTS, substitutionRiskForPlayer } from './optimizer';
import { isTeamRosterComplete } from './draft';

const DIRECT_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const FLEX_POSITIONS = new Set<Position>(['RB', 'WR', 'TE']);

export const TEAM_STRENGTH_HEURISTICS = {
  minimumRiskFactor: 0.62,
  maximumRiskFactor: 1,
  injuryRiskWeight: 0.003,
  uncertaintyWeight: 0.0015,
  neutralGameAvailability: 90,
  gameAvailabilityWeight: 0.0025,
  neutralCoachUsage: 80,
  coachUsageWeight: 0.001,
  neutralSubstitutionRisk: 35,
  substitutionRiskFactorWeight: 0.0008,
  substitutionRiskBlend: 0.20,
  missingStarterReplacementShare: 0.82,
  unknownPlayerReplacementShare: 0.70,
  unknownPlayerRisk: 45,
  benchValueWeight: 0.35,
  qbPassingTdSensitivity: 0.045,
  qbInterceptionSensitivity: 0.025,
  receiverPprSensitivity: 0.20,
  rbPprSensitivity: 0.11,
  minimumScoringMultiplier: 0.72,
  rbMinimumScoringMultiplier: 0.75,
} as const;

export interface StarterAssignment {
  slot: Position | 'FLEX';
  playerId?: string;
  playerName: string;
  position: Position;
  riskAdjustedProjection: number;
  source: 'player-data' | 'unlisted-pick' | 'replacement';
}

export interface TeamStrengthSummary {
  teamIndex: number;
  teamName: string;
  rank: number;
  overallScore: number;
  riskAdjustedStarterProjection: number;
  benchDepth: number;
  averageRisk: number;
  rosterFilled: number;
  rosterTotal: number;
  complete: boolean;
  starters: StarterAssignment[];
  missingStarterSlots: number;
  unknownPlayerCount: number;
  overflowCount: number;
}

interface EvaluatedPick {
  pick: DraftPick;
  position?: Position;
  playerName: string;
  adjustedProjection: number;
  risk: number;
  source: 'player-data' | 'unlisted-pick';
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(finite(value)));
}

function scoringMultiplier(player: Player, state: DraftState): number {
  const scoring = state.settings.scoring;
  if (player.position === 'QB') {
    return Math.max(TEAM_STRENGTH_HEURISTICS.minimumScoringMultiplier, 1
      + (finite(scoring.passingTd, 4) - 4) * TEAM_STRENGTH_HEURISTICS.qbPassingTdSensitivity
      + (finite(scoring.interception, -1) + 1) * TEAM_STRENGTH_HEURISTICS.qbInterceptionSensitivity);
  }
  if (player.position === 'WR' || player.position === 'TE') {
    return Math.max(TEAM_STRENGTH_HEURISTICS.minimumScoringMultiplier,
      1 + (finite(scoring.reception, 1) - 1) * TEAM_STRENGTH_HEURISTICS.receiverPprSensitivity);
  }
  if (player.position === 'RB') {
    return Math.max(TEAM_STRENGTH_HEURISTICS.rbMinimumScoringMultiplier,
      1 + (finite(scoring.reception, 1) - 1) * TEAM_STRENGTH_HEURISTICS.rbPprSensitivity);
  }
  return 1;
}

function evaluatePick(pick: DraftPick, player: Player | undefined, state: DraftState, allPlayers: Player[]): EvaluatedPick {
  if (!player) {
    const position = pick.position;
    // Unknown players remain roster-visible, but receive a deliberately below-replacement
    // estimate rather than being silently treated as either zero-value or fully known.
    const adjustedProjection = position
      ? REPLACEMENT_POINTS[position] * TEAM_STRENGTH_HEURISTICS.unknownPlayerReplacementShare
      : 0;
    return {
      pick,
      position,
      playerName: pick.displayName || 'Unlisted player',
      adjustedProjection,
      risk: TEAM_STRENGTH_HEURISTICS.unknownPlayerRisk,
      source: 'unlisted-pick',
    };
  }

  const injuryRisk = Math.min(100, Math.max(0, finite(player.injuryRisk, TEAM_STRENGTH_HEURISTICS.unknownPlayerRisk)));
  const uncertainty = Math.min(100, Math.max(0, finite(player.context?.uncertainty, TEAM_STRENGTH_HEURISTICS.unknownPlayerRisk)));
  const availabilityAdjustment = (finite(player.context?.gameAvailability, TEAM_STRENGTH_HEURISTICS.neutralGameAvailability)
    - TEAM_STRENGTH_HEURISTICS.neutralGameAvailability) * TEAM_STRENGTH_HEURISTICS.gameAvailabilityWeight;
  const usageAdjustment = (finite(player.context?.coachUsage, TEAM_STRENGTH_HEURISTICS.neutralCoachUsage)
    - TEAM_STRENGTH_HEURISTICS.neutralCoachUsage) * TEAM_STRENGTH_HEURISTICS.coachUsageWeight;
  const substitutionRisk = substitutionRiskForPlayer(player, allPlayers);
  // Projections and role inputs already reflect some competition, so team strength
  // receives only a small residual penalty above a neutral rotation-risk level.
  const substitutionAdjustment = Math.max(0,
    substitutionRisk - TEAM_STRENGTH_HEURISTICS.neutralSubstitutionRisk,
  ) * TEAM_STRENGTH_HEURISTICS.substitutionRiskFactorWeight;
  const riskFactor = Math.min(TEAM_STRENGTH_HEURISTICS.maximumRiskFactor, Math.max(
    TEAM_STRENGTH_HEURISTICS.minimumRiskFactor,
    1 - injuryRisk * TEAM_STRENGTH_HEURISTICS.injuryRiskWeight
      - uncertainty * TEAM_STRENGTH_HEURISTICS.uncertaintyWeight
      - substitutionAdjustment + availabilityAdjustment + usageAdjustment,
  ));

  return {
    pick,
    // Keep the provider's projection, but assign roster eligibility using an
    // explicit user correction when the source position is disputed.
    position: pick.position ?? player.position,
    playerName: player.name,
    adjustedProjection: Math.max(0, finite(player.projectedPoints) * scoringMultiplier(player, state) * riskFactor),
    // Uncertainty is included because data/model risk matters even when injury risk is low.
    risk: Math.min(100, injuryRisk * 0.6 + uncertainty * 0.2
      + substitutionRisk * TEAM_STRENGTH_HEURISTICS.substitutionRiskBlend),
    source: 'player-data',
  };
}

function replacementStarter(slot: Position | 'FLEX'): StarterAssignment {
  const position: Position = slot === 'FLEX' ? 'WR' : slot;
  // FLEX uses the best of the conservative RB/WR/TE replacement estimates. This avoids
  // penalizing an incomplete roster merely because its eventual FLEX position is unknown.
  const baseline = slot === 'FLEX'
    ? Math.max(REPLACEMENT_POINTS.RB, REPLACEMENT_POINTS.WR, REPLACEMENT_POINTS.TE)
    : REPLACEMENT_POINTS[position];
  return {
    slot,
    playerName: `Replacement-level ${slot}`,
    position,
    riskAdjustedProjection: baseline * TEAM_STRENGTH_HEURISTICS.missingStarterReplacementShare,
    source: 'replacement',
  };
}

function assignStarters(roster: EvaluatedPick[], settings: RosterSettings): {
  starters: StarterAssignment[];
  bench: EvaluatedPick[];
} {
  const remaining = [...roster];
  const starters: StarterAssignment[] = [];

  for (const position of DIRECT_POSITIONS) {
    const candidates = remaining
      .filter((candidate) => candidate.position === position)
      .sort((a, b) => b.adjustedProjection - a.adjustedProjection || a.pick.overall - b.pick.overall);
    const required = nonNegativeInteger(settings[position]);
    for (let slotIndex = 0; slotIndex < required; slotIndex += 1) {
      const selected = candidates[slotIndex];
      if (!selected) {
        starters.push(replacementStarter(position));
        continue;
      }
      starters.push({
        slot: position,
        playerId: selected.pick.playerId,
        playerName: selected.playerName,
        position,
        riskAdjustedProjection: selected.adjustedProjection,
        source: selected.source,
      });
      remaining.splice(remaining.indexOf(selected), 1);
    }
  }

  // Direct slots are resolved first; FLEX then selects the strongest remaining eligible
  // players. With only RB/WR/TE flex eligibility, this produces the maximum lineup sum.
  const flexCandidates = remaining
    .filter((candidate) => candidate.position && FLEX_POSITIONS.has(candidate.position))
    .sort((a, b) => b.adjustedProjection - a.adjustedProjection || a.pick.overall - b.pick.overall);
  for (let slotIndex = 0; slotIndex < nonNegativeInteger(settings.FLEX); slotIndex += 1) {
    const selected = flexCandidates[slotIndex];
    if (!selected || !selected.position) {
      starters.push(replacementStarter('FLEX'));
      continue;
    }
    starters.push({
      slot: 'FLEX',
      playerId: selected.pick.playerId,
      playerName: selected.playerName,
      position: selected.position,
      riskAdjustedProjection: selected.adjustedProjection,
      source: selected.source,
    });
    remaining.splice(remaining.indexOf(selected), 1);
  }

  return { starters, bench: remaining };
}

function summarizeTeam(teamIndex: number, state: DraftState, playerById: Map<string, Player>): TeamStrengthSummary {
  const rosterTotal = Object.values(state.settings.roster).reduce((sum, slots) => sum + nonNegativeInteger(slots), 0);
  const allTeamPicks = state.picks.filter((pick) => pick.teamIndex === teamIndex)
    .sort((a, b) => a.overall - b.overall);
  // Capacity is a hard boundary: legacy/imported overflow remains auditable in
  // state but cannot improve strength, depth, risk, or roster progress.
  const teamPicks = allTeamPicks.slice(0, rosterTotal);
  const allPlayers = [...playerById.values()];
  const evaluated = teamPicks.map((pick) => evaluatePick(pick, playerById.get(pick.playerId), state, allPlayers));
  const { starters, bench } = assignStarters(evaluated, state.settings.roster);
  const starterProjection = starters.reduce((sum, starter) => sum + finite(starter.riskAdjustedProjection), 0);

  // Only production above positional replacement contributes to depth. This prevents
  // low-value extra picks from making a partially drafted team look artificially stronger.
  const benchDepth = bench.reduce((sum, player) => {
    if (!player.position) return sum;
    return sum + Math.max(0, player.adjustedProjection - REPLACEMENT_POINTS[player.position]);
  }, 0);
  const averageRisk = evaluated.length
    ? evaluated.reduce((sum, player) => sum + finite(player.risk, TEAM_STRENGTH_HEURISTICS.unknownPlayerRisk), 0) / evaluated.length
    : 0;
  const rosterFilled = Math.min(rosterTotal, teamPicks.length);
  const overallScore = starterProjection + benchDepth * TEAM_STRENGTH_HEURISTICS.benchValueWeight;

  return {
    teamIndex,
    teamName: state.settings.managerNames[teamIndex] || `Manager ${teamIndex + 1}`,
    rank: 0,
    overallScore: finite(overallScore),
    riskAdjustedStarterProjection: finite(starterProjection),
    benchDepth: finite(benchDepth),
    averageRisk: finite(averageRisk),
    rosterFilled,
    rosterTotal,
    complete: rosterTotal > 0 && isTeamRosterComplete(
      state.picks, teamIndex, state.settings.roster, [...playerById.values()],
    ),
    starters,
    missingStarterSlots: starters.filter((starter) => starter.source === 'replacement').length,
    unknownPlayerCount: evaluated.filter((player) => player.source === 'unlisted-pick').length,
    overflowCount: Math.max(0, allTeamPicks.length - rosterTotal),
  };
}

/** Returns summaries in team-index order; `rank` is assigned by descending overall score. */
export function calculateTeamStrengths(state: DraftState, players: Player[]): TeamStrengthSummary[] {
  const playerById = new Map(players.map((player) => [player.id, player]));
  const teamCount = nonNegativeInteger(state.settings.teams);
  const summaries = Array.from({ length: teamCount }, (_, teamIndex) => summarizeTeam(teamIndex, state, playerById));
  const ranked = [...summaries].sort((a, b) => b.overallScore - a.overallScore || a.teamIndex - b.teamIndex);
  ranked.forEach((summary, index) => { summary.rank = index + 1; });
  return summaries;
}
