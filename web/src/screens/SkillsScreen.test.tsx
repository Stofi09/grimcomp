// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import skillsPack from '../../public/content/core-skills.json';
import { SkillsScreen } from './SkillsScreen';

const supplementSkills = {
  id: 'test-winds-skills',
  name: 'Test Winds skills',
  version: '1',
  skills: [
    {
      id: 'sk.augury',
      name: 'Augury',
      char: 'int',
      advanced: true,
      grouped: false,
      description: 'Interpret omens to glimpse likely future events.',
      sourceBook: 'Winds of Magic',
      sourcePage: 44,
      rulesStatus: 'bibliographic',
      rulesNote: 'Use the complete omen procedure in the book.',
      restriction: 'Humans and Elves only.',
      exclusiveWith: ['sk.psychometry'],
    },
    {
      id: 'sk.psychometry',
      name: 'Psychometry',
      char: 'int',
      advanced: true,
      grouped: false,
      description: 'Read lingering impressions from a person, object, or place.',
      sourceBook: 'Winds of Magic',
      sourcePage: 47,
      rulesStatus: 'bibliographic',
      restriction: 'Humans only.',
    },
  ],
};

const basePacks = [
  rulesPack,
  racesPack,
  careersPack,
  skillsPack,
  charactersPack,
  supplementSkills,
] as unknown as ContentPack[];

const registry = new ContentRegistry(basePacks);

