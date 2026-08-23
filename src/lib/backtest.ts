/**
 * Deterministic, provider-agnostic fantasy draft backtesting.
 *
 * The public draft strategy boundary only contains `PreseasonPlayerSnapshot` data.
 * Realized outcomes are joined after a draft has completed, which makes accidental
 * in-season outcome leakage impossible for a type-safe strategy implementation.
 */

export type PlayerId = string;
export type PositionId = string;

export interface PreseasonPlayerSnapshot {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly season: number;
  readonly position: PositionId;
  readonly projectedValue: number;
  readonly adp: number;
  readonly tier?: number;
  readonly availabilityProbability?: number;
  /** Provider-specific numeric signals normalized before entering the backtest. */
  readonly features?: Readonly<Record<string, number>>;
}

export interface RealizedSeasonOutcome {
  readonly playerId: PlayerId;
  readonly season: number;
  readonly realizedValue: number;
  /** Binary target for a preseason probability, when the source supplies one. */
  readonly wasAvailable?: boolean;
}

export interface HistoricalSeasonInput {
  readonly season: number;
  readonly preseason: readonly PreseasonPlayerSnapshot[];
  readonly outcomes: readonly RealizedSeasonOutcome[];
}

export interface RosterSlotDefinition {
  readonly name: string;
  readonly count: number;
  readonly eligiblePositions: readonly PositionId[];
  readonly starter: boolean;
}

export type BaselineStrategyId = 'adp' | 'projection-only' | 'need-aware' | 'random-top-tier';

export interface OpponentProfile {
  readonly id: string;
  readonly strategy: BaselineStrategyId;
}

export interface DraftedPlayer {
  readonly player: PreseasonPlayerSnapshot;
  readonly teamIndex: number;
  readonly overallPick: number;
}

export interface DraftDecisionContext {
  readonly season: number;
  readonly overallPick: number;
  readonly teamIndex: number;
  readonly userTeamIndex: number;
  readonly teams: number;
  readonly available: readonly PreseasonPlayerSnapshot[];
  readonly roster: readonly PreseasonPlayerSnapshot[];
  readonly allRosters: readonly (readonly PreseasonPlayerSnapshot[])[];
  readonly picks: readonly DraftedPlayer[];
  readonly rosterSlots: readonly RosterSlotDefinition[];
  /** A deterministic draw scoped to this decision. */
  readonly random: () => number;
}

export interface BacktestStrategy {
  readonly id: string;
  readonly name: string;
  selectPlayer(context: DraftDecisionContext): PlayerId;
}

export interface BacktestConfig {
  readonly seasons: readonly HistoricalSeasonInput[];
  readonly rosterSlots: readonly RosterSlotDefinition[];
  readonly teams: number;
  readonly trialsPerSeason: number;
  readonly seed: number;
  readonly optimizer?: BacktestStrategy;
  readonly opponentProfilePool?: readonly OpponentProfile[];
  /** Defaults to true. When false, userDraftSlot is required (zero based). */
  readonly randomizeUserDraftSlot?: boolean;
  readonly userDraftSlot?: number;
}

export interface StrategyMetrics {
  readonly meanRealizedStarterValue: number;
  readonly meanRealizedRosterValue: number;
  readonly averageRank: number;
  readonly winRate: number;
  readonly meanRegretVersusHindsightOracle: number;
  readonly availabilityProbabilityBrierScore: number | null;
}

export interface StrategyBacktestResult {
  readonly strategyId: string;
  readonly strategyName: string;
  readonly metrics: StrategyMetrics;
}

export interface PairedComparison {
  readonly optimizerStrategyId: string;
  readonly baselineStrategyId: BaselineStrategyId;
  readonly meanStarterValueDelta: number;
  readonly meanRosterValueDelta: number;
  readonly meanRankImprovement: number;
  readonly headToHeadWinRate: number;
}

export interface BacktestReport {
  readonly seed: number;
  readonly scenarios: number;
  readonly results: readonly StrategyBacktestResult[];
  readonly pairedComparisons: readonly PairedComparison[];
  readonly sampledUserDraftSlots: Readonly<Record<number, number>>;
  readonly sampledOpponentProfiles: Readonly<Record<string, number>>;
}

