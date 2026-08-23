import type { Player, Position } from '../types';

type Seed = [string, string, Position, number, number, number, number, number, number, number, string?];

const seeds: Seed[] = [
  ['Ja\u2019Marr Chase', 'CIN', 'WR', 290, 225, 342, 1.5, 8, 10, 1],
  ['Bijan Robinson', 'ATL', 'RB', 284, 218, 338, 2.4, 11, 5, 1],
  ['Jahmyr Gibbs', 'DET', 'RB', 276, 210, 330, 3.2, 10, 8, 1],
  ['Justin Jefferson', 'MIN', 'WR', 278, 215, 334, 4.1, 9, 6, 1],
  ['CeeDee Lamb', 'DAL', 'WR', 270, 205, 326, 5.3, 12, 10, 1],
  ['Puka Nacua', 'LAR', 'WR', 263, 197, 320, 7.8, 13, 8, 1],
  ['Saquon Barkley', 'PHI', 'RB', 264, 190, 326, 6.7, 17, 9, 1],
  ['Amon-Ra St. Brown', 'DET', 'WR', 257, 202, 303, 8.5, 7, 8, 1],
  ['Malik Nabers', 'NYG', 'WR', 250, 183, 312, 10.4, 12, 14, 2],
  ['Nico Collins', 'HOU', 'WR', 244, 179, 301, 12.7, 18, 6, 2],
  ['De\u2019Von Achane', 'MIA', 'RB', 246, 170, 315, 11.8, 23, 12, 2],
  ['Brock Bowers', 'LV', 'TE', 238, 187, 282, 13.5, 8, 8, 1],
  ['Brian Thomas Jr.', 'JAX', 'WR', 237, 172, 295, 15.2, 11, 8, 2],
  ['Josh Allen', 'BUF', 'QB', 372, 302, 431, 20.5, 12, 7, 1],
  ['Lamar Jackson', 'BAL', 'QB', 365, 288, 425, 22.0, 14, 6, 1],
  ['A.J. Brown', 'PHI', 'WR', 232, 166, 292, 18.9, 19, 9, 2],
  ['Jonathan Taylor', 'IND', 'RB', 237, 171, 294, 17.1, 18, 11, 2],
  ['Bucky Irving', 'TB', 'RB', 231, 170, 284, 19.8, 12, 9, 2],
  ['Drake London', 'ATL', 'WR', 229, 169, 281, 21.4, 8, 5, 2],
  ['Christian McCaffrey', 'SF', 'RB', 246, 156, 325, 16.0, 38, 14, 2, 'Questionable'],
  ['Trey McBride', 'ARI', 'TE', 222, 174, 267, 24.8, 9, 8, 1],
  ['Jaxon Smith-Njigba', 'SEA', 'WR', 220, 160, 276, 26.5, 10, 8, 3],
  ['Kyren Williams', 'LAR', 'RB', 225, 157, 290, 23.1, 25, 8, 3],
  ['Jayden Daniels', 'WAS', 'QB', 345, 272, 407, 30.2, 18, 12, 2],
  ['Jalen Hurts', 'PHI', 'QB', 338, 269, 396, 32.6, 16, 9, 2],
  ['George Kittle', 'SF', 'TE', 205, 150, 260, 35.4, 21, 14, 2],
  ['Tee Higgins', 'CIN', 'WR', 212, 151, 270, 31.8, 24, 10, 3],
  ['Josh Jacobs', 'GB', 'RB', 215, 158, 267, 28.7, 14, 5, 3],
  ['James Cook', 'BUF', 'RB', 211, 154, 263, 29.9, 12, 7, 3],
  ['Ladd McConkey', 'LAC', 'WR', 218, 161, 270, 27.6, 10, 12, 3],
  ['Garrett Wilson', 'NYJ', 'WR', 213, 154, 268, 33.3, 13, 9, 3],
  ['Davante Adams', 'LAR', 'WR', 205, 148, 259, 39.1, 16, 8, 4],
  ['Joe Burrow', 'CIN', 'QB', 331, 270, 386, 44.2, 19, 10, 3],
  ['Patrick Mahomes', 'KC', 'QB', 326, 266, 380, 48.6, 11, 10, 3],
  ['Sam LaPorta', 'DET', 'TE', 193, 143, 243, 46.1, 9, 8, 3],
  ['Derrick Henry', 'BAL', 'RB', 205, 147, 260, 37.5, 20, 6, 4],
  ['Alvin Kamara', 'NO', 'RB', 197, 143, 250, 43.8, 23, 11, 4],
  ['Marvin Harrison Jr.', 'ARI', 'WR', 202, 141, 261, 42.0, 9, 8, 4],
  ['Mike Evans', 'TB', 'WR', 197, 140, 251, 45.4, 18, 9, 4],
  ['DK Metcalf', 'PIT', 'WR', 194, 136, 250, 50.7, 14, 5, 4],
  ['Xavier Worthy', 'KC', 'WR', 192, 130, 252, 53.2, 11, 10, 4],
  ['David Montgomery', 'DET', 'RB', 188, 138, 231, 56.3, 16, 8, 5],
  ['Kenneth Walker III', 'SEA', 'RB', 191, 129, 246, 51.2, 29, 8, 5, 'Monitor'],
  ['Mark Andrews', 'BAL', 'TE', 181, 130, 230, 58.4, 17, 6, 4],
  ['Baker Mayfield', 'TB', 'QB', 310, 252, 360, 72.1, 9, 9, 4],
  ['Bo Nix', 'DEN', 'QB', 305, 243, 364, 76.3, 8, 12, 4],
  ['Jake Ferguson', 'DAL', 'TE', 169, 122, 215, 82.0, 10, 10, 5],
  ['Tucker Kraft', 'GB', 'TE', 161, 113, 210, 96.0, 8, 5, 6],
  ['Brandon Aubrey', 'DAL', 'K', 154, 128, 179, 112.0, 4, 10, 1],
  ['Denver Broncos', 'DEN', 'DST', 151, 116, 188, 118.0, 4, 12, 1],
  ['Philadelphia Eagles', 'PHI', 'DST', 147, 112, 184, 124.0, 5, 9, 1],
  ['Ka\u2019imi Fairbairn', 'HOU', 'K', 146, 119, 172, 132.0, 5, 6, 2],
];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const offenseQuality: Record<string, number> = {
  BUF: 9, BAL: 8, DET: 9, PHI: 8, CIN: 7, TB: 6, GB: 6, KC: 7, LAR: 6,
  WAS: 6, ATL: 3, MIN: 5, HOU: 4, MIA: 4, DAL: 3, SF: 5, DEN: 3,
  LAC: 3, IND: 1, SEA: 1, ARI: 1, PIT: 0, JAX: 0, LV: -2, NYJ: -3,
  NYG: -4, NO: -3,
};

