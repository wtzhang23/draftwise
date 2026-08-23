import type { Player, Position } from '../types';

export interface FantasyProsStatus {
  configured: boolean;
  live: boolean;
  provider: 'fantasypros';
  message?: string;
}

export interface FantasyProsPayload {
  rankings?: unknown;
  projections?: unknown;
  injuries?: unknown;
  [key: string]: unknown;
}

export interface FantasyProsDataResult {
  players: Player[];
  status: FantasyProsStatus;
  season: number;
}

export class FantasyProsClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'FantasyProsClientError';
    this.statusCode = statusCode;
  }
}

type UnknownRecord = Record<string, unknown>;
type SourceKind = 'rankings' | 'projections' | 'injuries';

interface PlayerAccumulator {
  name: string;
  ranking?: UnknownRecord;
  projection?: UnknownRecord;
  injury?: UnknownRecord;
}

// These defaults are deliberately centralized: they are model assumptions, not
// observations supplied by FantasyPros, and should be easy to tune/backtest.
const FALLBACK = {
  byeWeek: 0,
  projectedPoints: 0,
  floorRatio: 0.72,
  ceilingRatio: 1.28,
  unknownAdp: 300,
  playersPerTier: 12,
  healthyInjuryRisk: 5,
  questionableInjuryRisk: 35,
  doubtfulInjuryRisk: 70,
  outInjuryRisk: 95,
  offenseQuality: 0,
  lineOrProtection: 0,
  schedule: 0,
  teamChangeImpact: 0,
  opportunityBase: 96,
  opportunityRankPenalty: 0.16,
  minimumOpportunity: 40,
  roleSecurityBase: 96,
  roleInjuryPenalty: 0.45,
  minimumRoleSecurity: 35,
  coachUsageBase: 94,
  coachUsageRankPenalty: 0.12,
  minimumCoachUsage: 38,
  depthChartBase: 96,
  depthChartRankPenalty: 0.1,
  minimumDepthChartSecurity: 40,
  uncertaintyBase: 8,
  uncertaintyInjuryGrowth: 0.35,
  maximumUncertainty: 50,
} as const;

const POSITION_ALIASES: Record<string, Position> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', K: 'K', PK: 'K',
  DST: 'DST', DEF: 'DST', D: 'DST',
};

const NAME_FIELDS = ['player_name', 'name', 'full_name', 'playerName', 'player'] as const;
const TEAM_FIELDS = ['player_team_id', 'team_id', 'team', 'team_abbr', 'team_abbreviation'] as const;
const POSITION_FIELDS = ['player_position_id', 'position_id', 'position', 'pos'] as const;
const PROJECTION_FIELDS = ['projected_points', 'fantasy_points', 'fpts', 'points', 'projection'] as const;
const ADP_FIELDS = ['adp', 'rank_ecr', 'ecr', 'overall_rank', 'rank'] as const;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const firstValue = (record: UnknownRecord | undefined, fields: readonly string[]): unknown => {
  if (!record) return undefined;
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (isRecord(value)) return asString(firstValue(value, NAME_FIELDS));
  return undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[%,$]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export const normalizePlayerName = (name: string): string => name
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

const slug = (value: string) => value.toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const rowName = (row: UnknownRecord): string | undefined => asString(firstValue(row, NAME_FIELDS));

const looksLikePlayerRow = (value: unknown): value is UnknownRecord =>
  isRecord(value) && Boolean(rowName(value));

/** Finds player arrays without depending on one FantasyPros response envelope. */
const collectRows = (root: unknown, kind: SourceKind): UnknownRecord[] => {
  const rows: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const preferredKeys = kind === 'injuries'
    ? ['injuries', 'players', 'data', 'results']
    : ['players', kind, 'data', 'results', 'rankings'];

  const visit = (value: unknown, depth: number) => {
    if (depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (looksLikePlayerRow(item) && !seen.has(item)) {
          seen.add(item);
          rows.push(item);
        } else if (isRecord(item) || Array.isArray(item)) {
          visit(item, depth + 1);
        }
      }
      return;
    }
    if (!isRecord(value)) return;
    const orderedKeys = [...preferredKeys, ...Object.keys(value).filter((key) => !preferredKeys.includes(key))];
    for (const key of new Set(orderedKeys)) visit(value[key], depth + 1);
  };

  visit(root, 0);
  return rows;
};