/** Named constants keep assumptions auditable and easy to calibrate on real seasons. */
export const BACKTEST_HEURISTICS = {
  // Ten players is wide enough to introduce realistic draft variance without becoming pure noise.
  randomTopTierFallbackSize: 10,
  // Players within 10% of a projection are treated as substitutes for scarcity purposes.
  comparableProjectionRatio: 0.9,
  // Value over a position's estimated replacement level matters, but less than raw expected value.
  valueOverReplacementWeight: 0.35,
  // Filling an uncovered starter slot is worth roughly a mid-tier weekly starter upgrade.
  starterNeedBonus: 15,
  // Scarcity is intentionally capped so it cannot overwhelm a materially stronger projection.
  maximumScarcityBonus: 12,
  // Market survival is a timing signal, not a talent signal, so its contribution stays modest.
  maximumAdpUrgencyBonus: 8,
  // Opponents are not perfectly predictable; a small deterministic perturbation avoids clones.
  opponentNoiseFraction: 0.025,
  // Consensus draft ranks already react to known injuries. Availability only adjusts the residual
  // around a neutral prior, avoiding the failed double-penalty exposed by historical testing.
  neutralAvailabilityProbability: 0.85,
  availabilityResidualWeight: 18,
} as const;

interface ExpandedSlot {
  readonly name: string;
  readonly eligiblePositions: readonly PositionId[];
  readonly starter: boolean;
}

interface Scenario {
  readonly season: HistoricalSeasonInput;
  readonly scenarioSeed: number;
  readonly userTeamIndex: number;
  readonly opponents: readonly OpponentProfile[];
}

interface TrialResult {
  readonly starterValue: number;
  readonly rosterValue: number;
  readonly rank: number;
  readonly winCredit: number;
  readonly regret: number;
}

const DEFAULT_OPPONENTS: readonly OpponentProfile[] = [
  { id: 'market', strategy: 'adp' },
  { id: 'projections', strategy: 'projection-only' },
  { id: 'roster-builder', strategy: 'need-aware' },
  { id: 'tier-drafter', strategy: 'random-top-tier' },
];

function expandSlots(definitions: readonly RosterSlotDefinition[]): ExpandedSlot[] {
  return definitions.flatMap((slot) => Array.from({ length: slot.count }, (_, index) => ({
    name: `${slot.name}-${index + 1}`,
    eligiblePositions: slot.eligiblePositions,
    starter: slot.starter,
  })));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixSeed(...values: number[]): number {
  let mixed = 0x9e3779b9;
  for (const value of values) {
    mixed ^= value + 0x9e3779b9 + (mixed << 6) + (mixed >>> 2);
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  }
  return mixed >>> 0;
}

/** Mulberry32 provides repeatability, not cryptographic randomness. */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function teamAtPick(overallPick: number, teams: number): number {
  const round = Math.floor((overallPick - 1) / teams);
  const offset = (overallPick - 1) % teams;
  return round % 2 === 0 ? offset : teams - 1 - offset;
}

function picksUntilNextTurn(overallPick: number, teamIndex: number, teams: number, rosterSize: number): number {
  for (let next = overallPick + 1; next <= teams * rosterSize; next += 1) {
    if (teamAtPick(next, teams) === teamIndex) return next - overallPick;
  }
  return 0;
}

function canAssignPlayers(players: readonly PreseasonPlayerSnapshot[], slots: readonly ExpandedSlot[]): boolean {
  if (players.length > slots.length) return false;
  const slotOwners = Array<number>(slots.length).fill(-1);

  const assign = (playerIndex: number, seen: boolean[]): boolean => {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (seen[slotIndex] || !slots[slotIndex].eligiblePositions.includes(players[playerIndex].position)) continue;
      seen[slotIndex] = true;
      if (slotOwners[slotIndex] === -1 || assign(slotOwners[slotIndex], seen)) {
        slotOwners[slotIndex] = playerIndex;
        return true;
      }
    }
    return false;
  };

  return players.every((_, playerIndex) => assign(playerIndex, Array(slots.length).fill(false)));
}

function legalPlayers(
  available: readonly PreseasonPlayerSnapshot[],
  roster: readonly PreseasonPlayerSnapshot[],
  slots: readonly ExpandedSlot[],
): PreseasonPlayerSnapshot[] {
  return available.filter((player) => canAssignPlayers([...roster, player], slots));
}

