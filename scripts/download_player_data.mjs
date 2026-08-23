import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CURRENT_SEASON = Number(process.env.NFL_SEASON ?? new Date().getFullYear());
const PRIOR_SEASON = CURRENT_SEASON - 1;
const OUTPUT_PATH = resolve('public/data/player-pool.json');

const URLS = {
  roster: `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON}.csv`,
  stats: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${PRIOR_SEASON}.csv`,
  rankings: 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv',
};

// These are explicit model assumptions, not claims made by the downloaded sources.
// They are centralized so the derived baseline can be tuned through backtesting.
const BASELINE = {
  seasonGames: 17,
  minimumGamesForFullTrust: 12,
  priorSeasonWeightAtFullTrust: 0.82,
  rookiePriorSeasonWeight: 0,
  floorRatio: 0.73,
  extrapolatedFloorRatio: 0.62,
  ceilingRatio: 1.28,
  playersPerTier: 12,
  maximumPlayers: 320,
  defaultInjuryRisk: 8,
  extrapolatedInjuryRisk: 20,
  missedGameRiskPerGame: 2.35,
  maximumHistoricalInjuryRisk: 42,
  healthyAvailabilityBaseline: 98,
  minimumGameAvailability: 55,
  usageBaseline: 52,
  usageTargetShareWeight: 150,
  usageCarryWeight: 0.55,
  maximumUsage: 98,
  minimumUsage: 38,
  rookieUncertainty: 35,
  veteranUncertainty: 12,
  rankUncertaintyGrowth: 0.035,
  neutralContextSignal: 70,
  teamChangePenalty: -2,
  projectionPriors: {
    QB: { elite: 365, replacement: 255 },
    RB: { elite: 300, replacement: 125 },
    WR: { elite: 310, replacement: 125 },
    TE: { elite: 245, replacement: 105 },
    K: { elite: 160, replacement: 115 },
    DST: { elite: 155, replacement: 105 },
  },
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows;
  return values.filter((valuesRow) => valuesRow.some(Boolean)).map((valuesRow) =>
    Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? ''])));
}

async function downloadCsv(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'DraftWise local data builder' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return parseCsv(await response.text());
}

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const slug = (value) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const normalizedName = (value) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z0-9]/g, '');

function rankProjection(position, rank) {
  const prior = BASELINE.projectionPriors[position];
  const rankDecay = clamp((rank - 1) / 180, 0, 1);
  return prior.elite - (prior.elite - prior.replacement) * Math.sqrt(rankDecay);
}

function fantasyPoints(stats) {
  // Full-PPR and four-point passing TD is the app's canonical provider baseline.
  return number(stats.passing_yards) * 0.04 + number(stats.passing_tds) * 4
    - number(stats.passing_interceptions) + number(stats.rushing_yards) * 0.1
    + number(stats.rushing_tds) * 6 + number(stats.receptions)
    + number(stats.receiving_yards) * 0.1 + number(stats.receiving_tds) * 6
    + number(stats.fantasy_points) - (
      number(stats.passing_yards) * 0.04 + number(stats.passing_tds) * 4
      - number(stats.passing_interceptions) + number(stats.rushing_yards) * 0.1
      + number(stats.rushing_tds) * 6 + number(stats.receiving_yards) * 0.1
      + number(stats.receiving_tds) * 6
    );
}

function buildPlayers(rosters, statsRows, rankingRows) {
  const currentRoster = new Map(rosters
    .filter((row) => ['ACT', 'RES', 'DEV'].includes(row.status))
    .map((row) => [row.gsis_id, row]));
  const statsById = new Map(statsRows.map((row) => [row.player_id, row]));
  const rankings = rankingRows.filter((row) => row.page_type === 'redraft-overall' && row.ecr_type === 'ro')
    .sort((a, b) => number(a.ecr, 999) - number(b.ecr, 999));

  const seen = new Set();
  return rankings.flatMap((ranking) => {
    const position = ranking.pos?.replace(/[0-9]/g, '');
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(position)) return [];
    const key = `${normalizedName(ranking.player)}-${position}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const roster = position === 'DST' ? undefined : [...currentRoster.values()].find((row) =>
      normalizedName(row.full_name) === normalizedName(ranking.player));
    const stats = roster ? statsById.get(roster.gsis_id) : undefined;
    const rank = number(ranking.ecr, 300);
    const marketProjection = rankProjection(position, rank);
    const games = stats ? number(stats.games) : 0;
    const fullSeasonPrior = stats && games > 0 ? fantasyPoints(stats) / games * BASELINE.seasonGames : marketProjection;
    // Small samples regress strongly toward current consensus; established seasons retain more history.
    const historyWeight = stats
      ? BASELINE.priorSeasonWeightAtFullTrust * clamp(games / BASELINE.minimumGamesForFullTrust, 0, 1)
      : BASELINE.rookiePriorSeasonWeight;
    const projectedPoints = fullSeasonPrior * historyWeight + marketProjection * (1 - historyWeight);
    const missedGames = BASELINE.seasonGames - games;
    // With no prior-season row, absence of evidence is not evidence of health.
    // A higher conservative prior keeps extrapolated rookies/backups below equally ranked proven players.
    const injuryRisk = stats
      ? clamp(BASELINE.defaultInjuryRisk + missedGames * BASELINE.missedGameRiskPerGame, BASELINE.defaultInjuryRisk, BASELINE.maximumHistoricalInjuryRisk)
      : BASELINE.extrapolatedInjuryRisk;
    const team = ranking.team || roster?.team || 'FA';
    const changedTeams = Boolean(roster && stats?.recent_team && roster.team !== stats.recent_team);
    const opportunity = stats
      ? clamp(BASELINE.usageBaseline + number(stats.target_share) * BASELINE.usageTargetShareWeight
        + number(stats.carries) / Math.max(1, games) * BASELINE.usageCarryWeight, BASELINE.minimumUsage, BASELINE.maximumUsage)
      : clamp(96 - rank * 0.14, BASELINE.minimumUsage, 92);
    const uncertainty = clamp((stats ? BASELINE.veteranUncertainty : BASELINE.rookieUncertainty)
      + rank * BASELINE.rankUncertaintyGrowth, 6, 45);

    return [{
      id: position === 'DST' ? `dst-${team.toLowerCase()}` : roster?.gsis_id || `rank-${ranking.id}`,
      name: ranking.player,
      team,
      position,
      bye: number(ranking.bye),
      projectedPoints: Math.round(projectedPoints * 10) / 10,
      floor: Math.round(projectedPoints * (stats ? BASELINE.floorRatio : BASELINE.extrapolatedFloorRatio) * 10) / 10,
      ceiling: Math.round(projectedPoints * BASELINE.ceilingRatio * 10) / 10,
      adp: Math.round(rank * 10) / 10,
      injuryRisk: Math.round(injuryRisk),
      availability: injuryRisk >= 25 ? 'Historical availability risk' : 'No current injury feed',
      tier: Math.max(1, Math.ceil(rank / BASELINE.playersPerTier)),
      aliases: roster?.football_name && roster.football_name !== ranking.player ? [roster.football_name] : undefined,
      externalIds: roster ? { sleeper: roster.sleeper_id || undefined, gsis: roster.gsis_id } : undefined,
      context: {
        offenseQuality: 0,
        opportunity: Math.round(opportunity),
        roleSecurity: Math.round(clamp(100 - uncertainty - injuryRisk * 0.25, 40, 95)),
        gameAvailability: Math.round(clamp(BASELINE.healthyAvailabilityBaseline - injuryRisk, BASELINE.minimumGameAvailability, 97)),
        coachUsage: Math.round(opportunity),
        depthChartSecurity: Math.round(clamp(BASELINE.neutralContextSignal + (100 - rank) * 0.18, 42, 96)),
        lineOrProtection: 0,
        schedule: 0,
        teamChangeImpact: changedTeams ? BASELINE.teamChangePenalty : 0,
        uncertainty: Math.round(uncertainty),
      },
    }];
  }).slice(0, BASELINE.maximumPlayers);
}

const [rosters, stats, rankings] = await Promise.all(Object.values(URLS).map(downloadCsv));
const players = buildPlayers(rosters, stats, rankings);
if (players.length < 100) throw new Error(`Only ${players.length} players were generated; refusing to overwrite the existing dataset.`);

const output = {
  metadata: {
    kind: 'downloaded-derived',
    generatedAt: new Date().toISOString(),
    currentSeason: CURRENT_SEASON,
    priorSeason: PRIOR_SEASON,
    playerCount: players.length,
    description: `${CURRENT_SEASON} DynastyProcess redraft ECR blended with ${PRIOR_SEASON} nflverse results and ${CURRENT_SEASON} rosters`,
    sources: URLS,
  },
  players,
};
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${players.length} players to ${OUTPUT_PATH}`);