const lineQuality: Record<string, number> = {
  PHI: 5, DET: 5, BAL: 4, BUF: 3, GB: 3, DEN: 3, KC: 2, TB: 2,
  ATL: 2, LAC: 1, MIN: 0, CIN: -1, LAR: -1, HOU: -2, SEA: -2, NYG: -4,
};

const teamChange: Record<string, number> = {
  'Davante Adams': 4, 'DK Metcalf': -1,
};

// Synthetic context generation is centralized so demo assumptions are visible and replaceable.
// These are not claims about real 2026 outcomes; provider adapters should supply live values.
const DEMO_CONTEXT = {
  minimumSignal: 45,
  maximumSignal: 96,
  minimumRoleSecurity: 48,
  minimumAvailability: 55,
  minimumCoachUsage: 42,
  maximumCoachUsage: 97,
  maximumDepthChartSecurity: 98,
  minimumUncertainty: 6,
  opportunityBaseline: 94,
  opportunityTierPenalty: 6,
  rbOpportunityBonus: 2,
  roleBaseline: 95,
  roleTierPenalty: 5,
  roleInjuryPenalty: 0.18,
  availabilityBaseline: 99,
  availabilityInjuryPenalty: 0.72,
  questionablePenalty: 10,
  monitorPenalty: 4,
  usageBaseline: 96,
  usageTierPenalty: 6,
  rbUsageAdjustment: -2,
  otherUsageAdjustment: 1,
  depthChartBaseline: 97,
  depthChartTierPenalty: 5,
  uncertaintyBaseline: 8,
  uncertaintyTierGrowth: 2,
  uncertaintyInjuryGrowth: 0.22,
  maximumUncertainty: 35,
  scheduleBandSize: 9,
  scheduleBandOffset: 4,
} as const;