function maximumLineupValue(
  players: readonly PreseasonPlayerSnapshot[],
  slots: readonly ExpandedSlot[],
  valueOf: (player: PreseasonPlayerSnapshot) => number,
): number {
  if (!slots.length || !players.length) return 0;
  const impossible = Number.NEGATIVE_INFINITY;
  let values = Array<number>(1 << slots.length).fill(impossible);
  values[0] = 0;

  for (const player of players) {
    const next = values.slice();
    for (let mask = 0; mask < values.length; mask += 1) {
      if (values[mask] === impossible) continue;
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        if ((mask & (1 << slotIndex)) !== 0 || !slots[slotIndex].eligiblePositions.includes(player.position)) continue;
        const nextMask = mask | (1 << slotIndex);
        next[nextMask] = Math.max(next[nextMask], values[mask] + valueOf(player));
      }
    }
    values = next;
  }
  return Math.max(0, ...values.filter(Number.isFinite));
}

function starterNeed(player: PreseasonPlayerSnapshot, roster: readonly PreseasonPlayerSnapshot[], slots: readonly ExpandedSlot[]): number {
  const starterSlots = slots.filter((slot) => slot.starter);
  const before = maximumLineupValue(roster, starterSlots, () => 1);
  const after = maximumLineupValue([...roster, player], starterSlots, () => 1);
  return after > before ? 1 : 0;
}

function byAdp(context: DraftDecisionContext): PlayerId {
  return context.available.reduce((best, player) => player.adp < best.adp ? player : best).playerId;
}

function byProjection(context: DraftDecisionContext): PlayerId {
  return context.available.reduce((best, player) => player.projectedValue > best.projectedValue ? player : best).playerId;
}

function needAware(context: DraftDecisionContext): PlayerId {
  const slots = expandSlots(context.rosterSlots);
  return context.available.reduce((best, player) => {
    const score = player.projectedValue + starterNeed(player, context.roster, slots) * BACKTEST_HEURISTICS.starterNeedBonus;
    const bestScore = best.projectedValue + starterNeed(best, context.roster, slots) * BACKTEST_HEURISTICS.starterNeedBonus;
    return score > bestScore ? player : best;
  }).playerId;
}

function randomWithinTopTier(context: DraftDecisionContext): PlayerId {
  const tiers = context.available.map((player) => player.tier).filter((tier): tier is number => tier !== undefined);
  let top: readonly PreseasonPlayerSnapshot[];
  if (tiers.length) {
    const bestTier = Math.min(...tiers);
    top = context.available.filter((player) => player.tier === bestTier);
  } else {
    top = [...context.available]
      .sort((left, right) => left.adp - right.adp)
      .slice(0, BACKTEST_HEURISTICS.randomTopTierFallbackSize);
  }
  return top[Math.floor(context.random() * top.length)].playerId;
}

export const BASELINE_STRATEGIES: Readonly<Record<BaselineStrategyId, BacktestStrategy>> = {
  adp: { id: 'adp', name: 'ADP', selectPlayer: byAdp },
  'projection-only': { id: 'projection-only', name: 'Projection only', selectPlayer: byProjection },
  'need-aware': { id: 'need-aware', name: 'Need aware', selectPlayer: needAware },
  'random-top-tier': { id: 'random-top-tier', name: 'Random within top tier', selectPlayer: randomWithinTopTier },
};

