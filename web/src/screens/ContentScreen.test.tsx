// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack, SkillDef, Spell, TalentDef } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { STORAGE_VERSION, STORAGE_VERSION_KEY } from '@/storage/storageSchema';
import { ContentScreen } from './ContentScreen';

const spell = (id: string, name: string, extra: Partial<Spell> = {}): Spell => ({
  id,
  name,
  lore: 'Arcane',
  cn: 0,
  range: 'Touch',
  target: '1',
  duration: 'Instant',
  description: 'A test spell.',
  ...extra,
});

const spells = [
  spell('spell.wom', 'WoM Spell', { sourceBook: 'Winds of Magic' }),
  spell('spell.bundled', 'Bundled Spell'),
  spell('spell.custom', 'Custom Spell', { sourceBook: 'Winds of Magic' }),
];

const skills: SkillDef[] = [{
  id: 'sk.augury',
  name: 'Augury',
  char: 'int',
  advanced: true,
  grouped: false,
  description: 'Interpret omens.',
  sourceBook: 'Winds of Magic',
  sourcePage: 44,
  rulesStatus: 'bibliographic',
}];

const talents: TalentDef[] = [{
  id: 'tal.magical-assistant',
  name: 'Magical Assistant',
  description: 'Assist a creator with magical work.',
  max: 1,
  sourceBook: 'Winds of Magic',
  sourcePage: 186,
  restriction: 'Power Familiar only',
  rulesStatus: 'bibliographic',
}];

const registry = new ContentRegistry([{
  $schema: 'grimcomp.content.v2',
  id: 'content-screen-test',
  name: 'Content screen test',
  version: '1',
  spells,
  skills,
  talents,
}] satisfies ContentPack[]);

afterEach(() => {
  cleanup();
  localStorage.clear();
  _resetStoredCache();
  document.body.style.overflow = '';
});

describe('ContentScreen spell sources', () => {
  it('distinguishes edited, sourcebook, and other bundled spells', () => {
    localStorage.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    localStorage.setItem('gc.content.userEdits', JSON.stringify({
      $schema: 'grimcomp.content.v2',
      id: 'user-edits',
      name: 'Your edits',
      version: '1',
      spells: [spells[2]],
    }));
    _resetStoredCache();

    render(
      <ContentContext.Provider value={registry}>
        <ContentScreen />
      </ContentContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Spells' }));

    expect(screen.getByText('WoM Spell').closest('.tbl-row')?.textContent).toContain('Winds of Magic');
    expect(screen.getByText('Bundled Spell').closest('.tbl-row')?.textContent).toContain('Bundled');
    expect(screen.getByText('Custom Spell').closest('.tbl-row')?.textContent).toContain('Custom');
    expect(screen.getByText('Custom Spell').closest('.tbl-row')?.textContent).not.toContain('Winds of Magic');

    fireEvent.click(screen.getByRole('button', { name: 'New spell' }));
    expect(screen.getByText(/"rulesStatus" \("bibliographic" or "approximate"\)/)).toBeTruthy();
  });

  it('shows skill provenance and skill metadata guidance', () => {
    render(
      <ContentContext.Provider value={registry}>
        <ContentScreen />
      </ContentContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));

    expect(screen.getByText('Augury').closest('.tbl-row')?.textContent).toContain('Winds of Magic');
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    expect(screen.getByText(/Optional skill fields/)).toBeTruthy();
    expect(screen.getByText(/"sourceBook"/)).toBeTruthy();
  });

  it('shows talent provenance and parameterized metadata guidance', () => {
    render(
      <ContentContext.Provider value={registry}>
        <ContentScreen />
      </ContentContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Talents' }));

    expect(screen.getByText('Magical Assistant').closest('.tbl-row')?.textContent)
      .toContain('Winds of Magic');
    fireEvent.click(screen.getByRole('button', { name: 'New talent' }));
    expect(screen.getByText(/Optional talent fields/)).toBeTruthy();
    expect(screen.getByText(/"specializations"/)).toBeTruthy();
    expect(screen.getByText(/"restriction"/)).toBeTruthy();
  });
});
