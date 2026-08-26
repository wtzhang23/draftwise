export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

export interface Player {
  id: string;
  name: string;
  team: string;
  position: Position;
  bye: number;
  projectedPoints: number;
  floor: number;
  ceiling: number;
  adp: number;
  injuryRisk: number;
  availability: string;
  tier: number;
  aliases?: string[];
  externalIds?: { sleeper?: string; gsis?: string };
  context: {
    offenseQuality: number;
    opportunity: number;
    roleSecurity: number;
    gameAvailability: number;
    coachUsage: number;
    depthChartSecurity: number;
    lineOrProtection: number;
    schedule: number;
    teamChangeImpact: number;
    uncertainty: number;
  };
}

export interface ScoringSettings {
  passingYards: number;
  passingTd: number;
  interception: number;
  rushingYards: number;
  rushingTd: number;
  reception: number;
  receivingYards: number;
  receivingTd: number;
}

export interface RosterSettings {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  K: number;
  DST: number;
  BENCH: number;
}

export type DraftFormat = 'snake' | 'linear' | 'third-round-reversal' | 'auction';

export interface LeagueSettings {
  name: string;
  teams: number;
  managerNames: string[];
  draftSlot: number;
  format: DraftFormat;
  scoringLabel: string;
  scoring: ScoringSettings;
  roster: RosterSettings;
  auctionBudget: number;
}

export interface DraftPick {
  id: string;
  playerId: string;
  teamIndex: number;
  overall: number;
  amount?: number;
  displayName?: string;
  position?: Position;
  team?: string;
}

export interface DraftState {
  settings: LeagueSettings;
  picks: DraftPick[];
  userTeamIndex: number;
  riskTolerance: number;
  scarcityWeight: number;
  activePosition: Position | 'ALL';
  connections: {
    sleeperDraftId: string;
    autoSyncSleeper: boolean;
    lastSleeperSync?: string;
  };
}

export interface PlayerDataMetadata {
  kind: 'downloaded-derived';
  generatedAt: string;
  currentSeason: number;
  priorSeason: number;
  playerCount: number;
  description: string;
  sources: Record<string, string>;
}

export interface Recommendation {
  player: Player;
  score: number;
  value: number;
  scarcity: number;
  availabilityRisk: number;
  injuryPenalty: number;
  substitutionRisk: number;
  rosterFit: number;
  contextAdjustment: number;
  marketEdge: number;
  confidence: number;
  reasons: string[];
}

export interface AnalyticsProvider {
  id: string;
  name: string;
  kind: 'projections' | 'injury' | 'adp' | 'metadata';
  status: 'demo' | 'available' | 'key-required' | 'paid';
  description: string;
  url: string;
}