function defaultOptimizerSelect(context: DraftDecisionContext): PlayerId {
  const slots = expandSlots(context.rosterSlots);
  const rosterSize = slots.length;
  const nextTurn = picksUntilNextTurn(context.overallPick, context.teamIndex, context.teams, rosterSize);
  const byPosition = new Map<PositionId, PreseasonPlayerSnapshot[]>();
  for (const candidate of context.available) {
    const group = byPosition.get(candidate.position) ?? [];
    group.push(candidate);
    byPosition.set(candidate.position, group);
  }
  for (const group of byPosition.values()) group.sort((left, right) => right.projectedValue - left.projectedValue);

  let best = context.available[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const player of context.available) {
    const positionPool = byPosition.get(player.position) ?? [player];
    const replacementIndex = Math.min(positionPool.length - 1, Math.max(0, context.teams - 1));
    const replacement = positionPool[replacementIndex]?.projectedValue ?? 0;
    const availabilityResidual = (player.availabilityProbability ?? BACKTEST_HEURISTICS.neutralAvailabilityProbability)
      - BACKTEST_HEURISTICS.neutralAvailabilityProbability;
    const expected = player.projectedValue
      + availabilityResidual * BACKTEST_HEURISTICS.availabilityResidualWeight;
    const comparable = positionPool.filter(
      (candidate) => candidate.projectedValue >= player.projectedValue * BACKTEST_HEURISTICS.comparableProjectionRatio,
    ).length;

    // Scarcity estimates whether comparable options can survive the intervening picks.
    const scarcityPressure = Math.max(0, nextTurn - comparable) / Math.max(1, nextTurn);
    const scarcityBonus = Math.min(
      BACKTEST_HEURISTICS.maximumScarcityBonus,
      scarcityPressure * BACKTEST_HEURISTICS.maximumScarcityBonus,
    );
    // ADP contributes only urgency: an early market price suggests waiting is unlikely to work.
    const adpUrgency = nextTurn === 0 ? 0 : Math.max(0,
      (context.overallPick + nextTurn - player.adp) / nextTurn,
    ) * BACKTEST_HEURISTICS.maximumAdpUrgencyBonus;
    const score = expected
      + Math.max(0, expected - replacement) * BACKTEST_HEURISTICS.valueOverReplacementWeight
      + starterNeed(player, context.roster, slots) * BACKTEST_HEURISTICS.starterNeedBonus
      + scarcityBonus
      + Math.min(BACKTEST_HEURISTICS.maximumAdpUrgencyBonus, adpUrgency);
    if (score > bestScore || (score === bestScore && player.adp < best.adp)) {
      best = player;
      bestScore = score;
    }
  }
  return best.playerId;
}

export const DEFAULT_OPTIMIZER_STRATEGY: BacktestStrategy = {
  id: 'optimizer',
  name: 'Risk-adjusted optimizer',
  selectPlayer: defaultOptimizerSelect,
};

function validateConfig(config: BacktestConfig): ExpandedSlot[] {
  if (!Number.isInteger(config.teams) || config.teams < 2) throw new Error('teams must be an integer of at least 2');
  if (!Number.isInteger(config.trialsPerSeason) || config.trialsPerSeason < 1) throw new Error('trialsPerSeason must be positive');
  if (!Number.isFinite(config.seed)) throw new Error('seed must be finite');
  if (!config.seasons.length) throw new Error('at least one historical season is required');
  const slots = expandSlots(config.rosterSlots);
  if (!slots.length) throw new Error('at least one roster slot is required');
  if (slots.filter((slot) => slot.starter).length > 20) throw new Error('at most 20 starter slots are supported');
  if (config.randomizeUserDraftSlot === false
    && (!Number.isInteger(config.userDraftSlot) || config.userDraftSlot! < 0 || config.userDraftSlot! >= config.teams)) {
    throw new Error('userDraftSlot must be a valid zero-based slot when randomization is disabled');
  }

  for (const season of config.seasons) {
    const ids = new Set<string>();
    for (const player of season.preseason) {
      if (player.season !== season.season) throw new Error(`preseason season mismatch for ${player.playerId}`);
      if (ids.has(player.playerId)) throw new Error(`duplicate preseason player ${player.playerId}`);
      if (player.availabilityProbability !== undefined
        && (player.availabilityProbability < 0 || player.availabilityProbability > 1)) {
        throw new Error(`availabilityProbability must be between 0 and 1 for ${player.playerId}`);
      }
      ids.add(player.playerId);
    }
    const outcomeIds = new Set<string>();
    for (const outcome of season.outcomes) {
      if (outcome.season !== season.season) throw new Error(`outcome season mismatch for ${outcome.playerId}`);
      if (outcomeIds.has(outcome.playerId)) throw new Error(`duplicate outcome ${outcome.playerId}`);
      outcomeIds.add(outcome.playerId);
    }
    if (season.preseason.length < config.teams * slots.length) {
      throw new Error(`season ${season.season} does not contain enough players for the draft`);
    }
  }
  return slots;
}

function selectForProfile(profile: OpponentProfile, context: DraftDecisionContext): PlayerId {
  const strategy = BASELINE_STRATEGIES[profile.strategy];
  // Noise models imperfect opponent adherence while staying deterministic and small enough
  // that each profile retains its intended identity.
  if (context.available.length > 1 && context.random() < BACKTEST_HEURISTICS.opponentNoiseFraction) {
    const first = strategy.selectPlayer(context);
    return context.available.find((player) => player.playerId !== first)?.playerId ?? first;
  }
  return strategy.selectPlayer(context);
}

