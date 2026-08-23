import type { AnalyticsProvider } from '../types';

export const providers: AnalyticsProvider[] = [
  {
    id: 'dynastyprocess',
    name: 'DynastyProcess rankings',
    kind: 'adp',
    status: 'available',
    description: 'Downloadable weekly redraft consensus/ECR used as the current draft-market signal.',
    url: 'https://github.com/dynastyprocess/data',
  },
  {
    id: 'fantasypros',
    name: 'FantasyPros Consensus',
    kind: 'projections',
    status: 'key-required',
    description: '2026 consensus projections, ECR, ADP and status data; prototype access requires a key and attribution.',
    url: 'https://www.fantasypros.com/api-data/',
  },
  {
    id: 'sleeper',
    name: 'Sleeper API',
    kind: 'metadata',
    status: 'available',
    description: 'League settings, rosters, draft order, picks and NFL player identifiers.',
    url: 'https://docs.sleeper.com/',
  },
  {
    id: 'nflverse',
    name: 'nflverse',
    kind: 'projections',
    status: 'available',
    description: 'CC BY 4.0 current rosters/IDs and prior-season results used by the local derived baseline.',
    url: 'https://nflreadr.nflverse.com/',
  },
  {
    id: 'sportsdataio',
    name: 'SportsDataIO',
    kind: 'injury',
    status: 'paid',
    description: 'Licensed injuries, depth charts, news, ADP and projections for a production integration.',
    url: 'https://sportsdata.io/developers/api-documentation/nfl',
  },
  {
    id: 'sportradar',
    name: 'Sportradar NFL',
    kind: 'injury',
    status: 'paid',
    description: 'Current weekly injury/practice status and estimated return dates through a licensed API.',
    url: 'https://developer.sportradar.com/football/docs/nfl-ig-overview',
  },
];
