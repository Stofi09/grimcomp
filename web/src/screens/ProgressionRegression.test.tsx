// @vitest-environment jsdom

import type * as React from 'react';
import { act } from 'react';
import { STORAGE_TRANSACTION_JOURNAL_KEY } from '@grimcomp/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { useCharacterSummary } from '@/hooks/useCharacterSummary';
import { useDerived } from '@/hooks/useDerived';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { talentIdentityKey } from '@/utils/talents';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { STORAGE_VERSION_KEY } from '@/storage/storageSchema';
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

async function settleStorage(): Promise<void> {
  await act(async () => { await waitForStorageIdle(); });
}

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  drainAlerts();
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('progression regressions', () => {
  it('commits XP and its skill advance through one journal transaction', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ranged (Bow)' }));
    await settleStorage();

    const journals = setItem.mock.calls
      .filter(([key]) => key === STORAGE_TRANSACTION_JOURNAL_KEY)
      .map(([, raw]) => JSON.parse(raw) as { operations: Array<{ key: string }> });
    expect(journals).toHaveLength(1);
    expect(journals[0]?.operations.map(operation => operation.key).sort()).toEqual([
      'gc.c1.skills.adv',
      'gc.c1.xp',
      STORAGE_VERSION_KEY,
    ]);
  });

  it('ignores a rapid duplicate skill purchase until the first one is durable', async () => {
    renderScreen(<SkillsScreen />);

    const increase = screen.getByRole('button', { name: 'Increase Ranged (Bow)' });
    fireEvent.click(increase);
    fireEvent.click(increase);
    await settleStorage();

    const xp = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    const advances = JSON.parse(localStorage.getItem('gc.c1.skills.adv') ?? '{}');
    expect(xp.current).toBe(270);
    expect(xp.log.filter((entry: { reason: string }) => entry.reason === 'Ranged (Bow) +5 → +10'))
      .toHaveLength(1);
    expect(advances['Ranged (Bow)']).toBe(10);
  });

  it('keeps rapid purchases of distinct skills independent', async () => {
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ranged (Bow)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Intimidate' }));
    await settleStorage();

    const xp = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    const advances = JSON.parse(localStorage.getItem('gc.c1.skills.adv') ?? '{}');
    expect(xp.current).toBe(200);
    expect(advances['Ranged (Bow)']).toBe(10);
    expect(advances.Intimidate).toBe(10);
  });

  it('ignores a rapid duplicate talent purchase until the first one is durable', async () => {
    renderScreen(<TalentsScreen />);

    const increase = screen.getByRole('button', { name: 'Increase Sure Shot' });
    fireEvent.click(increase);
    fireEvent.click(increase);
    await settleStorage();

    const xp = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    const times = JSON.parse(localStorage.getItem('gc.c1.talents.times') ?? '{}');
    expect(xp.current).toBe(140);
    expect(xp.log.filter((entry: { reason: string }) => entry.reason === 'Sure Shot ×2'))
      .toHaveLength(1);
    expect(times[talentIdentityKey({ name: 'Sure Shot', definitionId: 'tal.sure-shot' })]).toBe(2);
  });

  it('rolls back both progression keys and reports failure when a companion write fails', async () => {
    const originalSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === 'gc.c1.skills.adv' && !injected) {
        injected = true;
        throw new Error('injected skill write failure');
      }
      originalSetItem.call(this, key, value);
    });
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ranged (Bow)' }));
    await settleStorage();

    expect(injected).toBe(true);
    expect(localStorage.getItem('gc.c1.xp')).toBeNull();
    expect(localStorage.getItem('gc.c1.skills.adv')).toBeNull();
    expect(getCurrentAlert()?.title).toBe('Could not save purchase');
  });

  it('does not refund or reduce a template-granted skill advance', async () => {
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Decrease Ranged (Bow)' }));
    await settleStorage();

    expect(getCurrentAlert()?.title).toBe("Can't refund");
    expect(getCurrentAlert()?.message).toBe('No matching purchase to refund.');
    expect(localStorage.getItem('gc.c1.xp')).toBeNull();
    expect(localStorage.getItem('gc.c1.skills.adv')).toBeNull();
  });

  it('sums every skill point when a +5 purchase crosses a cost band', async () => {
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ranged (Bow)' }));
    await settleStorage();

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

  it('sums every characteristic point when a +5 purchase crosses a cost band', async () => {
    renderScreen(<CharacteristicsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Ballistic Skill' }));
    await settleStorage();

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

  it('includes a newly purchased Hardy rank in derived Max Wounds', async () => {
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
    await settleStorage();

    expect(Number(screen.getByTestId('max-wounds').textContent)).toBe(before + 3);
    expect(Number(screen.getByTestId('roster-max-wounds').textContent)).toBe(rosterBefore + 3);
  });
});
