// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { STORAGE_TRANSACTION_JOURNAL_KEY } from '@grimcomp/core';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
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
    const row = weapon.closest('.tbl-row');
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
