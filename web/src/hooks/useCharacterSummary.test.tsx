// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import type { XpState } from './useXp';
import { characterKey } from './useCharacter';
import { useCharacterSummary } from './useCharacterSummary';
import { _resetStoredCache, useStoredState } from './useStoredState';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';

const registry = new ContentRegistry([
  rulesPack,
  racesPack,
  charactersPack,
] as unknown as ContentPack[]);
const template = registry.getCharacterTemplate('c1')!;

function SummaryHarness() {
  const summary = useCharacterSummary(template);
  return (
    <>
      <output data-testid="name">{summary.character.name}</output>
      <output data-testid="career">
        {summary.careerName} · {summary.careerLevel} · {summary.status}
      </output>
      <output data-testid="wounds">{summary.wounds}/{summary.maxWounds}</output>
      <output data-testid="xp">{summary.xpCurrent}</output>
    </>
  );
}

function AwardXpButton() {
  const [, setXp] = useStoredState<XpState>(characterKey('c1', 'xp'), {
    current: template.xpCurrent,
    spent: template.xpSpent,
    log: [],
  });

  return (
    <button
      type="button"
      onClick={() => setXp(previous => ({ ...previous, current: previous.current + 25 }))}
    >
      Award XP
    </button>
  );
}

function renderSummary() {
  return render(
    <ContentContext.Provider value={registry}>
      <SummaryHarness />
      <AwardXpButton />
    </ContentContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  _resetStoredCache();
});

describe('useCharacterSummary', () => {
  it('hydrates identity, career, wounds, and XP overlays for a roster card', () => {
    localStorage.setItem(characterKey('c1', 'identity'), JSON.stringify({ name: 'Erika Braun' }));
    localStorage.setItem(characterKey('c1', 'career.level'), JSON.stringify(3));
    localStorage.setItem(characterKey('c1', 'wounds'), JSON.stringify(7));
    localStorage.setItem(characterKey('c1', 'xp'), JSON.stringify({
      current: 125,
      spent: 1000,
      log: [],
    }));
    _resetStoredCache();

    renderSummary();

    expect(screen.getByTestId('name').textContent).toBe('Erika Braun');
    expect(screen.getByTestId('career').textContent)
      .toBe('Mounted Sergeant · 3 · Silver 4');
    expect(screen.getByTestId('wounds').textContent).toMatch(/^7\/\d+$/);
    expect(screen.getByTestId('xp').textContent).toBe('125');
  });

  it('updates immediately when another hook writes the same character XP key', () => {
    renderSummary();
    expect(screen.getByTestId('xp').textContent).toBe(String(template.xpCurrent));

    fireEvent.click(screen.getByRole('button', { name: 'Award XP' }));

    expect(screen.getByTestId('xp').textContent).toBe(String(template.xpCurrent + 25));
  });
});
