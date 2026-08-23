import type { DraftState, Player, Position, Recommendation } from '../types';
import { picksUntilNextTurn, rosterCounts, starterNeed } from './draft';

// Baselines approximate the last reliably startable player in a 12-team league.
// Keep these centralized: production adapters should replace them with league-specific baselines.
export const REPLACEMENT_POINTS: Record<Position, number> = {
  QB: 290, RB: 150, WR: 145, TE: 130, K: 125, DST: 120,
};

export const MODEL = {
  minimumScoringMultiplier: 0.72,
  rbMinimumScoringMultiplier: 0.75,
  qbPassingTdSensitivity: 0.045,
  qbInterceptionSensitivity: 0.025,
  receiverPprSensitivity: 0.20,
  rbPprSensitivity: 0.11,
  usageFloor: 0.72,
  usageRange: 0.28,
  neutralAvailability: 0.90,
  neutralCoachUsage: 0.80,
  availabilityResidualWeight: 0.45,
  usageResidualWeight: 0.20,
  minimumPlayFactor: 0.82,
  maximumPlayFactor: 1.08,
  sameTierPointsRatio: 0.90,
  maxOpponentPickShare: 0.78,
  scarcityBufferPlayers: 2,
  scarcityScale: 36,
  minimumAvailabilityRisk: 4,
  maximumAvailabilityRisk: 100,
  availabilityAdpScale: 12,
  startingNeedBonus: 22,
  surplusPositionPenalty: 5,
  marketEdgeLimit: 12,
  marketEdgeScale: 0.22,
  defaultContextBaseline: 70,
  explanationAvailabilityThreshold: 58,
  explanationScarcityThreshold: 8,
  explanationOpponentDemandThreshold: 3,
  explanationStrongSignalThreshold: 86,
  explanationLowAvailabilityThreshold: 82,
  weights: {
    valueOverReplacement: 0.52,
    expectedPoints: 0.16,
    nextTurnAvailability: 0.14,
    injuryPenalty: 0.55,
    upside: 0.12,
    offenseQuality: 0.45,
    opportunity: 0.18,
    roleSecurity: 0.13,
    depthChartSecurity: 0.09,
    lineSkillPosition: 0.65,
    lineOtherPosition: 0.25,
    schedule: 0.35,
    teamChange: 0.80,
    uncertainty: 0.28,
  },
} as const;

function scoringMultiplier(player: Player, state: DraftState): number {
  const scoring = state.settings.scoring;
  // The demo projections are full-PPR/4-point passing-TD baselines. These sensitivities
  // approximate each position's scoring mix until a provider supplies stat-level projections.
  if (player.position === 'QB') {
    return Math.max(MODEL.minimumScoringMultiplier, 1
      + (scoring.passingTd - 4) * MODEL.qbPassingTdSensitivity
      + (scoring.interception + 1) * MODEL.qbInterceptionSensitivity);
  }
  if (player.position === 'WR' || player.position === 'TE') {
    return Math.max(MODEL.minimumScoringMultiplier, 1 + (scoring.reception - 1) * MODEL.receiverPprSensitivity);
  }
  if (player.position === 'RB') {
    return Math.max(MODEL.rbMinimumScoringMultiplier, 1 + (scoring.reception - 1) * MODEL.rbPprSensitivity);
  }
  return 1;
}

