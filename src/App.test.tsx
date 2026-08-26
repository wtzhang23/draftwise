// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing local fixture', { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('player selection menu', () => {
  it('closes by clicking outside, pressing Escape, or using its close button', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Player selected' });

    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'Close player selection' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects the highlighted fuzzy match with Enter', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Player selected' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Christan McCafrey' } });

    const firstOption = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    expect(firstOption.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getAllByText('Christian McCaffrey').length).toBeGreaterThan(0);
  });
});

describe('local pick timer', () => {
  it('counts down, pauses, resumes, and resets when the pick advances', () => {
    vi.useFakeTimers();
    render(<App />);
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toBe('02:00');

    act(() => vi.advanceTimersByTime(1000));
    expect(timer.textContent).toBe('01:59');

    fireEvent.click(screen.getByRole('button', { name: 'Pause pick timer' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(timer.textContent).toBe('01:59');

    fireEvent.click(screen.getByRole('button', { name: 'Resume pick timer' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(timer.textContent).toBe('01:58');

    fireEvent.click(screen.getByRole('button', { name: /Draft .* for my team/ }));
    expect(timer.textContent).toBe('02:00');
  });
});

describe('recorded pick corrections', () => {
  it('lets the user override and restore a provider position', () => {
    render(<App />);
    const positionSelect = screen.getByRole('combobox', { name: 'Position for Ja’Marr Chase' });

    fireEvent.change(positionSelect, { target: { value: 'RB' } });
    expect(screen.getByText(/RB \(override\)/)).not.toBeNull();

    fireEvent.change(positionSelect, { target: { value: '' } });
    expect(screen.queryByText(/RB \(override\)/)).toBeNull();
    expect((positionSelect as HTMLSelectElement).value).toBe('');
  });
});
