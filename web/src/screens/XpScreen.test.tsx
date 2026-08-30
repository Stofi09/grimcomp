// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { XpScreen } from './XpScreen';
import charactersPack from '../../public/content/core-characters.json';
import rulesPack from '../../public/content/core-rules.json';

const registry = new ContentRegistry([
  rulesPack,
  charactersPack,
] as unknown as ContentPack[]);

function renderXp(): void {
  render(
    <ContentContext.Provider value={registry}>
      <XpScreen />
    </ContentContext.Provider>,
  );
}

function takeAlertAction(label: string): () => void {
  const alert = getCurrentAlert();
  const action = alert?.buttons?.find(button => button.text === label)?.onPress;
  if (!action) throw new Error(`Missing alert action ${JSON.stringify(label)}.`);
  closeCurrentAlert();
  return action;
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
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('XpScreen award durability', () => {
  it('records a rapid duplicate award once and reports success only after commit', async () => {
    const realSetItem = Storage.prototype.setItem;
    let xpWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === 'gc.c1.xp') xpWrites += 1;
      realSetItem.call(this, key, value);
    });
    renderXp();

    fireEvent.click(screen.getByRole('button', { name: 'Award XP' }));
    const award = takeAlertAction('+50 XP');
    act(() => {
      award();
      award();
    });
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    const stored = JSON.parse(localStorage.getItem('gc.c1.xp') ?? '{}') as {
      current: number;
      log: Array<{ amount: number; reason: string }>;
    };
    expect(xpWrites).toBe(1);
    expect(stored.current).toBe((registry.getCharacterTemplate('c1')?.xpCurrent ?? 0) + 50);
    expect(stored.log.filter(entry => entry.reason === 'Session reward' && entry.amount === 50)).toHaveLength(1);
    expect(getCurrentAlert()?.title).toBe('XP awarded');
  });

  it('rolls the award back and withholds success when persistence fails', async () => {
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c1.xp') {
        injected = true;
        throw new Error('injected XP failure');
      }
      realSetItem.call(this, key, value);
    });
    renderXp();

    fireEvent.click(screen.getByRole('button', { name: 'Award XP' }));
    const award = takeAlertAction('+50 XP');
    act(() => { award(); });
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(localStorage.getItem('gc.c1.xp')).toBeNull();
    expect(getCurrentAlert()?.title).toBe('Could not award XP');
  });
});
