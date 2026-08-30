// @vitest-environment jsdom

import { STORAGE_TRANSACTION_JOURNAL_KEY } from '@grimcomp/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { characterKey } from '@/hooks/useCharacter';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { FALLBACK_CHARACTER_ID, type Character } from '@/data/character';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { STORAGE_VERSION_KEY } from '@/storage/storageSchema';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { RosterScreen } from './RosterScreen';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';

const registry = new ContentRegistry([
  rulesPack,
  racesPack,
  charactersPack,
] as unknown as ContentPack[]);

const CUSTOM_ID = 'custom-delete-test';
const CUSTOM_NAME = 'Marta Delete-Test';

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

function renderRoster(): void {
  render(
    <ContentContext.Provider value={registry}>
      <RosterScreen onNav={() => undefined} />
    </ContentContext.Provider>,
  );
}

function seedActiveCustomCharacter(): Character {
  const base = registry.allCharacterTemplates[0];
  if (!base) throw new Error('Character template fixture is missing');
  const character: Character = {
    ...base,
    id: CUSTOM_ID,
    name: CUSTOM_NAME,
    initials: 'MD',
  };
  localStorage.setItem('gc.customChars', JSON.stringify({ [CUSTOM_ID]: character }));
  localStorage.setItem('gc.activeCharId', JSON.stringify(CUSTOM_ID));
  localStorage.setItem(characterKey(CUSTOM_ID, 'wounds'), JSON.stringify(7));
  localStorage.setItem(characterKey(CUSTOM_ID, 'xp'), JSON.stringify({
    current: 125,
    spent: 50,
    log: [],
  }));
  _resetStoredCache();
  return character;
}

function confirmPendingDeletion(): void {
  const confirmation = getCurrentAlert();
  expect(confirmation?.title).toBe('Delete character');
  const destructive = confirmation?.buttons?.find(button => button.style === 'destructive');
  if (!destructive?.onPress) throw new Error('Delete confirmation action is missing');
  act(() => {
    closeCurrentAlert();
    destructive.onPress?.();
  });
}

beforeEach(async () => {
  await prepareStorageTest();
});

afterEach(async () => {
  cleanup();
  drainAlerts();
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('RosterScreen character copy', () => {
  it('shows live identity, career, wounds, and spendable XP instead of template values', () => {
    localStorage.setItem(characterKey('c1', 'identity'), JSON.stringify({ name: 'Erika Braun' }));
    localStorage.setItem(characterKey('c1', 'career.level'), JSON.stringify(3));
    localStorage.setItem(characterKey('c1', 'wounds'), JSON.stringify(7));
    localStorage.setItem(characterKey('c1', 'xp'), JSON.stringify({
      current: 125,
      spent: 1000,
      log: [],
    }));
    _resetStoredCache();

    renderRoster();

    const card = screen.getByRole('button', { name: 'Switch to Erika Braun' });
    expect(card.textContent).toContain('Human · Mounted Sergeant · rank 3 · Silver 4');
    expect(card.textContent).toMatch(/WOUNDS7\/\d+/);
    expect(card.textContent).toContain('SPENDABLE XP125');
    expect(screen.getByText('guided race, characteristics, and career setup')).toBeTruthy();
  });

  it('deletes roster, overlays, and active id fallback in one journal', async () => {
    seedActiveCustomCharacter();
    renderRoster();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    fireEvent.click(screen.getByRole('button', { name: `Delete ${CUSTOM_NAME}` }));
    confirmPendingDeletion();
    // Web cache publication is durability-gated: the card remains until the
    // journal is fully committed and verified.
    expect(screen.getByRole('button', { name: `Switch to ${CUSTOM_NAME}` })).toBeTruthy();
    await act(async () => { await waitForStorageIdle(); });

    expect(JSON.parse(localStorage.getItem('gc.customChars') ?? 'null')).toEqual({});
    expect(JSON.parse(localStorage.getItem('gc.activeCharId') ?? 'null')).toBe(FALLBACK_CHARACTER_ID);
    expect(localStorage.getItem(characterKey(CUSTOM_ID, 'wounds'))).toBeNull();
    expect(localStorage.getItem(characterKey(CUSTOM_ID, 'xp'))).toBeNull();
    expect(screen.queryByRole('button', { name: `Switch to ${CUSTOM_NAME}` })).toBeNull();
    expect(getCurrentAlert()).toBeNull();

    const journals = setItem.mock.calls
      .filter(([key]) => key === STORAGE_TRANSACTION_JOURNAL_KEY)
      .map(([, raw]) => JSON.parse(raw) as { operations: Array<{ key: string }> });
    expect(journals).toHaveLength(1);
    expect(journals[0].operations.map(operation => operation.key).sort()).toEqual([
      'gc.activeCharId',
      'gc.customChars',
      STORAGE_VERSION_KEY,
      characterKey(CUSTOM_ID, 'wounds'),
      characterKey(CUSTOM_ID, 'xp'),
    ].sort());
  });

  it('rolls back roster and every overlay when the late active-id write fails', async () => {
    seedActiveCustomCharacter();
    const beforeCustom = localStorage.getItem('gc.customChars');
    const beforeActive = localStorage.getItem('gc.activeCharId');
    const beforeWounds = localStorage.getItem(characterKey(CUSTOM_ID, 'wounds'));
    const beforeXp = localStorage.getItem(characterKey(CUSTOM_ID, 'xp'));
    renderRoster();
    const originalSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'gc.activeCharId' && !injected) {
        injected = true;
        throw new Error('injected active-id fallback failure');
      }
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole('button', { name: `Delete ${CUSTOM_NAME}` }));
    confirmPendingDeletion();
    await act(async () => { await waitForStorageIdle(); });

    expect(injected).toBe(true);
    expect(getCurrentAlert()?.title).toBe('Character not deleted');
    expect(localStorage.getItem('gc.customChars')).toBe(beforeCustom);
    expect(localStorage.getItem('gc.activeCharId')).toBe(beforeActive);
    expect(localStorage.getItem(characterKey(CUSTOM_ID, 'wounds'))).toBe(beforeWounds);
    expect(localStorage.getItem(characterKey(CUSTOM_ID, 'xp'))).toBe(beforeXp);
    expect(localStorage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: `Switch to ${CUSTOM_NAME}` })).toBeTruthy();
  });
});
