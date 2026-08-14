// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { buildSettingsExport } from '@/utils/settingsExport';
import { SettingsScreen } from './SettingsScreen';

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

afterEach(() => {
  cleanup();
  drainAlerts();
  localStorage.clear();
  _resetStoredCache();
  document.body.style.overflow = '';
});

describe('SettingsScreen exports', () => {
  it('keeps a single-character export scoped and excludes unrelated global notes', () => {
    localStorage.setItem('gc.activeCharId', JSON.stringify('c9'));
    localStorage.setItem('gc.c9.wounds', JSON.stringify(7));
    localStorage.setItem('gc.c2.wounds', JSON.stringify(3));
    localStorage.setItem('gc.notes', JSON.stringify([{ title: 'Campaign secret' }]));
    localStorage.setItem('gc.notes.filter', JSON.stringify('House'));

    const parsed = JSON.parse(buildSettingsExport(
      'character',
      'c9',
      'Marta Keller',
      { c9: { id: 'c9', name: 'Marta Keller' }, c2: { id: 'c2' } },
    )) as Record<string, unknown>;

    expect(parsed['gc.c9.wounds']).toBe(7);
    expect(parsed['gc.c2.wounds']).toBeUndefined();
    expect(parsed['gc.notes']).toBeUndefined();
    expect(parsed['gc.notes.filter']).toBeUndefined();
    expect(parsed['gc.customChars']).toEqual({ c9: { id: 'c9', name: 'Marta Keller' } });
  });
});

describe('SettingsScreen content-pack paste', () => {
  it('keeps the sheet open and preserves invalid pasted JSON for correction', () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Paste JSON' }));
    const input = screen.getByRole('textbox', { name: 'Content pack JSON' });
    fireEvent.change(input, { target: { value: '{ invalid JSON' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(screen.getByRole('dialog', { name: 'Paste content pack JSON' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Content pack JSON' }) as HTMLTextAreaElement).value)
      .toBe('{ invalid JSON');
    expect(getCurrentAlert()?.title).toBe('Invalid JSON');
  });
});

describe('SettingsScreen XP rule', () => {
  it('announces which rule mode is selected', () => {
    render(
      <ContentContext.Provider value={new ContentRegistry([])}>
        <SettingsScreen />
      </ContentContext.Provider>,
    );

    const strict = screen.getByRole('button', { name: 'Strict' });
    const flexible = screen.getByRole('button', { name: 'Flexible' });
    expect(strict.getAttribute('aria-pressed')).toBe('true');
    expect(flexible.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(flexible);

    expect(strict.getAttribute('aria-pressed')).toBe('false');
    expect(flexible.getAttribute('aria-pressed')).toBe('true');
  });
});