const positionFrom = (...records: Array<UnknownRecord | undefined>): Position | undefined => {
  for (const record of records) {
    const raw = asString(firstValue(record, POSITION_FIELDS))?.toUpperCase();
    if (raw && POSITION_ALIASES[raw]) return POSITION_ALIASES[raw];
  }
  return undefined;
};

const statusText = (injury: UnknownRecord | undefined): string =>
  asString(firstValue(injury, ['status', 'injury_status', 'game_status', 'practice_status', 'availability'])) ?? 'Healthy';

const injuryRiskFrom = (injury: UnknownRecord | undefined, status: string): number => {
  const supplied = asNumber(firstValue(injury, ['injury_probability', 'injury_risk', 'probability', 'risk']));
  if (supplied !== undefined) return clamp(supplied <= 1 ? supplied * 100 : supplied, 0, 100);
  const normalized = status.toLowerCase();
  if (/\bout\b|ir|pup/.test(normalized)) return FALLBACK.outInjuryRisk;
  if (/doubtful/.test(normalized)) return FALLBACK.doubtfulInjuryRisk;
  if (/questionable|limited/.test(normalized)) return FALLBACK.questionableInjuryRisk;
  return FALLBACK.healthyInjuryRisk;
};

const projectionFrom = (projection: UnknownRecord | undefined): number | undefined => {
  const direct = asNumber(firstValue(projection, PROJECTION_FIELDS));
  if (direct !== undefined) return direct;
  const stats = projection && isRecord(projection.stats) ? projection.stats : undefined;
  return asNumber(firstValue(stats, PROJECTION_FIELDS));
};

const mergeRows = (payload: FantasyProsPayload): Map<string, PlayerAccumulator> => {
  const merged = new Map<string, PlayerAccumulator>();
  const sections: Array<[SourceKind, unknown]> = [
    ['rankings', payload.rankings ?? payload],
    ['projections', payload.projections ?? payload],
    ['injuries', payload.injuries ?? payload],
  ];

  for (const [kind, section] of sections) {
    for (const row of collectRows(section, kind)) {
      const name = rowName(row);
      if (!name) continue;
      const key = normalizePlayerName(name);
      const current = merged.get(key) ?? { name };
      if (kind === 'rankings') current.ranking = row;
      if (kind === 'projections') current.projection = row;
      if (kind === 'injuries') current.injury = row;
      merged.set(key, current);
    }
  }
  return merged;
};

/**
 * Converts rankings, projections and injuries to the app's complete Player model.
 * `fallbackPlayers` may enrich matched live records, but never creates a player
 * that did not occur in the provider payload.
 */
