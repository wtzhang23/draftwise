import type { Player } from '../types';

// Search weights prioritize exact prefixes, then substrings, then edit-distance recovery.
// A low minimum keeps two-character spelling mistakes useful without surfacing the whole player pool.
const SEARCH = {
  prefixScore: 100,
  substringScore: 85,
  fuzzyScore: 70,
  editPenalty: 13,
  lengthPenalty: 0.15,
  minimumScore: 20,
} as const;

export function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

export function fuzzyPlayers(query: string, source: Player[], limit = 7): Player[] {
  const needle = normalize(query.trim());
  if (!needle) return source.slice(0, limit);
  return source
    .map((player) => {
      // Individual name tokens make last-name-only typo matching useful (for example, "Makomes").
      const names = [
        player.name,
        ...player.name.split(/\s+/),
        ...(player.aliases ?? []),
        `${player.name}${player.team}`,
      ].map(normalize);
      const score = Math.max(...names.map((name) => {
        if (name.startsWith(needle)) return SEARCH.prefixScore - (name.length - needle.length) * 0.1;
        if (name.includes(needle)) return SEARCH.substringScore - name.indexOf(needle);
        const first = name.slice(0, Math.max(needle.length, Math.min(name.length, needle.length + 2)));
        const distance = levenshtein(needle, first);
        return SEARCH.fuzzyScore - distance * SEARCH.editPenalty - Math.abs(name.length - needle.length) * SEARCH.lengthPenalty;
      }));
      return { player, score };
    })
    .filter(({ score }) => score > SEARCH.minimumScore)
    .sort((a, b) => b.score - a.score || a.player.adp - b.player.adp)
    .slice(0, limit)
    .map(({ player }) => player);
}