export function recommendations(state: DraftState, allPlayers: Player[]): Recommendation[] {
  const drafted = new Set(state.picks.map((pick) => pick.playerId));
  const available = allPlayers.filter((player) => !drafted.has(player.id));
  const own = rosterCounts(state.picks, state.userTeamIndex, allPlayers);
  const untilTurn = picksUntilNextTurn(state.picks, state.userTeamIndex, state.settings);
  const opponentNeeds: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };

  for (let teamIndex = 0; teamIndex < state.settings.teams; teamIndex += 1) {
    if (teamIndex === state.userTeamIndex) continue;
    const counts = rosterCounts(state.picks, teamIndex, allPlayers);
    (Object.keys(opponentNeeds) as Position[]).forEach((position) => {
      opponentNeeds[position] += Math.min(1, starterNeed(position, counts, state.settings.roster));
    });
  }

  // Players within 10% of a candidate's projection are treated as members of the same usable tier.
  const positionDepth = (position: Position, points: number) => available.filter(
    (player) => player.position === position && player.projectedPoints >= points * MODEL.sameTierPointsRatio,
  ).length;
  const projectionOrder = available.slice().sort((a, b) => b.projectedPoints - a.projectedPoints);

  return available
    .filter((player) => state.activePosition === 'ALL' || player.position === state.activePosition)
    .map((player) => {
      // Provider season projections usually encode expected missed time and role already. Apply only
      // residual movement around neutral priors so availability/usage matter without double counting.
      const availabilityResidual = player.context.gameAvailability / 100 - MODEL.neutralAvailability;
      const usageResidual = player.context.coachUsage / 100 - MODEL.neutralCoachUsage;
      const playFactor = Math.max(MODEL.minimumPlayFactor, Math.min(MODEL.maximumPlayFactor,
        1 + availabilityResidual * MODEL.availabilityResidualWeight
        + usageResidual * MODEL.usageResidualWeight,
      ));
      const expectedPoints = player.projectedPoints * scoringMultiplier(player, state) * playFactor;
      const value = Math.max(0, expectedPoints - REPLACEMENT_POINTS[player.position]);
      const need = starterNeed(player.position, own, state.settings.roster);
      const depth = positionDepth(player.position, player.projectedPoints);
      const demand = opponentNeeds[player.position];

      // Estimate how many position-needy opponents pick before the user's next turn.
      // The cap avoids assuming every intervening selection attacks the same position.
      const expectedBeforeTurn = Math.max(0, untilTurn * Math.min(
        MODEL.maxOpponentPickShare,
        demand / Math.max(1, state.settings.teams - 1),
      ));
      const scarcity = Math.max(0,
        (expectedBeforeTurn + MODEL.scarcityBufferPlayers - depth)
        / Math.max(MODEL.scarcityBufferPlayers, depth + 1),
      ) * MODEL.scarcityScale;

      // ADP is a market survival prior, not a talent score. It only estimates whether waiting is costly.
      const adpUrgency = Math.max(0,
        (state.picks.length + untilTurn - player.adp) / Math.max(6, untilTurn),
      ) * MODEL.availabilityAdpScale;
      const availabilityRisk = Math.min(MODEL.maximumAvailabilityRisk, Math.max(
        MODEL.minimumAvailabilityRisk,
        (1 - Math.exp(-untilTurn / Math.max(3, player.adp - state.picks.length))) * 100 + adpUrgency,
      ));

      // Risk tolerance softens injury and model-uncertainty penalties but never removes them.
      const injuryPenalty = player.injuryRisk * (1.15 - state.riskTolerance / 150);
      const uncertaintyPenalty = player.context.uncertainty
        * (1.1 - state.riskTolerance / 120) * MODEL.weights.uncertainty;
      const rosterFit = need * MODEL.startingNeedBonus
        - Math.max(0, own[player.position] - (state.settings.roster[player.position] ?? 0)) * MODEL.surplusPositionPenalty;
      const upside = (player.ceiling - player.projectedPoints)
        * (state.riskTolerance / 100) * MODEL.weights.upside;

      // Context intentionally uses modest weights because provider projections already encode some situation.
      // This prevents double-counting while still reacting to role/team changes the baseline may lag.
      const contextAdjustment = player.context.offenseQuality * MODEL.weights.offenseQuality
        + (player.context.opportunity - MODEL.defaultContextBaseline) * MODEL.weights.opportunity
        + (player.context.roleSecurity - MODEL.defaultContextBaseline) * MODEL.weights.roleSecurity
        + (player.context.depthChartSecurity - MODEL.defaultContextBaseline) * MODEL.weights.depthChartSecurity
        + player.context.lineOrProtection * (
          player.position === 'RB' || player.position === 'QB'
            ? MODEL.weights.lineSkillPosition : MODEL.weights.lineOtherPosition
        )
        + player.context.schedule * MODEL.weights.schedule
        + player.context.teamChangeImpact * MODEL.weights.teamChange;

      // Positive market edge means the projection model ranks the player above draft-market cost.
      const projectionRank = projectionOrder.findIndex((candidate) => candidate.id === player.id) + 1;
      const marketEdge = Math.max(-MODEL.marketEdgeLimit, Math.min(
        MODEL.marketEdgeLimit,
        (player.adp - (state.picks.length + projectionRank)) * MODEL.marketEdgeScale,
      ));

      const score = value * MODEL.weights.valueOverReplacement
        + expectedPoints * MODEL.weights.expectedPoints
        + scarcity * (state.scarcityWeight / 50)
        + rosterFit
        + availabilityRisk * MODEL.weights.nextTurnAvailability
        + upside + contextAdjustment + marketEdge
        - injuryPenalty * MODEL.weights.injuryPenalty - uncertaintyPenalty;

      const reasons: string[] = [];
      if (need >= 1) reasons.push(`Fills a starting ${player.position} need`);
      if (availabilityRisk > MODEL.explanationAvailabilityThreshold) reasons.push(`${Math.round(availabilityRisk)}% chance unavailable next turn`);
      if (scarcity > MODEL.explanationScarcityThreshold) reasons.push(`${player.position} tier is thinning quickly`);
      if (demand >= MODEL.explanationOpponentDemandThreshold) reasons.push(`${Math.round(demand)} opponents still need ${player.position}`);
      if (player.context.teamChangeImpact >= 3) reasons.push('Team change improves expected scoring environment');
      if (player.context.opportunity >= MODEL.explanationStrongSignalThreshold) reasons.push('High projected share of team opportunities');
      if (player.context.gameAvailability < MODEL.explanationLowAvailabilityThreshold) reasons.push(`${Math.round(player.context.gameAvailability)}% modeled active-game probability`);
      if (player.context.coachUsage >= MODEL.explanationStrongSignalThreshold) reasons.push('Strong coach usage and role-security signal');
      if (player.context.offenseQuality >= 7) reasons.push('Attached to a high-scoring offense');
      if (marketEdge >= 5) reasons.push('Model sees value above current draft market');
      if (player.injuryRisk >= 22) reasons.push(`Risk adjusted for ${player.injuryRisk}% injury signal`);
      if (!reasons.length) reasons.push('Strong risk-adjusted value at this pick');

      return {
        player, score, value, scarcity, availabilityRisk, injuryPenalty, rosterFit,
        contextAdjustment, marketEdge,
        confidence: Math.round(Math.max(48, 96 - player.injuryRisk * 0.45 - player.context.uncertainty * 0.65)),
        reasons: reasons.slice(0, 3),
      };
    })
    .sort((a, b) => b.score - a.score);
}
