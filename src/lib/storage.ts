import type { DraftState } from '../types';

const KEY = 'draftwise-state-v1';

export function loadState(): DraftState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as DraftState : null;
  } catch {
    return null;
  }
}

export function saveState(state: DraftState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function exportState(state: DraftState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${state.settings.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'draft'}-draftwise.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importState(file: File): Promise<DraftState> {
  const parsed = JSON.parse(await file.text()) as DraftState;
  if (!parsed.settings || !Array.isArray(parsed.picks) || typeof parsed.userTeamIndex !== 'number') {
    throw new Error('That file is not a valid DraftWise draft export.');
  }
  return parsed;
}
