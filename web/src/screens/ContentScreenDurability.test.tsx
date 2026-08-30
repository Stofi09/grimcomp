// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack, Spell } from '@/content/types';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { ContentScreen } from './ContentScreen';

const bundledSpell: Spell = {
  id: 'spell.original',
  name: 'Original Spell',
  lore: 'Arcane',
  cn: 1,
  range: 'Touch',
  target: '1',
  duration: 'Instant',
  description: 'A durability test spell.',
};

const registry = new ContentRegistry([{
  $schema: 'grimcomp.content.v2',
  id: 'content-durability-test',
  name: 'Content durability test',
  version: '1',
  spells: [bundledSpell],
}] satisfies ContentPack[]);

function renderContent(): void {
  render(
    <ContentContext.Provider value={registry}>
      <ContentScreen />
    </ContentContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Spells' }));
}

function openRenamedSpell(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const editor = screen.getByRole('textbox', { name: 'Edit spell JSON' });
  fireEvent.change(editor, {
    target: {
      value: JSON.stringify({ ...bundledSpell, id: 'spell.renamed', name: 'Renamed Spell' }, null, 2),
    },
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
  vi.restoreAllMocks();
  await cleanupStorageTest();
  document.body.style.overflow = '';
});

describe('ContentScreen rename durability', () => {
  it('commits the replacement and old-id tombstone in one guarded write', async () => {
    const realSetItem = Storage.prototype.setItem;
    let editWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === 'gc.content.userEdits') editWrites += 1;
      realSetItem.call(this, key, value);
    });
    renderContent();
    openRenamedSpell();

    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(getCurrentAlert()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit spell.renamed' })).toBeTruthy();
    await settleStorage();

    const stored = JSON.parse(localStorage.getItem('gc.content.userEdits') ?? '{}') as ContentPack;
    expect(editWrites).toBe(1);
    expect(stored.spells).toMatchObject([{ id: 'spell.renamed', name: 'Renamed Spell' }]);
    expect(stored.deletions?.spells).toEqual(['spell.original']);
    expect(screen.queryByRole('dialog', { name: 'Edit spell.renamed' })).toBeNull();
  });

  it('rolls the whole rename back, keeps the editor open, and reports failure', async () => {
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.content.userEdits') {
        injected = true;
        throw new Error('injected content rename failure');
      }
      realSetItem.call(this, key, value);
    });
    renderContent();
    openRenamedSpell();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(localStorage.getItem('gc.content.userEdits')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit spell.renamed' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not save entry');
  });

  it('rolls a failed delete back, keeps the editor open, and reports failure', async () => {
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.content.userEdits') {
        injected = true;
        throw new Error('injected content delete failure');
      }
      realSetItem.call(this, key, value);
    });
    renderContent();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit spell.original' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(localStorage.getItem('gc.content.userEdits')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit spell.original' })).toBeTruthy();
    expect(getCurrentAlert()?.title).toBe('Could not delete entry');
  });
});
