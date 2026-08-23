import type { Player, PlayerDataMetadata } from '../types';

export interface DownloadedPlayerData {
  metadata: PlayerDataMetadata;
  players: Player[];
}

export async function loadDownloadedPlayerData(signal?: AbortSignal): Promise<DownloadedPlayerData> {
  const response = await fetch('/data/player-pool.json', { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Local player data could not be loaded (${response.status}).`);
  const result = await response.json() as DownloadedPlayerData;
  if (result.metadata?.kind !== 'downloaded-derived' || !Array.isArray(result.players) || result.players.length < 100) {
    throw new Error('Local player data is missing or invalid. Run npm run data:download.');
  }
  return result;
}
