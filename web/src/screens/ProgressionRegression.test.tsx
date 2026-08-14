// @vitest-environment jsdom

import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { useCharacterSummary } from '@/hooks/useCharacterSummary';
import { useDerived } from '@/hooks/useDerived';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { CharacteristicsScreen } from './CharacteristicsScreen';
import { FaithScreen } from './FaithScreen';
import { MagicScreen } from './MagicScreen';
import { SkillsScreen } from './SkillsScreen';
import { TalentsScreen } from './TalentsScreen';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import faithPack from '../../public/content/core-faith.json';
import magicPack from '../../public/content/core-magic.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import skillsPack from '../../public/content/core-skills.json';
import talentsPack from '../../public/content/core-talents.json';

const registry = new ContentRegistry([
  rulesPack,
  racesPack,
  careersPack,
  skillsPack,
  talentsPack,
  magicPack,
  faithPack,
  charactersPack,
] as unknown as ContentPack[]);

function renderScreen(node: React.ReactNode) {
  render(<ContentContext.Provider value={registry}>{node}</ContentContext.Provider>);
}

function selectCharacter(id: string): void {
  localStorage.setItem('gc.activeCharId', JSON.stringify(id));
  _resetStoredCache();
}

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

function DerivedWoundsProbe() {
  const { maxWounds } = useDerived();
  return <output data-testid="max-wounds">{maxWounds}</output>;
}

function RosterWoundsProbe() {
  const template = registry.getCharacterTemplate('c2')!;
  const { maxWounds } = useCharacterSummary(template);
  return <output data-testid="roster-max-wounds">{maxWounds}</output>;
}

afterEach(() => {
  cleanup();
  drainAlerts();
  localStorage.clear();
  _resetStoredCache();
  vi.restoreAllMocks();
});

describe('progression regressions', () => {
  it('sums every skill point when a +5 purchase crosses a cost band', () => {
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ranged (Bow)' }));

    const xp = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    const advances = JSON.parse(localStorage.getItem('gc.c1.skills.adv') ?? '{}');
    expect(xp.current).toBe(270);
    expect(xp.log[0]).toMatchObject({
      reason: 'Ranged (Bow) +5 → +10',
      amount: -70,
      kind: 'skill',
    });
    expect(advances['Ranged (Bow)']).toBe(10);
  });

  it('sums every characteristic point when a +5 purchase crosses a cost band', () => {
    renderScreen(<CharacteristicsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ballistic Skill' }));

    const xp = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    const advances = JSON.parse(localStorage.getItem('gc.c1.chars.adv') ?? '{}');
    expect(xp.current).toBe(195);
    expect(xp.log[0]).toMatchObject({
      reason: 'Ballistic Skill +5 → +10',
      amount: -145,
      kind: 'char',
    });
    expect(advances.bs).toBe(10);
  });

  it('uses purchased Channelling and Language advances in Magic targets', () => {
    selectCharacter('c2');
    localStorage.setItem('gc.c2.skills.adv', JSON.stringify({
      'Channelling (Fire)': 25,
      'Language (Magick)': 25,
    }));
    vi.spyOn(Math, 'random').mockReturnValue(0.09); // d100 → 10

    renderScreen(<MagicScreen />);

    expect(screen.getByText('Language (Magick) +25')).toBeTruthy();
    expect(screen.getByText(/Test Channelling \(target 83\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cast Dart' }));
    expect(getCurrentAlert()?.message).toContain('Roll  10  vs  85');
  });

  it('labels a passed casting test that misses the CN as a fizzle', () => {
    selectCharacter('c2');
    vi.spyOn(Math, 'random').mockReturnValue(0.78); // d100 → 79: succeeds, but only +1 SL

    renderScreen(<MagicScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Cast Firewall' }));

    expect(getCurrentAlert()?.title).toBe('Firewall — FIZZLE');
    expect(getCurrentAlert()?.message).toContain('Not enough SL — spell fizzles');
  });

  it('uses purchased Pray advances in the Faith target', () => {
    selectCharacter('c4');
    localStorage.setItem('gc.c4.skills.adv', JSON.stringify({ Pray: 20 }));
    vi.spyOn(Math, 'random').mockReturnValue(0.09); // d100 → 10

    renderScreen(<FaithScreen />);

    expect(screen.getByText('Pray +20')).toBeTruthy();
    expect(screen.getByText(/target 65/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pray Calm Soul' }));
    expect(getCurrentAlert()?.message).toContain('Roll  10  vs  65');
  });

  it('includes a newly purchased Hardy rank in derived Max Wounds', () => {
    selectCharacter('c2');
    renderScreen(
      <>
        <TalentsScreen />
        <DerivedWoundsProbe />
        <RosterWoundsProbe />
      </>,
    );
    const before = Number(screen.getByTestId('max-wounds').textContent);
    const rosterBefore = Number(screen.getByTestId('roster-max-wounds').textContent);

    fireEvent.click(screen.getByRole('button', {
      name: /New talent \d+ career options, \d+ total available/,
    }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search talents' }), {
      target: { value: 'Hardy' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Hardy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));

    expect(Number(screen.getByTestId('max-wounds').textContent)).toBe(before + 3);
    expect(Number(screen.getByTestId('roster-max-wounds').textContent)).toBe(rosterBefore + 3);
  });
});
