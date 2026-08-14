// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { characterKey } from '@/hooks/useCharacter';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { RosterScreen } from './RosterScreen';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';

const registry = new ContentRegistry([
  rulesPack,
  racesPack,
  charactersPack,
] as unknown as ContentPack[]);

afterEach(() => {
  cleanup();
  localStorage.clear();
  _resetStoredCache();
});

describe('RosterScreen character copy', () => {
  it('shows live identity, career, wounds, and spendable XP instead of template values', () => {
    localStorage.setItem(characterKey('c1', 'identity'), JSON.stringify({ name: 'Erika Braun' }));
    localStorage.setItem(characterKey('c1', 'career.level'), JSON.stringify(3));
    localStorage.setItem(characterKey('c1', 'wounds'), JSON.stringify(7));
    localStorage.setItem(characterKey('c1', 'xp'), JSON.stringify({
      current: 125,
      spent: 1000,
      log: [],
    }));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <RosterScreen onNav={() => undefined} />
      </ContentContext.Provider>,
    );

    const card = screen.getByRole('button', { name: 'Switch to Erika Braun' });
    expect(card.textContent).toContain('Human · Mounted Sergeant · rank 3 · Silver 4');
    expect(card.textContent).toMatch(/WOUNDS7\/\d+/);
    expect(card.textContent).toContain('SPENDABLE XP125');
    expect(screen.getByText('guided race, characteristics, and career setup')).toBeTruthy();
  });
});
