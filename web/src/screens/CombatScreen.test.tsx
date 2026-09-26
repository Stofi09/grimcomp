// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { STORAGE_TRANSACTION_JOURNAL_KEY } from '@grimcomp/core';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { browserStorageCore } from '@/storage/browserStorage';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { STORAGE_VERSION_KEY } from '@/storage/storageSchema';
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

function renderCombatScreen(): void {
  render(
    <ContentContext.Provider value={registry}>
      <CombatScreen />
    </ContentContext.Provider>,
  );
}

async function settleStorage(): Promise<void> {
  await act(async () => { await waitForStorageIdle(); });
}

function applyCrossTabCollection(key: string, value: readonly unknown[]): void {
  const raw = JSON.stringify(value);
  localStorage.setItem(key, raw);
  act(() => { browserStorageCore.applyExternal(key, raw); });
}

function seedHitState(): void {
  localStorage.setItem('gc.c1.wounds', JSON.stringify(1));
  localStorage.setItem('gc.c1.advantage', JSON.stringify(2));
  localStorage.setItem('gc.c1.criticals', JSON.stringify([]));
  _resetStoredCache();
}

function openLethalHit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Take a hit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Incoming damage' }), {
    target: { value: '200' },
  });
}

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  drainAlerts();
  vi.restoreAllMocks();
  await cleanupStorageTest();
  document.body.style.overflow = '';
});

