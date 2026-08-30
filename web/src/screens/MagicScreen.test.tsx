// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack, Spell } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { MagicScreen } from './MagicScreen';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import magicPack from '../../public/content/core-magic.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import skillsPack from '../../public/content/core-skills.json';
import talentsPack from '../../public/content/core-talents.json';

const basePacks = [
  rulesPack,
  racesPack,
  careersPack,
  skillsPack,
  talentsPack,
  magicPack,
  charactersPack,
] as unknown as ContentPack[];

const registry = new ContentRegistry(basePacks);

function renderMagic(content = registry): void {
  render(
    <ContentContext.Provider value={content}>
      <MagicScreen />
    </ContentContext.Provider>,
  );
}

function selectCaster(): void {
  localStorage.setItem('gc.activeCharId', JSON.stringify('c2'));
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
  document.body.style.overflow = '';
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('MagicScreen spellbook', () => {
  it('does not enumerate the full spell registry until the manager opens', () => {
    selectCaster();
    const allSpells = vi.spyOn(registry, 'allSpells', 'get');
    renderMagic();

    expect(allSpells).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manage spellbook' }));
    expect(allSpells).toHaveBeenCalled();
  });

  it('discloses that Winds of Magic casting procedure is not automated', () => {
    selectCaster();
    const windsPack: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'winds-of-magic',
      name: 'Winds of Magic',
      version: 'test',
    };

    renderMagic(new ContentRegistry([...basePacks, windsPack]));

    expect(screen.getByRole('note').textContent).toContain('Automation uses the Core Rulebook casting procedure');
    expect(screen.getByRole('note').textContent).toContain('Resolve Winds of Magic’s revised Channelling and Overcasting');
  });

  it('does not cast a CN 0 spell when the casting test fails despite a large pool', async () => {
    selectCaster();
    localStorage.setItem('gc.c2.magic.pool', JSON.stringify(10));
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // d100 → 91: ordinary failure
    const dart = (magicPack.spells as unknown as Spell[]).find(spell => spell.id === 'sp.petty.dart')!;
    const zeroCnPack: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'zero-cn-test',
      name: 'Zero CN test',
      version: '1',
      spells: [{ ...dart, cn: 0 }],
    };

    renderMagic(new ContentRegistry([...basePacks, zeroCnPack]));
    fireEvent.click(screen.getByRole('button', { name: 'Cast Dart' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(getCurrentAlert()?.title).toBe('Dart — FIZZLE');
    expect(getCurrentAlert()?.message).toContain('Channelling pool used: +10');
    expect(getCurrentAlert()?.message).toContain('Casting test failed — spell fizzles');
  });

  it('persists additions and removals as a character overlay and casts from the effective list', async () => {
    selectCaster();
    const templateIds = [...(registry.getCharacterTemplate('c2')?.knownSpells ?? [])];
    renderMagic();

    expect(screen.getByRole('button', { name: 'Cast Dart' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage spellbook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search spells' }), {
      target: { value: 'Aethyric Armour' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Aethyric Armour to spellbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settleStorage();

    expect(screen.getByRole('button', { name: 'Cast Aethyric Armour' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('gc.c2.magic.spellbook') ?? '{}')).toEqual({
      added: ['sp.arcane.aethyric-armour'],
      removed: [],
    });

    cleanup();
    _resetStoredCache();
    renderMagic();
    expect(screen.getByRole('button', { name: 'Cast Aethyric Armour' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Manage spellbook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search spells' }), {
      target: { value: 'Dart' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dart from spellbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settleStorage();

    expect(screen.queryByRole('button', { name: 'Cast Dart' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('gc.c2.magic.spellbook') ?? '{}')).toEqual({
      added: ['sp.arcane.aethyric-armour'],
      removed: ['sp.petty.dart'],
    });
    expect(registry.getCharacterTemplate('c2')?.knownSpells).toEqual(templateIds);
  });

  it('filters the registry by lore and discards an unsaved draft', () => {
    selectCaster();
    renderMagic();

    fireEvent.click(screen.getByRole('button', { name: 'Manage spellbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arcane' }));
    expect(screen.queryByRole('button', { name: 'Add Animal Friend to spellbook' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search spells' }), {
      target: { value: 'Bolt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Bolt to spellbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(localStorage.getItem('gc.c2.magic.spellbook')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cast Bolt' })).toBeNull();
  });

  it('normalizes malformed imported spellbook data without dropping stale ids', async () => {
    selectCaster();
    localStorage.setItem('gc.c2.magic.spellbook', JSON.stringify({
      added: ['sp.arcane.bolt', 17, 'sp.arcane.bolt', 'sp.unavailable.from-disabled-pack'],
      removed: null,
    }));
    _resetStoredCache();
    renderMagic();

    expect(screen.getByRole('button', { name: 'Cast Bolt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage spellbook' }));
    expect(screen.getByRole('dialog', { name: 'Manage spellbook' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c2.magic.spellbook') ?? '{}')).toEqual({
      added: ['sp.arcane.bolt', 'sp.unavailable.from-disabled-pack'],
      removed: [],
    });
  });

  it('shows source metadata and rules notes in the spell list and cast result', async () => {
    selectCaster();
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const dart = (magicPack.spells as unknown as Spell[]).find(spell => spell.id === 'sp.petty.dart')!;
    const metadataPack: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'spell-metadata-test',
      name: 'Spell metadata test',
      version: '1',
      spells: [{
        ...dart,
        sourceBook: 'Winds of Magic',
        sourcePage: 42,
        rulesStatus: 'approximate',
        rulesNote: 'Use the revised spell text.',
      }],
    };
    renderMagic(new ContentRegistry([...basePacks, metadataPack]));

    expect(screen.getByText('Winds of Magic · p. 42')).toBeTruthy();
    expect(screen.getByText('Approximate companion summary — verify in source')).toBeTruthy();
    expect(screen.getByText('Rules note: Use the revised spell text.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cast Dart' }));
    await settleStorage();
    expect(getCurrentAlert()?.message).toContain('Rules note: Use the revised spell text.');
    expect(getCurrentAlert()?.message).toContain('Rules status: Approximate companion summary — verify in source');
    expect(getCurrentAlert()?.message).toContain('Source: Winds of Magic · p. 42');
  });

  it('treats a bibliographic spell as a source lookup after reaching its threshold', async () => {
    selectCaster();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const dart = (magicPack.spells as unknown as Spell[]).find(spell => spell.id === 'sp.petty.dart')!;
    const placeholder = 'See Winds of Magic for the complete spell rules.';
    const metadataPack: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'bibliographic-spell-test',
      name: 'Bibliographic spell test',
      version: '1',
      spells: [{
        ...dart,
        description: placeholder,
        sourceBook: 'Winds of Magic',
        sourcePage: 42,
        rulesStatus: 'bibliographic',
      }],
    };
    renderMagic(new ContentRegistry([...basePacks, metadataPack]));

    expect(screen.getByText('Index only — resolve from source')).toBeTruthy();
    expect(screen.queryByText(placeholder)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cast Dart' }));
    await settleStorage();
    expect(getCurrentAlert()?.title).toBe('Dart — THRESHOLD');
    expect(getCurrentAlert()?.message)
      .toContain('Casting threshold reached — resolve Dart from its source.');
    expect(getCurrentAlert()?.message).not.toContain('Dart resolves!');
    expect(getCurrentAlert()?.message).not.toContain(placeholder);

    closeCurrentAlert();
    random.mockReturnValue(0.1); // d100 → 11: successful double and Minor Miscast
    fireEvent.click(screen.getByRole('button', { name: 'Cast Dart' }));
    await settleStorage();
    expect(getCurrentAlert()?.title).toBe('Dart — THRESHOLD · MISCAST');
    expect(getCurrentAlert()?.message)
      .toContain('Casting threshold reached — resolve Dart from its source.');
    expect(getCurrentAlert()?.message).not.toContain('the spell still resolves');
  });

  it('rolls the pool back and withholds the cast result when persistence fails', async () => {
    selectCaster();
    localStorage.setItem('gc.c2.magic.pool', JSON.stringify(10));
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const realSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (!injected && key === 'gc.c2.magic.pool' && value === '0') {
        injected = true;
        throw new Error('injected pool write failure');
      }
      realSetItem.call(this, key, value);
    });
    renderMagic();

    const cast = screen.getByRole('button', { name: 'Cast Dart' });
    fireEvent.click(cast);
    fireEvent.click(cast);
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(injected).toBe(true);
    expect(JSON.parse(localStorage.getItem('gc.c2.magic.pool') ?? 'null')).toBe(10);
    expect(getCurrentAlert()?.title).toBe('Could not cast spell');
    expect(getCurrentAlert()?.message).toContain('pool could not be saved');
  });

  it('rolls Channelling back and ignores a duplicate action when persistence fails', async () => {
    selectCaster();
    vi.spyOn(Math, 'random').mockReturnValue(0.2); // d100 → 21: ordinary success
    const realSetItem = Storage.prototype.setItem;
    let poolWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === 'gc.c2.magic.pool') {
        poolWrites += 1;
        if (poolWrites === 1) throw new Error('injected Channelling pool failure');
      }
      realSetItem.call(this, key, value);
    });
    renderMagic();

    const channel = screen.getByRole('button', { name: 'Channel' });
    fireEvent.click(channel);
    fireEvent.click(channel);
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(poolWrites).toBe(1);
    expect(localStorage.getItem('gc.c2.magic.pool')).toBeNull();
    expect(getCurrentAlert()?.title).toBe('Could not save Channelling');
  });

  it('durably banks SL from a successful Channelling Minor Miscast', async () => {
    selectCaster();
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // d100 → 11: successful double
    renderMagic();

    fireEvent.click(screen.getByRole('button', { name: 'Channel' }));
    expect(getCurrentAlert()).toBeNull();
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c2.magic.pool') ?? '0')).toBeGreaterThan(0);
    expect(getCurrentAlert()?.title).toBe('Channelling — Minor Miscast');
    expect(getCurrentAlert()?.message).toContain('Pool still gained');
  });
});
