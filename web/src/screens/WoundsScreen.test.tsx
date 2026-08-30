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
import { WoundsScreen } from './WoundsScreen';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import talentsPack from '../../public/content/core-talents.json';

const registry = new ContentRegistry([
  rulesPack,
  racesPack,
  talentsPack,
  charactersPack,
] as unknown as ContentPack[]);

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
  vi.restoreAllMocks();
  await cleanupStorageTest();
  document.body.style.overflow = '';
});

describe('WoundsScreen combat transactions', () => {
  it('burns Fate and sets Wounds to zero in one durable journal', async () => {
    localStorage.setItem('gc.c1.wounds', JSON.stringify(5));
    localStorage.setItem('gc.c1.vitals', JSON.stringify({
      fate: 2,
      fortune: 2,
      resilience: 2,
      resolve: 0,
      corruption: 1,
    }));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <WoundsScreen />
      </ContentContext.Provider>,
    );

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

    fireEvent.click(screen.getByRole('button', { name: 'Burn Fate — cheat death' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(journalWrites).toHaveLength(1);
    const journal = JSON.parse(journalWrites[0]) as {
      operations: Array<{ key: string }>;
    };
    expect(journal.operations.map(operation => operation.key)).toEqual([
      STORAGE_VERSION_KEY,
      'gc.c1.vitals',
      'gc.c1.wounds',
    ]);
    expect(JSON.parse(localStorage.getItem('gc.c1.vitals') ?? '{}')).toMatchObject({
      fate: 1,
      fortune: 1,
    });
    expect(JSON.parse(localStorage.getItem('gc.c1.wounds') ?? 'null')).toBe(0);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(getCurrentAlert()?.title).toBe('Fate burned — you cheat death');
  });

  it('leases the critical collection so a rapid double resolve removes only its target', async () => {
    const first = {
      loc: 'Head',
      roll: 12,
      name: 'First wound',
      effect: 'The first effect.',
      days: 2,
    };
    const second = {
      loc: 'Body',
      roll: 63,
      name: 'Second wound',
      effect: 'The second effect.',
      days: 5,
    };
    localStorage.setItem('gc.c1.criticals', JSON.stringify([first, second]));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <WoundsScreen />
      </ContentContext.Provider>,
    );

    const resolve = screen.getByRole('button', { name: 'Mark "First wound" healed' });
    fireEvent.click(resolve);
    fireEvent.click(resolve);
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.criticals') ?? '[]')).toEqual([second]);
    expect(getCurrentAlert()?.title).toBe('Resolved');
  });
});
