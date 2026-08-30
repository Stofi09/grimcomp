// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack, TalentDef } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { TALENT_TRACKING_NOTICE, talentIdentityKey } from '@/utils/talents';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import talentsPack from '../../public/content/core-talents.json';
import windsPack from '../../public/content/winds-of-magic.json';
import { TalentsScreen } from './TalentsScreen';

const basePacks = [
  rulesPack,
  racesPack,
  careersPack,
  talentsPack,
  charactersPack,
  windsPack,
] as unknown as ContentPack[];

const registry = new ContentRegistry(basePacks);

function registryWithTalents(talents: TalentDef[]): ContentRegistry {
  return new ContentRegistry([...basePacks, {
    $schema: 'grimcomp.content.v2',
    id: 'test-talent-identities',
    name: 'Test talent identities',
    version: '1',
    talents,
  }]);
}

function renderScreen(content: ContentRegistry = registry): void {
  render(
    <ContentContext.Provider value={content}>
      <TalentsScreen />
    </ContentContext.Provider>,
  );
}

function openPicker(search: string): void {
  fireEvent.click(screen.getByRole('button', {
    name: /New talent \d+ career options, \d+ total available/,
  }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search talents' }), {
    target: { value: search },
  });
}

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

async function settleStorage(): Promise<void> {
  await act(async () => { await waitForStorageIdle(); });
}

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  drainAlerts();
  document.body.style.overflow = '';
  await cleanupStorageTest();
});