function simulateDraft(
  scenario: Scenario,
  strategy: BacktestStrategy,
  slots: readonly ExpandedSlot[],
): readonly (readonly PreseasonPlayerSnapshot[])[] {
  const available = new Map(scenario.season.preseason.map((player) => [player.playerId, player]));
  const rosters: PreseasonPlayerSnapshot[][] = Array.from({ length: scenario.opponents.length }, () => []);
  const picks: DraftedPlayer[] = [];
  const totalPicks = rosters.length * slots.length;

  for (let overallPick = 1; overallPick <= totalPicks; overallPick += 1) {
    const teamIndex = teamAtPick(overallPick, rosters.length);
    const candidates = legalPlayers([...available.values()], rosters[teamIndex], slots);
    if (!candidates.length) throw new Error(`no legal selection at pick ${overallPick}`);
    const decisionSeed = mixSeed(scenario.scenarioSeed, overallPick, teamIndex);
    const context: DraftDecisionContext = {
      season: scenario.season.season,
      overallPick,
      teamIndex,
      userTeamIndex: scenario.userTeamIndex,
      teams: rosters.length,
      available: candidates,
      roster: rosters[teamIndex],
      allRosters: rosters,
      picks,
      rosterSlots: slots.map((slot) => ({
        name: slot.name, count: 1, eligiblePositions: slot.eligiblePositions, starter: slot.starter,
      })),
      random: createSeededRng(mixSeed(decisionSeed, hashText(teamIndex === scenario.userTeamIndex ? strategy.id : 'opponent'))),
    };
    const selectedId = teamIndex === scenario.userTeamIndex
      ? strategy.selectPlayer(context)
      : selectForProfile(scenario.opponents[teamIndex], context);
    const selected = candidates.find((player) => player.playerId === selectedId);
    if (!selected) throw new Error(`${teamIndex === scenario.userTeamIndex ? strategy.id : scenario.opponents[teamIndex].id} selected unavailable player ${selectedId}`);
    rosters[teamIndex].push(selected);
    available.delete(selected.playerId);
    picks.push({ player: selected, teamIndex, overallPick });
  }
  return rosters;
}

