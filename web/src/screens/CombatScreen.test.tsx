// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { CombatScreen } from './CombatScreen';
import charactersPack from '../../public/content/core-characters.json';
import rulesPack from '../../public/content/core-rules.json';

const registry = new ContentRegistry([
  rulesPack,
  charactersPack,
] as unknown as ContentPack[]);

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

describe('CombatScreen weapon distance', () => {
  it('uses and persists Range for a ranged weapon even when legacy data also has Reach', () => {
    localStorage.setItem('gc.c1.weapons', JSON.stringify([{
      name: 'QA Longbow',
      group: 'Bow',
      enc: 1,
      reach: 'Average',
      range: '120',
      dmg: '4',
      qual: [],
    }]));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <CombatScreen />
      </ContentContext.Provider>,
    );

    const weapon = screen.getByRole('button', { name: 'QA Longbow' });
    const row = weapon.closest('.tbl-row');
    expect(row?.textContent).toContain('120');
    expect(row?.textContent).not.toContain('Average');

    fireEvent.click(weapon);
    const distance = screen.getByRole('textbox', { name: 'Range' }) as HTMLInputElement;
    expect(distance.value).toBe('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const stored = JSON.parse(localStorage.getItem('gc.c1.weapons') ?? '[]') as Array<{
      reach?: string;
      range?: string;
    }>;
    expect(stored[0]).toMatchObject({ range: '120' });
    expect(stored[0].reach).toBeUndefined();
  });
});