describe('CombatScreen weapon distance', () => {
  it('remembers opposed defence and difficulty after navigation and records the overall outcome', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.51);
    renderCombatScreen();
    fireEvent.click(screen.getAllByRole('button', { name: /Roll attack with/ })[0]);
    fireEvent.change(screen.getByLabelText('Difficulty modifier'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText("Defender's defence (0 = unopposed)"), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Roll attack', exact: true }));
    await settleStorage();
    const entry = JSON.parse(localStorage.getItem('gc.c1.rollHistory')!)[0];
    expect(entry.result.success).toBe(true);
    expect(entry.attack).toMatchObject({ landed: false, defender: { target: 90, roll: 52, sl: 4 } });
    cleanup();
    drainAlerts();
    renderCombatScreen();
    fireEvent.click(screen.getAllByRole('button', { name: /Roll attack with/ })[0]);
    expect((screen.getByLabelText('Difficulty modifier') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText("Defender's defence (0 = unopposed)") as HTMLInputElement).value).toBe('90');
    fireEvent.click(screen.getByRole('button', { name: 'Reset attack settings' }));
    expect((screen.getByLabelText("Defender's defence (0 = unopposed)") as HTMLInputElement).value).toBe('0');
  });

  it('applies a critical’s immediate conditions in the same transaction as damage', async () => {
    seedHitState();
    localStorage.setItem('gc.c1.conditions', JSON.stringify({ Bleeding: 1 }));
    _resetStoredCache();
    vi.spyOn(Math, 'random').mockReturnValue(0.54);
    renderCombatScreen();
    openLethalHit();
    fireEvent.click(screen.getByRole('button', { name: /Body — AP/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settleStorage();
    expect(JSON.parse(localStorage.getItem('gc.c1.conditions')!)).toMatchObject({ Bleeding: 1, Stunned: 1, Prone: 1 });
    expect(JSON.parse(localStorage.getItem('gc.c1.criticals')!)[0]).toMatchObject({ name: 'Winded and Reeling', conditionsApplied: true });
  });
  it('records an attack with its difficulty and Advantage without spending wounds', async () => {
    localStorage.setItem('gc.c1.advantage', JSON.stringify(1));
    localStorage.setItem('gc.c1.conditions', JSON.stringify({ Fatigued: 1 }));
    localStorage.setItem('gc.c1.weapons', JSON.stringify([
      { name: 'QA Sword', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [] },
    ]));
    _resetStoredCache();
    vi.spyOn(Math, 'random').mockReturnValue(0.26);
    renderCombatScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Roll attack with QA Sword' }));
    fireEvent.change(screen.getByLabelText('Difficulty modifier'), { target: { value: '-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Roll attack', exact: true }));
    await settleStorage();
    const saved = JSON.parse(localStorage.getItem('gc.c1.rollHistory')!);
    expect(saved).toHaveLength(1);
    expect(saved[0].result).toMatchObject({ baseTarget: 53, modifier: -20, effectiveTarget: 33, roll: 27 });
    expect(saved[0].detail).toContain('Difficulty modifier: -20');
    expect(saved[0].detail).toContain('Hit location');
    expect(localStorage.getItem('gc.c1.wounds')).toBeNull();
    expect(JSON.parse(localStorage.getItem('gc.c1.advantage')!)).toBe(1);
  });

  it('uses and durably persists Range for a ranged weapon even when legacy data also has Reach', async () => {
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

    renderCombatScreen();

    const weapon = screen.getByRole('button', { name: 'QA Longbow' });
    const row = weapon.closest('article');
    expect(row?.textContent).toContain('120');
    expect(row?.textContent).not.toContain('Average');

    fireEvent.click(weapon);
    const distance = screen.getByRole('textbox', { name: 'Range' }) as HTMLInputElement;
    expect(distance.value).toBe('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settleStorage();

    const stored = JSON.parse(localStorage.getItem('gc.c1.weapons') ?? '[]') as Array<{
      reach?: string;
      range?: string;
    }>;
    expect(stored[0]).toMatchObject({ range: '120' });
    expect(stored[0].reach).toBeUndefined();
  });
});

describe('CombatScreen inventory identity', () => {
  it('relocates a weapon after a cross-tab reorder and durably edits only the selected weapon', async () => {
    const sword = {
      name: 'QA Sword', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [],
    };
    const axe = {
      name: 'QA Axe', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+3', qual: [],
    };
    localStorage.setItem('gc.c1.weapons', JSON.stringify([sword, axe]));
    _resetStoredCache();
    renderCombatScreen();

    fireEvent.click(screen.getByRole('button', { name: 'QA Sword' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'QA Fine Sword' } });
    applyCrossTabCollection('gc.c1.weapons', [axe, sword]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog', { name: 'Edit weapon' })).toBeTruthy();
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.weapons') ?? '[]')).toEqual([
      axe,
      { ...sword, name: 'QA Fine Sword' },
    ]);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit weapon' })).toBeNull();
  });

  it('refuses to remove another armour piece when the selection disappeared in another tab', async () => {
    const leather = {
      name: 'QA Leather', locs: ['Body'], enc: 1, ap: 1, qual: [],
    };
    const mail = {
      name: 'QA Mail', locs: ['Body'], enc: 2, ap: 2, qual: [],
    };
    localStorage.setItem('gc.c1.armour', JSON.stringify([leather, mail]));
    _resetStoredCache();
    renderCombatScreen();

    fireEvent.click(screen.getByRole('button', { name: /QA Leather/u }));
    applyCrossTabCollection('gc.c1.armour', [mail]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.armour') ?? '[]')).toEqual([mail]);
    expect(screen.getByRole('dialog', { name: 'Edit armour' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Armour changed');
  });

  it('rolls a failed weapon drop back and keeps the editor open', async () => {
    const sword = {
      name: 'QA Sword', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [],
    };
    localStorage.setItem('gc.c1.weapons', JSON.stringify([sword]));
    _resetStoredCache();
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c1.weapons') {
        injected = true;
        throw new Error('injected weapon drop failure');
      }
      realSetItem.call(this, key, value);
    });
    renderCombatScreen();

    fireEvent.click(screen.getByRole('button', { name: 'QA Sword' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c1.weapons') ?? '[]')).toEqual([sword]);
    expect(screen.getByRole('dialog', { name: 'Edit weapon' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not drop weapon');
  });
});

describe('CombatScreen hit transactions', () => {
  it('commits Wounds, Advantage, and a generated critical in one journal', async () => {
    seedHitState();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const journalWrites: string[] = [];
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === STORAGE_TRANSACTION_JOURNAL_KEY) journalWrites.push(value);
      realSetItem.call(this, key, value);
    });

    renderCombatScreen();
    openLethalHit();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(getCurrentAlert()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Take a hit' })).toBeTruthy();
    await settleStorage();

    expect(journalWrites).toHaveLength(1);
    const journal = JSON.parse(journalWrites[0]) as {
      operations: Array<{ key: string }>;
    };
    expect(journal.operations.map(operation => operation.key)).toEqual([
      STORAGE_VERSION_KEY,
      'gc.c1.wounds',
      'gc.c1.advantage',
      'gc.c1.criticals',
    ]);
    expect(JSON.parse(localStorage.getItem('gc.c1.wounds') ?? 'null')).toBe(0);
    expect(JSON.parse(localStorage.getItem('gc.c1.advantage') ?? 'null')).toBe(0);
    expect(JSON.parse(localStorage.getItem('gc.c1.criticals') ?? '[]')).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Take a hit' })).toBeNull();
    expect(getCurrentAlert()?.title).toMatch(/^Hit/);
  });

  it('ignores a duplicate Apply while the first hit is still being persisted', async () => {
    seedHitState();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const journalWrites: string[] = [];
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === STORAGE_TRANSACTION_JOURNAL_KEY) journalWrites.push(value);
      realSetItem.call(this, key, value);
    });

    renderCombatScreen();
    openLethalHit();
    const apply = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(apply);
    fireEvent.click(apply);
    await settleStorage();

    expect(journalWrites).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('gc.c1.criticals') ?? '[]')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Take a hit' })).toBeNull();
    expect(getCurrentAlert()?.title).toMatch(/^Hit/);
  });

  it('rolls every hit key back and keeps the dialog open when a mid-write fails', async () => {
    seedHitState();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const realSetItem = Storage.prototype.setItem;
    let injectedFailure = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injectedFailure && key === 'gc.c1.advantage' && value === '0') {
        injectedFailure = true;
        throw new Error('forced mid-write failure');
      }
      realSetItem.call(this, key, value);
    });

    renderCombatScreen();
    openLethalHit();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settleStorage();

    expect(injectedFailure).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c1.wounds') ?? 'null')).toBe(1);
    expect(JSON.parse(localStorage.getItem('gc.c1.advantage') ?? 'null')).toBe(2);
    expect(JSON.parse(localStorage.getItem('gc.c1.criticals') ?? '[]')).toEqual([]);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Take a hit' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not apply hit');
  });
});