describe('catalog talent acquisition', () => {
  it('clears a hidden selection when the search changes', () => {
    renderScreen();

    openPicker('Magical Assistant');
    fireEvent.click(screen.getByRole('option', { name: /Magical Assistant/ }));
    const buyButton = screen.getByRole('button', { name: 'Buy · 100 XP' });
    expect(buyButton.hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search talents' }), {
      target: { value: 'Suffuse with' },
    });

    expect(screen.getByRole('option', { name: /Suffuse with \(Wind\)/ })).toBeTruthy();
    expect(buyButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(buyButton);
    expect(getCurrentAlert()).toBeNull();
    expect(localStorage.getItem('gc.c1.talents.added')).toBeNull();
  });

  it('requires explicit eligibility confirmation and retains manual source metadata', async () => {
    renderScreen();

    expect(screen.getByText(TALENT_TRACKING_NOTICE)).toBeTruthy();
    openPicker('Power Familiar only');
    const option = screen.getByRole('option', { name: /Magical Assistant/ });
    expect(option.textContent).toContain('Source: Winds of Magic · p. 186');
    expect(option.textContent).toContain("Index only — resolve this Talent's effect from the source");
    expect(option.textContent).toContain('Restriction: Power Familiar only');
    expect(option.textContent).toContain('Rules note: Consult the current source for the eligible assistance Tests.');

    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));

    const confirmation = getCurrentAlert();
    expect(confirmation?.title).toBe('Confirm talent eligibility');
    expect(confirmation?.message).toContain('Restriction: Power Familiar only');
    expect(confirmation?.message).toContain('Source: Winds of Magic · p. 186');
    expect(confirmation?.message).toContain(TALENT_TRACKING_NOTICE);
    expect(localStorage.getItem('gc.c1.talents.added')).toBeNull();

    const confirm = confirmation?.buttons?.find(button => button.text.startsWith('Confirm & buy'));
    act(() => {
      closeCurrentAlert();
      confirm?.onPress?.();
    });
    await settleStorage();

    expect(getCurrentAlert()?.title).toBe('Bought talent');
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      { definitionId: 'tal.magical-assistant', name: 'Magical Assistant' },
    ]);
    expect(screen.getByText('Magical Assistant').closest('.gc-card')?.textContent)
      .toContain('Winds of Magic · p. 186');
    expect(screen.getByText('Magical Assistant').closest('.gc-card')?.textContent)
      .toContain("Index only — resolve this Talent's effect from the source");
    expect(screen.getByText('Magical Assistant').closest('.gc-card')?.textContent)
      .toContain('Restriction: Power Familiar only');
    expect(screen.getByRole('button', { name: 'Increase Magical Assistant' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /Test Magical Assistant/ })).toBeNull();
  });

  it('requires one Wind, permits another variant, excludes the same choice, and applies Max per form', async () => {
    renderScreen();

    openPicker('Aqshy');
    const suffuse = screen.getByRole('option', { name: /Suffuse with \(Wind\)/ });
    expect(suffuse.textContent).toContain('Tests: See text');
    expect(suffuse.textContent).toContain('Choices: Aqshy, Azyr, Chamon, Ghur, Ghyran, Hysh, Shyish, Ulgu');
    fireEvent.click(suffuse);

    const buyButton = screen.getByRole('button', { name: 'Buy · 100 XP' });
    expect(buyButton.hasAttribute('disabled')).toBe(true);
    for (const wind of ['Aqshy', 'Azyr', 'Chamon', 'Ghur', 'Ghyran', 'Hysh', 'Shyish', 'Ulgu']) {
      expect(screen.getByRole('button', { name: wind })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Aqshy' }));
    fireEvent.click(buyButton);
    await settleStorage();
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      {
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Aqshy',
        name: 'Suffuse with Aqshy',
      },
    ]);
    expect(screen.getByRole('button', { name: 'Increase Suffuse with Aqshy' }).hasAttribute('disabled')).toBe(true);
    closeCurrentAlert();

    openPicker('Suffuse with');
    fireEvent.click(screen.getByRole('option', { name: /Suffuse with \(Wind\)/ }));
    expect(screen.queryByRole('button', { name: 'Aqshy' })).toBeNull();
    expect(screen.getByText(/Already acquired: Aqshy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Azyr' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      {
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Aqshy',
        name: 'Suffuse with Aqshy',
      },
      {
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Azyr',
        name: 'Suffuse with Azyr',
      },
    ]);
    expect(screen.getByRole('button', { name: 'Increase Suffuse with Aqshy' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Increase Suffuse with Azyr' }).hasAttribute('disabled')).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.times') ?? '{}')).toEqual(expect.objectContaining({
      [talentIdentityKey({
        name: 'Suffuse with Aqshy',
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Aqshy',
      })]: 1,
      [talentIdentityKey({
        name: 'Suffuse with Azyr',
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Azyr',
      })]: 1,
    }));
  });

  it('keeps same-name definitions independent through purchase and removal', async () => {
    const duplicateRegistry = registryWithTalents([{
      id: 'tal.echo-first',
      name: 'Echo Gift',
      description: 'First identity',
      sourceBook: 'First Source',
      max: 1,
    }, {
      id: 'tal.echo-second',
      name: 'Echo Gift',
      description: 'Second identity',
      sourceBook: 'Second Source',
      max: 2,
    }]);
    renderScreen(duplicateRegistry);

    openPicker('Echo Gift');
    const firstOption = screen.getAllByRole('option', { name: /Echo Gift/ })
      .find(option => option.textContent?.includes('First identity'))!;
    fireEvent.click(firstOption);
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();
    closeCurrentAlert();

    openPicker('Echo Gift');
    const remainingOption = screen.getByRole('option', { name: /Echo Gift/ });
    expect(remainingOption.textContent).toContain('Second identity');
    fireEvent.click(remainingOption);
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();
    closeCurrentAlert();

    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      { definitionId: 'tal.echo-first', name: 'Echo Gift' },
      { definitionId: 'tal.echo-second', name: 'Echo Gift' },
    ]);
    const xpBeforeRemoval = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    expect(xpBeforeRemoval.log.filter((entry: { reason: string }) => entry.reason === 'Echo Gift ×1'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ entityKey: talentIdentityKey({ name: 'Echo Gift', definitionId: 'tal.echo-first' }) }),
        expect.objectContaining({ entityKey: talentIdentityKey({ name: 'Echo Gift', definitionId: 'tal.echo-second' }) }),
      ]));

    const firstCard = screen.getByText('First identity').closest('.gc-card')!;
    const secondCard = screen.getByText('Second identity').closest('.gc-card')!;
    expect(within(firstCard).getByRole('button', { name: 'Increase Echo Gift' }).hasAttribute('disabled'))
      .toBe(true);
    expect(within(secondCard).getByRole('button', { name: 'Increase Echo Gift' }).hasAttribute('disabled'))
      .toBe(false);
    fireEvent.click(within(firstCard).getByRole('button', { name: 'Remove Echo Gift' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      { definitionId: 'tal.echo-second', name: 'Echo Gift' },
    ]);
    expect(screen.queryByText('First identity')).toBeNull();
    expect(screen.getByText('Second identity')).toBeTruthy();
    const remainingLog = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}').log;
    expect(remainingLog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityKey: talentIdentityKey({ name: 'Echo Gift', definitionId: 'tal.echo-second' }),
      }),
    ]));
    expect(remainingLog).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityKey: talentIdentityKey({ name: 'Echo Gift', definitionId: 'tal.echo-first' }),
      }),
    ]));
  });

  it('refunds a renamed definition by stable key and its stored legacy label', async () => {
    const oldRegistry = registryWithTalents([{
      id: 'tal.rename-check',
      name: 'Old Gift',
      description: 'Original definition',
      max: 3,
    }]);
    const renamedRegistry = registryWithTalents([{
      id: 'tal.rename-check',
      name: 'New Gift',
      description: 'Renamed definition',
      max: 3,
    }]);
    renderScreen(oldRegistry);

    openPicker('Old Gift');
    fireEvent.click(screen.getByRole('option', { name: /Old Gift/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();
    closeCurrentAlert();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Old Gift' }));
    await settleStorage();
    closeCurrentAlert();

    cleanup();
    _resetStoredCache();
    renderScreen(renamedRegistry);

    expect(screen.getByText('New Gift').closest('.gc-card')?.textContent).toContain('×2 / 3');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease New Gift' }));
    await settleStorage();
    expect(screen.getByText('New Gift').closest('.gc-card')?.textContent).toContain('×1 / 3');
    const afterStableRefund = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}');
    expect(afterStableRefund.log.filter((entry: { reason: string }) => entry.reason.startsWith('Old Gift')))
      .toEqual([
      expect.objectContaining({
        reason: 'Old Gift ×1',
        entityKey: talentIdentityKey({ name: 'Old Gift', definitionId: 'tal.rename-check' }),
      }),
      ]);

    // Simulate a pre-entityKey XP log: the ref's stored name snapshot remains
    // a valid refund alias even though the loaded definition has been renamed.
    afterStableRefund.log = afterStableRefund.log.map((entry: Record<string, unknown>) => {
      if (entry.reason !== 'Old Gift ×1') return entry;
      const { entityKey: _drop, ...legacy } = entry;
      return legacy;
    });
    localStorage.setItem('gc.c1.xp', JSON.stringify(afterStableRefund));
    cleanup();
    _resetStoredCache();
    renderScreen(renamedRegistry);

    fireEvent.click(screen.getByRole('button', { name: 'Remove New Gift' }));
    await settleStorage();
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([]);
    expect(screen.queryByText('New Gift')).toBeNull();
    expect(JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}').log
      .filter((entry: { reason: string }) => entry.reason.startsWith('Old Gift'))).toEqual([]);
  });

  it('persists legacy ownership/ranks as an idempotent canonical migration', async () => {
    localStorage.setItem('gc.c1.talents.added', JSON.stringify([
      'Alley Cat',
      { name: 'Historical Alley Cat', definitionId: 'tal.alley-cat' },
    ]));
    localStorage.setItem('gc.c1.talents.times', JSON.stringify({
      'Alley Cat': 2,
      'Detached Talent': 4,
    }));
    _resetStoredCache();
    renderScreen();
    await settleStorage();

    expect(screen.getAllByText('Alley Cat')).toHaveLength(1);
    expect(screen.getByText('Alley Cat').closest('.gc-card')?.textContent).toContain('×2');
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([{
      name: 'Historical Alley Cat',
      definitionId: 'tal.alley-cat',
    }]);
    const firstTimes = JSON.parse(localStorage.getItem('gc.c1.talents.times') ?? '{}');
    expect(firstTimes).toEqual(expect.objectContaining({
      [talentIdentityKey({ name: 'Alley Cat', definitionId: 'tal.alley-cat' })]: 2,
      'Detached Talent': 4,
    }));
    expect(firstTimes).not.toHaveProperty('Alley Cat');
    const persistedAdded = localStorage.getItem('gc.c1.talents.added');
    const persistedTimes = localStorage.getItem('gc.c1.talents.times');

    cleanup();
    _resetStoredCache();
    renderScreen();
    await settleStorage();

    expect(localStorage.getItem('gc.c1.talents.added')).toBe(persistedAdded);
    expect(localStorage.getItem('gc.c1.talents.times')).toBe(persistedTimes);
  });

  it('keeps malformed, legacy, custom, and unavailable stored entries safe and visible', async () => {
    localStorage.setItem('gc.c1.talents.added', JSON.stringify([
      null,
      7,
      {},
      ' Acute Sense ',
      'Legacy Gift',
      { name: 'Lost Grimoire Talent', definitionId: 'tal.missing' },
      { name: 'Bad id', definitionId: 42 },
      { name: 'Duplicate missing', definitionId: 'tal.missing' },
    ]));
    localStorage.setItem('gc.c1.talents.times', JSON.stringify({
      'Acute Sense': 2,
      'Legacy Gift': 2,
      'Lost Grimoire Talent': 1,
      Zero: 0,
      Fraction: 1.5,
      Wrong: '2',
    }));
    _resetStoredCache();
    renderScreen();
    await settleStorage();

    expect(screen.getByText('Acute Sense')).toBeTruthy();
    expect(screen.getByText('Legacy Gift').closest('.gc-card')?.textContent).toContain('×2');
    expect(screen.getByText('Lost Grimoire Talent')).toBeTruthy();
    expect(screen.getAllByText('source unavailable').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Loaded definition unavailable/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Sure Shot').closest('.gc-card')?.textContent)
      .toContain('No penalty when shooting from a moving mount');

    openPicker('Alley Cat');
    fireEvent.click(screen.getByRole('option', { name: /Alley Cat/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      { name: 'Acute Sense', definitionId: 'tal.acute-sense' },
      { name: 'Legacy Gift' },
      { name: 'Lost Grimoire Talent', definitionId: 'tal.missing' },
      { name: 'Alley Cat', definitionId: 'tal.alley-cat' },
    ]);
    const migratedTimes = JSON.parse(localStorage.getItem('gc.c1.talents.times') ?? '{}');
    expect(migratedTimes).toEqual(expect.objectContaining({
      [talentIdentityKey({ name: 'Acute Sense', definitionId: 'tal.acute-sense' })]: 2,
      [talentIdentityKey({ name: 'Legacy Gift' })]: 2,
      [talentIdentityKey({ name: 'Lost Grimoire Talent', definitionId: 'tal.missing' })]: 1,
      [talentIdentityKey({ name: 'Alley Cat', definitionId: 'tal.alley-cat' })]: 1,
    }));
    expect(migratedTimes).not.toHaveProperty('Zero');
    expect(migratedTimes).not.toHaveProperty('Fraction');
    expect(migratedTimes).not.toHaveProperty('Wrong');
  });
});