function renderScreen(content: ContentRegistry = registry): void {
  render(
    <ContentContext.Provider value={content}>
      <SkillsScreen />
    </ContentContext.Provider>,
  );
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

describe('loaded skill acquisition', () => {
  it('uses a character careerId when the loaded Career display name changes', () => {
    const renamedCareerRegistry = new ContentRegistry([
      ...basePacks,
      {
        $schema: 'grimcomp.content.v2',
        id: 'test-renamed-career',
        name: 'Test renamed Career',
        version: '1',
        careers: [{
          id: 'car.roadwarden',
          name: 'Road Guardian',
          class: 'Ranger',
          species: ['race.human'],
          ranks: [{ level: 1, name: 'Road Guardian', status: 'Silver 1' }],
          advanceScheme: {
            characteristics: ['bs'],
            skills: ['Augury'],
            talents: [],
          },
        }],
      },
    ]);

    renderScreen(renamedCareerRegistry);

    expect(screen.getByRole('button', { name: 'Test Augury' })).toBeTruthy();
  });

  it('selects a canonical advanced skill, shows provenance, and cites its manual procedure on rolls', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.09);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Loaded definition' }));

    expect(screen.getByRole('option', { name: /Psychometry/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Humans and Elves' },
    });
    expect(screen.getByRole('option', { name: /Augury/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Trade' },
    });
    expect(screen.queryByRole('option', { name: /^Trade\b/ })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Augury' },
    });
    const augury = screen.getByRole('option', { name: /Augury/ });
    expect(augury.textContent).toContain('Int · Advanced');
    expect(augury.textContent).toContain('Source: Winds of Magic · p. 44');
    expect(augury.textContent).toContain('Index only — resolve its special procedure from the source');
    expect(augury.textContent).toContain('Restriction: Humans and Elves only.');
    expect(augury.textContent).toContain('Rules note: Use the complete omen procedure in the book.');

    fireEvent.click(augury);
    const selected = screen.getByLabelText('Selected loaded skill');
    expect(selected.textContent).toContain('Augury');
    expect(selected.textContent).toContain('Int · Advanced');
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Non-career (×2)' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Career cost' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.skills.extra') ?? '[]')).toEqual([
      {
        name: 'Augury',
        char: 'int',
        adv: 0,
        career: true,
        advanced: true,
        definitionId: 'sk.augury',
      },
    ]);
    expect(screen.getByText('Winds of Magic · p. 44 · Index only')).toBeTruthy();
    expect(screen.getByText('Restriction: Humans and Elves only.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Test Augury' }));
    expect(getCurrentAlert()?.title).toBe('Train advanced skill first');
    expect(getCurrentAlert()?.message).toContain('cannot be tested at +0');
    closeCurrentAlert();

    fireEvent.click(screen.getByRole('button', { name: 'Increase Augury' }));
    await settleStorage();
    fireEvent.click(screen.getByRole('button', { name: 'Test Augury' }));
    expect(getCurrentAlert()?.title).toMatch(/^Augury — /);
    expect(getCurrentAlert()?.message)
      .toContain('Rules status: Index only — resolve its special procedure from the source');
    expect(getCurrentAlert()?.message).toContain('Restriction: Humans and Elves only.');
    expect(getCurrentAlert()?.message).toContain('Rules note: Use the complete omen procedure in the book.');
    expect(getCurrentAlert()?.message).toContain('Source: Winds of Magic · p. 44');
  });

  it('blocks a loaded skill when the selected definition excludes an owned definition', () => {
    const owned = [{
      name: 'Psychometry',
      char: 'int',
      adv: 0,
      career: false,
      advanced: true,
      definitionId: 'sk.psychometry',
    }];
    localStorage.setItem('gc.c1.skills.extra', JSON.stringify(owned));
    _resetStoredCache();
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Loaded definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Augury' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Augury/ }));

    expect(screen.getByRole('alert').textContent).toContain('Cannot add while Psychometry is owned.');
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(JSON.parse(localStorage.getItem('gc.c1.skills.extra') ?? '[]')).toEqual(owned);
  });

  it('blocks a loaded skill when an owned definition excludes the selected definition', () => {
    const owned = [{
      name: 'Augury',
      char: 'int',
      adv: 0,
      career: false,
      advanced: true,
      definitionId: 'sk.augury',
    }];
    localStorage.setItem('gc.c1.skills.extra', JSON.stringify(owned));
    _resetStoredCache();
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Loaded definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Psychometry' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Psychometry/ }));

    expect(screen.getByRole('alert').textContent).toContain('Cannot add while Augury is owned.');
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(JSON.parse(localStorage.getItem('gc.c1.skills.extra') ?? '[]')).toEqual(owned);
  });

  it('keeps the custom grouped workflow and sanitizes a malformed extra-skills overlay on write', async () => {
    localStorage.setItem('gc.c1.skills.extra', JSON.stringify([
      null,
      'bad record',
      { name: '', char: 'int', adv: 0, career: false },
      { name: 'Bad definition id', char: 'int', adv: 0, career: false, definitionId: 42 },
      { name: 'Existing custom', char: 'int', adv: 0, career: false, advanced: false },
    ]));
    _resetStoredCache();
    renderScreen();

    expect(screen.getByText('Existing custom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    expect(screen.getByRole('button', { name: 'Custom skill' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Trade (Alchemist)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settleStorage();

    expect(JSON.parse(localStorage.getItem('gc.c1.skills.extra') ?? '[]')).toEqual([
      expect.objectContaining({ name: 'Existing custom', char: 'int', advanced: false }),
      expect.objectContaining({
        name: 'Trade (Alchemist)',
        char: 'dex',
        adv: 0,
        career: false,
        advanced: true,
      }),
    ]);
  });

  it('resolves loaded metadata by stable definition id before the legacy display name', () => {
    localStorage.setItem('gc.c1.skills.extra', JSON.stringify([
      {
        name: 'Legacy omen reading',
        char: 'int',
        adv: 5,
        career: false,
        advanced: true,
        definitionId: 'sk.augury',
      },
    ]));
    _resetStoredCache();
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Test Legacy omen reading' }));
    expect(getCurrentAlert()?.message)
      .toContain('Rules status: Index only — resolve its special procedure from the source');
    expect(getCurrentAlert()?.message).toContain('Source: Winds of Magic · p. 44');
    closeCurrentAlert();

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Loaded definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded skills' }), {
      target: { value: 'Augury' },
    });
    expect(screen.queryByRole('option', { name: /Augury/ })).toBeNull();
  });
});
