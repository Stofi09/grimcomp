// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { prepareStorageTest, cleanupStorageTest, waitForStorageIdle } from '@/test/storageTestUtils';
import { browserStorageCore } from '@/storage/browserStorage';
import { RollSheet } from './RollSheet';
import { AppBar } from './AppBar';
import { OverviewScreen } from '@/screens/OverviewScreen';
import { resolveTest } from '@/utils/roll';
import { readRollHistory } from '@/utils/rollHistory';
import { validatePortableStorageValue } from '@/utils/settingsDataValidation';
import { buildSettingsExport } from '@/utils/settingsExport';
import { validateNativeSettingsImport } from '../../../src/storage/nativeDataValidation';
import charactersPack from '../../public/content/core-characters.json';
import rulesPack from '../../public/content/core-rules.json';
import skillsPack from '../../public/content/core-skills.json';

const registry = new ContentRegistry([rulesPack, charactersPack, skillsPack] as unknown as ContentPack[]);
const wrap = (child: React.ReactNode) => <ContentContext.Provider value={registry}>{child}</ContentContext.Provider>;
const openSheet = () => render(wrap(<RollSheet visible onClose={() => {}} />));
const settle = async () => { await act(async () => { await waitForStorageIdle(); }); };
const choose = (value: string) => fireEvent.change(screen.getByLabelText('Skill or characteristic'), { target: { value } });

beforeEach(async () => {
  await prepareStorageTest();
  vi.spyOn(Math, 'random').mockReturnValue(0.26); // d100 = 27
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await cleanupStorageTest();
  document.body.style.overflow = '';
});

describe('shared roll flow', () => {
  it('requires a real target and uses the same picker from Overview and the toolbar', () => {
    const toolbar = render(wrap(<AppBar crumbs={['Overview']} />));
    fireEvent.click(screen.getByRole('button', { name: 'Roll', exact: true }));
    expect((screen.getByRole('button', { name: 'Roll d100' }) as HTMLButtonElement).disabled).toBe(true);
    const choices = screen.getByLabelText('Skill or characteristic').textContent;
    toolbar.unmount();
    render(wrap(<OverviewScreen />));
    fireEvent.click(screen.getByRole('button', { name: 'Roll Test' }));
    expect(screen.getByLabelText('Skill or characteristic').textContent).toBe(choices);
  });

  it('saves live advances, conditions, difficulty, and the rolled result exactly once, surviving a remount', async () => {
    localStorage.setItem('gc.c1.chars.adv', JSON.stringify({ ws: 20 }));
    localStorage.setItem('gc.c1.skills.adv', JSON.stringify({ 'Melee (Basic)': 15 }));
    localStorage.setItem('gc.c1.conditions', JSON.stringify({ Fatigued: 2 }));
    _resetStoredCache();
    const view = openSheet();
    choose('skill:Melee (Basic)');
    fireEvent.click(screen.getByRole('button', { name: '+10', exact: true }));
    const roll = screen.getByRole('button', { name: 'Roll d100' });
    fireEvent.click(roll);
    fireEvent.click(roll);
    expect(screen.queryByText('Saved to this character’s history.')).toBeNull();
    await settle();
    const entries = JSON.parse(localStorage.getItem('gc.c1.rollHistory')!);
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toMatchObject({ roll: 27, baseTarget: 68, modifier: -10, effectiveTarget: 58, sl: 3 });
    expect(entries[0].detail).toContain('Fatigued ×2: -20');
    const backup = JSON.parse(await buildSettingsExport('character', 'c1', 'Sigmund', {
      bundledContentPacks: [charactersPack as unknown as ContentPack],
    }));
    expect(backup['gc.c1.rollHistory']).toEqual(entries);
    expect(validateNativeSettingsImport(backup).ok).toBe(true);
    expect(screen.getByText('Saved to this character’s history.')).toBeTruthy();
    view.unmount();
    _resetStoredCache();
    render(wrap(<RollSheet visible initialMode="history" onClose={() => {}} />));
    expect(screen.getByText('Melee (Basic)', { exact: true })).toBeTruthy();
    expect(screen.getByText('27', { exact: true })).toBeTruthy();
  });

  it('resets the open picker and isolates history when the active character changes', async () => {
    openSheet();
    choose('char:ws');
    fireEvent.click(screen.getByRole('button', { name: 'Roll d100' }));
    await settle();
    localStorage.setItem('gc.activeCharId', JSON.stringify('c2'));
    act(() => { browserStorageCore.applyExternal('gc.activeCharId', JSON.stringify('c2')); });
    expect((screen.getByLabelText('Skill or characteristic') as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'History · 0' }));
    expect(screen.getByText('Your next roll starts the story.')).toBeTruthy();
    expect(localStorage.getItem('gc.c2.rollHistory')).toBeNull();
  });

  it('keeps a failed-save roll visible without claiming it was recorded', async () => {
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'gc.c1.rollHistory') throw new Error('disk full');
      realSet.call(this, key, value);
    });
    openSheet();
    choose('char:ws');
    fireEvent.click(screen.getByRole('button', { name: 'Roll d100' }));
    await settle();
    expect(screen.getByText('27', { exact: true })).toBeTruthy();
    expect(screen.getByText(/This roll could not be saved/)).toBeTruthy();
    expect(screen.queryByText('Saved to this character’s history.')).toBeNull();
    expect(localStorage.getItem('gc.c1.rollHistory')).toBeNull();
  });

  it('does not allow testing an advanced extra skill at zero advances', () => {
    localStorage.setItem('gc.c1.skills.extra', JSON.stringify([
      { name: 'Secret Lore', char: 'int', adv: 0, career: false, advanced: true },
    ]));
    _resetStoredCache();
    openSheet();
    const option = screen.getByRole('option', { name: 'Secret Lore · training required' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    choose('skill:Secret Lore');
    expect((screen.getByRole('button', { name: 'Roll d100' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bounds history to the latest 100 entries and validates portable data', async () => {
    const old = Array.from({ length: 100 }, (_, i) => ({
      id: `old-${i}`, at: 1, title: 'Old roll', dice: 'd100', detail: '',
      result: resolveTest({ target: 40, forceRoll: 20 }),
    }));
    localStorage.setItem('gc.c1.rollHistory', JSON.stringify(old));
    _resetStoredCache();
    openSheet();
    choose('char:ws');
    fireEvent.click(screen.getByRole('button', { name: 'Roll d100' }));
    await settle();
    const saved = JSON.parse(localStorage.getItem('gc.c1.rollHistory')!);
    expect(saved).toHaveLength(100);
    expect(saved[0].title).toBe('Weapon Skill');
    expect(saved[99].id).toBe('old-98');
    expect(() => validatePortableStorageValue('gc.c1.rollHistory', saved, 'Import')).not.toThrow();
    expect(() => validatePortableStorageValue('gc.c1.rollHistory', [{ ...saved[0], at: 1e20 }], 'Import')).toThrow();
    expect(readRollHistory([null, { result: {} }, ...saved])).toHaveLength(100);
  });
});
