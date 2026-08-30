// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { FaithScreen } from './FaithScreen';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import faithPack from '../../public/content/core-faith.json';
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
  faithPack,
  charactersPack,
] as unknown as ContentPack[]);

function renderFaith(): void {
  render(
    <ContentContext.Provider value={registry}>
      <FaithScreen />
    </ContentContext.Provider>,
  );
}

function selectAnointedWithSin(): void {
  localStorage.setItem('gc.activeCharId', JSON.stringify('c4'));
  localStorage.setItem('gc.c4.sin', JSON.stringify(1));
  _resetStoredCache();
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

describe('FaithScreen Wrath durability', () => {
  it('waits for one durable Sin update before reporting a rapid duplicate prayer', async () => {
    selectAnointedWithSin();
    vi.spyOn(Math, 'random').mockReturnValue(0); // d100 → 1, which triggers Wrath at 1 Sin.
    const realSetItem = Storage.prototype.setItem;
    let sinWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === 'gc.c4.sin') sinWrites += 1;
      realSetItem.call(this, key, value);
    });
    renderFaith();

    const pray = screen.getByRole('button', { name: 'Pray Calm Soul' });
    fireEvent.click(pray);
    fireEvent.click(pray);
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(sinWrites).toBe(1);
    expect(JSON.parse(localStorage.getItem('gc.c4.sin') ?? 'null')).toBe(0);
    expect(getCurrentAlert()?.title).toBe('Calm Soul — Wrath of the Gods');
    expect(getCurrentAlert()?.message).toContain('−1 Sin (now 0)');
  });

  it('rolls Sin back and withholds the prayer result when persistence fails', async () => {
    selectAnointedWithSin();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c4.sin' && value === '0') {
        injected = true;
        throw new Error('injected Sin write failure');
      }
      realSetItem.call(this, key, value);
    });
    renderFaith();

    fireEvent.click(screen.getByRole('button', { name: 'Pray Calm Soul' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c4.sin') ?? 'null')).toBe(1);
    expect(getCurrentAlert()?.title).toBe('Could not record Wrath');
    expect(getCurrentAlert()?.message).toContain('Sin change could not be saved');
  });
});
