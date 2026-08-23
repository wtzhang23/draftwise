import { describe, expect, it } from 'vitest';
import { players } from '../data/players';
import { fuzzyPlayers, levenshtein, normalize } from './fuzzy';

describe('fuzzy player search', () => {
  it('normalizes punctuation and accents', () => {
    expect(normalize("Ja'Marr Chase")).toBe('jamarrchase');
    expect(normalize('Ja\u2019Marr Chase')).toBe('jamarrchase');
  });

  it('finds a player despite a spelling mistake', () => {
    expect(fuzzyPlayers('Jamar Chse', players)[0]?.name).toBe('Ja\u2019Marr Chase');
    expect(fuzzyPlayers('Makomes', players)[0]?.name).toBe('Patrick Mahomes');
  });

  it('calculates edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});