function evaluateTrial(scenario: Scenario, rosters: readonly (readonly PreseasonPlayerSnapshot[])[], slots: readonly ExpandedSlot[]): TrialResult {
  const outcomes = new Map(scenario.season.outcomes.map((outcome) => [outcome.playerId, outcome]));
  const realized = (player: PreseasonPlayerSnapshot): number => outcomes.get(player.playerId)?.realizedValue ?? 0;
  const starterSlots = slots.filter((slot) => slot.starter);
  const teamStarterValues = rosters.map((roster) => maximumLineupValue(roster, starterSlots, realized));
  const userStarterValue = teamStarterValues[scenario.userTeamIndex];
  const userRosterValue = rosters[scenario.userTeamIndex].reduce((sum, player) => sum + realized(player), 0);
  const higher = teamStarterValues.filter((value) => value > userStarterValue).length;
  const tied = teamStarterValues.filter((value) => value === userStarterValue).length;
  const maxValue = Math.max(...teamStarterValues);

  // The oracle is an explicit upper bound: the best legal starting lineup from the full
  // preseason pool using outcomes only after drafting. This makes regret non-negative and
  // comparable across strategies without exposing outcomes to any strategy callback.
  const oracleValue = maximumLineupValue(scenario.season.preseason, starterSlots, realized);
  return {
    starterValue: userStarterValue,
    rosterValue: userRosterValue,
    rank: 1 + higher + (tied - 1) / 2,
    winCredit: userStarterValue === maxValue ? 1 / tied : 0,
    regret: oracleValue - userStarterValue,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function brierScore(seasons: readonly HistoricalSeasonInput[]): number | null {
  const errors: number[] = [];
  for (const season of seasons) {
    const outcomes = new Map(season.outcomes.map((outcome) => [outcome.playerId, outcome]));
    for (const player of season.preseason) {
      const observed = outcomes.get(player.playerId)?.wasAvailable;
      if (player.availabilityProbability === undefined || observed === undefined) continue;
      errors.push((player.availabilityProbability - (observed ? 1 : 0)) ** 2);
    }
  }
  return errors.length ? mean(errors) : null;
}

function buildScenarios(config: BacktestConfig): {
  scenarios: Scenario[];
  slotCounts: Record<number, number>;
  profileCounts: Record<string, number>;
} {
  const scenarios: Scenario[] = [];
  const slotCounts: Record<number, number> = {};
  const profileCounts: Record<string, number> = {};
  const profilePool = config.opponentProfilePool?.length ? config.opponentProfilePool : DEFAULT_OPPONENTS;

  config.seasons.forEach((season, seasonIndex) => {
    for (let trial = 0; trial < config.trialsPerSeason; trial += 1) {
      const scenarioSeed = mixSeed(config.seed, season.season, seasonIndex, trial);
      const rng = createSeededRng(scenarioSeed);
      const userTeamIndex = config.randomizeUserDraftSlot === false
        ? config.userDraftSlot!
        : Math.floor(rng() * config.teams);
      const opponents = Array.from({ length: config.teams }, (_, teamIndex) => {
        const profile = teamIndex === userTeamIndex
          ? { id: 'user', strategy: 'adp' as const }
          : profilePool[Math.floor(rng() * profilePool.length)];
        if (teamIndex !== userTeamIndex) profileCounts[profile.id] = (profileCounts[profile.id] ?? 0) + 1;
        return profile;
      });
      slotCounts[userTeamIndex] = (slotCounts[userTeamIndex] ?? 0) + 1;
      scenarios.push({ season, scenarioSeed, userTeamIndex, opponents });
    }
  });
  return { scenarios, slotCounts, profileCounts };
}

export function runBacktest(config: BacktestConfig): BacktestReport {
  const slots = validateConfig(config);
  const optimizer = config.optimizer ?? DEFAULT_OPTIMIZER_STRATEGY;
  if (Object.hasOwn(BASELINE_STRATEGIES, optimizer.id)) throw new Error('optimizer id must not match a baseline id');
  const scenarioData = buildScenarios(config);
  const strategies: readonly BacktestStrategy[] = [optimizer, ...Object.values(BASELINE_STRATEGIES)];
  const trialResults = new Map<string, TrialResult[]>();
  for (const strategy of strategies) trialResults.set(strategy.id, []);

  for (const scenario of scenarioData.scenarios) {
    for (const strategy of strategies) {
      const rosters = simulateDraft(scenario, strategy, slots);
      trialResults.get(strategy.id)!.push(evaluateTrial(scenario, rosters, slots));
    }
  }

  const availabilityProbabilityBrierScore = brierScore(config.seasons);
  const results = strategies.map((strategy): StrategyBacktestResult => {
    const trials = trialResults.get(strategy.id)!;
    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      metrics: {
        meanRealizedStarterValue: mean(trials.map((trial) => trial.starterValue)),
        meanRealizedRosterValue: mean(trials.map((trial) => trial.rosterValue)),
        averageRank: mean(trials.map((trial) => trial.rank)),
        winRate: mean(trials.map((trial) => trial.winCredit)),
        meanRegretVersusHindsightOracle: mean(trials.map((trial) => trial.regret)),
        availabilityProbabilityBrierScore,
      },
    };
  });

  const optimizerTrials = trialResults.get(optimizer.id)!;
  const pairedComparisons = (Object.keys(BASELINE_STRATEGIES) as BaselineStrategyId[]).map((baselineStrategyId) => {
    const baselineTrials = trialResults.get(baselineStrategyId)!;
    return {
      optimizerStrategyId: optimizer.id,
      baselineStrategyId,
      meanStarterValueDelta: mean(optimizerTrials.map((trial, index) => trial.starterValue - baselineTrials[index].starterValue)),
      meanRosterValueDelta: mean(optimizerTrials.map((trial, index) => trial.rosterValue - baselineTrials[index].rosterValue)),
      meanRankImprovement: mean(optimizerTrials.map((trial, index) => baselineTrials[index].rank - trial.rank)),
      headToHeadWinRate: mean(optimizerTrials.map((trial, index) => {
        if (trial.starterValue === baselineTrials[index].starterValue) return 0.5;
        return trial.starterValue > baselineTrials[index].starterValue ? 1 : 0;
      })),
    } satisfies PairedComparison;
  });

  return {
    seed: config.seed,
    scenarios: scenarioData.scenarios.length,
    results,
    pairedComparisons,
    sampledUserDraftSlots: scenarioData.slotCounts,
    sampledOpponentProfiles: scenarioData.profileCounts,
  };
}