export const normalizeFantasyProsPlayers = (
  payload: FantasyProsPayload,
  fallbackPlayers: readonly Player[] = [],
): Player[] => {
  const fallbacks = new Map(fallbackPlayers.map((player) => [normalizePlayerName(player.name), player]));
  const players: Player[] = [];

  for (const [key, source] of mergeRows(payload)) {
    const fallback = fallbacks.get(key);
    const position = positionFrom(source.ranking, source.projection, source.injury) ?? fallback?.position;
    // Non-fantasy positions cannot be represented safely by the optimizer.
    if (!position) continue;

    const team = asString(firstValue(source.projection, TEAM_FIELDS))
      ?? asString(firstValue(source.ranking, TEAM_FIELDS))
      ?? asString(firstValue(source.injury, TEAM_FIELDS))
      ?? fallback?.team
      ?? 'FA';
    const projection = projectionFrom(source.projection) ?? fallback?.projectedPoints ?? FALLBACK.projectedPoints;
    const adp = asNumber(firstValue(source.ranking, ADP_FIELDS))
      ?? asNumber(firstValue(source.projection, ADP_FIELDS))
      ?? fallback?.adp
      ?? FALLBACK.unknownAdp;
    const tier = asNumber(firstValue(source.ranking, ['tier', 'rank_tier']))
      ?? fallback?.tier
      // One tier per typical 12-team draft round is a neutral fallback when no provider tier exists.
      ?? Math.max(1, Math.ceil(adp / FALLBACK.playersPerTier));
    const availability = statusText(source.injury) === 'Healthy' && fallback ? fallback.availability : statusText(source.injury);
    const injuryRisk = source.injury ? injuryRiskFrom(source.injury, availability) : fallback?.injuryRisk ?? FALLBACK.healthyInjuryRisk;
    const floor = asNumber(firstValue(source.projection, ['floor', 'projected_floor', 'low']))
      ?? fallback?.floor
      // Symmetric ranges around a projection express uncertainty without pretending to be a provider percentile.
      ?? projection * FALLBACK.floorRatio;
    const ceiling = asNumber(firstValue(source.projection, ['ceiling', 'projected_ceiling', 'high']))
      ?? fallback?.ceiling
      ?? projection * FALLBACK.ceilingRatio;
    const rankSignal = clamp(adp, 1, FALLBACK.unknownAdp);
    const gameAvailability = clamp(100 - injuryRisk, 0, 100);

    players.push({
      id: asString(firstValue(source.ranking, ['player_id', 'id']))
        ?? asString(firstValue(source.projection, ['player_id', 'id']))
        ?? fallback?.id
        ?? slug(`${source.name}-${team}`),
      name: source.name,
      team: team.toUpperCase(),
      position,
      bye: asNumber(firstValue(source.projection, ['bye', 'bye_week']))
        ?? asNumber(firstValue(source.ranking, ['bye', 'bye_week']))
        ?? fallback?.bye
        ?? FALLBACK.byeWeek,
      projectedPoints: projection,
      floor: Math.min(floor, projection),
      ceiling: Math.max(ceiling, projection),
      adp,
      injuryRisk,
      availability,
      tier,
      aliases: fallback?.aliases,
      context: fallback?.context ?? {
        // ADP is used only as a weak proxy for role/opportunity when richer usage feeds are absent.
        offenseQuality: FALLBACK.offenseQuality,
        opportunity: clamp(FALLBACK.opportunityBase - rankSignal * FALLBACK.opportunityRankPenalty, FALLBACK.minimumOpportunity, 100),
        roleSecurity: clamp(FALLBACK.roleSecurityBase - injuryRisk * FALLBACK.roleInjuryPenalty, FALLBACK.minimumRoleSecurity, 100),
        gameAvailability,
        coachUsage: clamp(FALLBACK.coachUsageBase - rankSignal * FALLBACK.coachUsageRankPenalty, FALLBACK.minimumCoachUsage, 100),
        depthChartSecurity: clamp(FALLBACK.depthChartBase - rankSignal * FALLBACK.depthChartRankPenalty, FALLBACK.minimumDepthChartSecurity, 100),
        lineOrProtection: FALLBACK.lineOrProtection,
        schedule: FALLBACK.schedule,
        teamChangeImpact: FALLBACK.teamChangeImpact,
        uncertainty: clamp(FALLBACK.uncertaintyBase + injuryRisk * FALLBACK.uncertaintyInjuryGrowth, 0, FALLBACK.maximumUncertainty),
      },
    });
  }

  return players.sort((a, b) => a.adp - b.adp || b.projectedPoints - a.projectedPoints);
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as UnknownRecord;
    return asString(body.message) ?? asString(body.error) ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

export const fetchFantasyProsStatus = async (signal?: AbortSignal): Promise<FantasyProsStatus> => {
  let response: Response;
  try {
    response = await fetch('/api/fantasypros/status', { signal });
  } catch (error) {
    throw new FantasyProsClientError(`FantasyPros status request failed: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (!response.ok) throw new FantasyProsClientError(await readErrorMessage(response), response.status);
  const body = await response.json() as UnknownRecord;
  const configured = body.configured === true;
  // "live" means the proxy has confirmed usable provider data, not merely that an API key exists.
  const live = configured && body.live === true;
  return {
    configured,
    live,
    provider: 'fantasypros',
    message: asString(body.message),
  };
};

export const fetchFantasyProsData = async (
  season: number,
  fallbackPlayers: readonly Player[] = [],
  signal?: AbortSignal,
): Promise<FantasyProsDataResult> => {
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new FantasyProsClientError(`Invalid fantasy season: ${season}`);
  }
  let response: Response;
  try {
    response = await fetch(`/api/fantasypros/data?season=${encodeURIComponent(season)}`, { signal });
  } catch (error) {
    throw new FantasyProsClientError(`FantasyPros data request failed: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (!response.ok) throw new FantasyProsClientError(await readErrorMessage(response), response.status);
  const body = await response.json() as FantasyProsPayload;
  const players = normalizeFantasyProsPlayers(body, fallbackPlayers);
  if (players.length === 0) throw new FantasyProsClientError('FantasyPros returned no supported fantasy players.');
  return {
    players,
    season,
    status: {
      configured: true,
      live: true,
      provider: 'fantasypros',
      message: 'Live FantasyPros rankings, projections, and injuries loaded.',
    },
  };
};