export const players: Player[] = seeds.map((seed) => {
  const [name, team, position, projectedPoints, floor, ceiling, adp, injuryRisk, bye, tier, availability = 'Healthy'] = seed;
  return {
    id: slug(`${name}-${team}`), name, team, position, projectedPoints, floor, ceiling,
    adp, injuryRisk, bye, tier, availability,
    aliases: name.includes('\u2019') ? [name.replace(/\u2019/g, "'")] : undefined,
    context: {
      offenseQuality: offenseQuality[team] ?? 0,
      opportunity: Math.max(DEMO_CONTEXT.minimumSignal, Math.min(DEMO_CONTEXT.maximumSignal,
        DEMO_CONTEXT.opportunityBaseline - tier * DEMO_CONTEXT.opportunityTierPenalty
        + (position === 'RB' ? DEMO_CONTEXT.rbOpportunityBonus : 0))),
      roleSecurity: Math.max(DEMO_CONTEXT.minimumRoleSecurity, Math.min(DEMO_CONTEXT.maximumSignal,
        DEMO_CONTEXT.roleBaseline - tier * DEMO_CONTEXT.roleTierPenalty - injuryRisk * DEMO_CONTEXT.roleInjuryPenalty)),
      gameAvailability: Math.max(DEMO_CONTEXT.minimumAvailability, Math.min(DEMO_CONTEXT.availabilityBaseline,
        DEMO_CONTEXT.availabilityBaseline - injuryRisk * DEMO_CONTEXT.availabilityInjuryPenalty
        - (availability === 'Questionable' ? DEMO_CONTEXT.questionablePenalty : availability === 'Monitor' ? DEMO_CONTEXT.monitorPenalty : 0))),
      coachUsage: Math.max(DEMO_CONTEXT.minimumCoachUsage, Math.min(DEMO_CONTEXT.maximumCoachUsage,
        DEMO_CONTEXT.usageBaseline - tier * DEMO_CONTEXT.usageTierPenalty
        + (position === 'RB' ? DEMO_CONTEXT.rbUsageAdjustment : DEMO_CONTEXT.otherUsageAdjustment))),
      depthChartSecurity: Math.max(DEMO_CONTEXT.minimumSignal, Math.min(DEMO_CONTEXT.maximumDepthChartSecurity,
        DEMO_CONTEXT.depthChartBaseline - tier * DEMO_CONTEXT.depthChartTierPenalty)),
      lineOrProtection: lineQuality[team] ?? 0,
      schedule: ((name.length + bye) % DEMO_CONTEXT.scheduleBandSize) - DEMO_CONTEXT.scheduleBandOffset,
      teamChangeImpact: teamChange[name] ?? 0,
      uncertainty: Math.max(DEMO_CONTEXT.minimumUncertainty, Math.min(DEMO_CONTEXT.maximumUncertainty,
        DEMO_CONTEXT.uncertaintyBaseline + tier * DEMO_CONTEXT.uncertaintyTierGrowth
        + injuryRisk * DEMO_CONTEXT.uncertaintyInjuryGrowth)),
    },
  };
});

export const dataUpdatedAt = 'Prototype baseline \u00b7 2026 preseason model';
