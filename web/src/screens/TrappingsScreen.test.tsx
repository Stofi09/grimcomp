// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { STORAGE_TRANSACTION_JOURNAL_KEY } from '@grimcomp/core';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { browserStorageCore } from '@/storage/browserStorage';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { TrappingsScreen } from './TrappingsScreen';
import type { ContentPack } from '@/content/types';
import itemsPack from '../../public/content/core-items.json';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';

beforeEach(async () => prepareStorageTest());

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

function renderTrappings(registry = new ContentRegistry([])): void {
  render(
    <ContentContext.Provider value={registry}>
      <TrappingsScreen />
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

afterEach(async () => {
  cleanup();
  drainAlerts();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('TrappingsScreen wealth', () => {
  it.each([false, true])('equips a legacy dagger atomically (write failure: %s)', async (fail) => {
    const inventory = [{ name: 'Dagger', enc: 0 }, { name: 'Lantern', enc: 1 }];
    localStorage.setItem('gc.c1.trappings', JSON.stringify(inventory));
    localStorage.setItem('gc.c1.weapons', '[]');
    _resetStoredCache();
    const write = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (fail && !failed && key === 'gc.c1.weapons') { failed = true; throw new Error('disk full'); }
      write.call(this, key, value);
    });
    renderTrappings(new ContentRegistry([itemsPack] as unknown as ContentPack[]));
    fireEvent.click(screen.getByRole('button', { name: 'Dagger 0' }));
    const equip = screen.getByRole('button', { name: 'Equip as weapon' });
    fireEvent.click(equip);
    fireEvent.click(equip);
    await settleStorage();
    expect(JSON.parse(localStorage.getItem('gc.c1.trappings')!)).toEqual(fail ? inventory : [inventory[1]]);
    const weapons = JSON.parse(localStorage.getItem('gc.c1.weapons')!);
    if (fail) expect(weapons).toEqual([]);
    else {
      expect(weapons).toHaveLength(1);
      expect(weapons[0]).toMatchObject({ name: 'Dagger', group: 'Basic', dmg: 'SB+2', qual: [], enc: 0 });
    }
  });
  it('edits and persists the active character\'s configured denominations', async () => {
    renderTrappings();

    fireEvent.click(screen.getByRole('button', { name: 'Edit wealth' }));
    fireEvent.change(screen.getByLabelText('GC'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('SS'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.wealth') || '{}')).toMatchObject({
      gc: 4,
      ss: 7,
      d: 0,
    });
  });

  it('keeps the wealth sheet open and reports a failed durable save', async () => {
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c1.wealth') {
        injected = true;
        throw new Error('injected wealth failure');
      }
      realSetItem.call(this, key, value);
    });
    renderTrappings();

    fireEvent.click(screen.getByRole('button', { name: 'Edit wealth' }));
    fireEvent.change(screen.getByLabelText('GC'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(localStorage.getItem('gc.c1.wealth')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit wealth' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not save wealth');
  });
});

describe('TrappingsScreen inventory durability', () => {
  it('relocates the edited item after a cross-tab reorder and durably updates only that item', async () => {
    const rope = { name: 'QA Rope', enc: 1 };
    const torch = { name: 'QA Torch', enc: 0 };
    localStorage.setItem('gc.c1.trappings', JSON.stringify([rope, torch]));
    _resetStoredCache();
    renderTrappings();

    fireEvent.click(screen.getByRole('button', { name: /QA Rope/u }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'QA Silk Rope' } });
    applyCrossTabCollection('gc.c1.trappings', [torch, rope]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeTruthy();
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.trappings') ?? '[]')).toEqual([
      torch,
      { name: 'QA Silk Rope', enc: 1 },
    ]);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull();
  });

  it('refuses to drop a different item when the selected item was removed in another tab', async () => {
    const rope = { name: 'QA Rope', enc: 1 };
    const torch = { name: 'QA Torch', enc: 0 };
    localStorage.setItem('gc.c1.trappings', JSON.stringify([rope, torch]));
    _resetStoredCache();
    renderTrappings();

    fireEvent.click(screen.getByRole('button', { name: /QA Rope/u }));
    applyCrossTabCollection('gc.c1.trappings', [torch]);
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.trappings') ?? '[]')).toEqual([torch]);
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Item changed');
  });

  it('rolls a dropped item back, keeps the sheet open, and withholds success on failure', async () => {
    localStorage.setItem('gc.c1.trappings', JSON.stringify([{ name: 'QA Rope', enc: 1 }]));
    _resetStoredCache();
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c1.trappings' && value === '[]') {
        injected = true;
        throw new Error('injected drop failure');
      }
      realSetItem.call(this, key, value);
    });
    renderTrappings();

    fireEvent.click(screen.getByRole('button', { name: /QA Rope/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(getCurrentAlert()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeTruthy();
    await settleStorage();

    expect(injected).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c1.trappings') ?? '[]')).toEqual([
      { name: 'QA Rope', enc: 1 },
    ]);
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not drop item');
  });
});
