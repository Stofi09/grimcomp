// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import { SkillsScreen } from './SkillsScreen';
import { TalentsScreen } from './TalentsScreen';
import { CareerScreen } from './CareerScreen';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
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
  charactersPack,
] as unknown as ContentPack[]);

function renderScreen(node: React.ReactNode) {
  render(<ContentContext.Provider value={registry}>{node}</ContentContext.Provider>);
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
  await cleanupStorageTest();
});

describe('progression add and discovery actions', () => {
  it('filters skills and persists a custom skill instead of showing a placeholder alert', async () => {
    renderScreen(<SkillsScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter skills' }), {
      target: { value: 'no-such-skill' },
    });
    expect(screen.getByText('No skills match “no-such-skill”.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Lore (Testing)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Career cost' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settleStorage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter skills' }), {
      target: { value: 'Lore (Testing)' },
    });
    expect(screen.getByText('Lore (Testing)')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('gc.c1.skills.extra') ?? '[]')).toEqual([
      expect.objectContaining({ name: 'Lore (Testing)', career: true, adv: 0 }),
    ]);
  });

  it('buys a first talent rank through the talent picker', async () => {
    renderScreen(<TalentsScreen />);

    const newTalent = screen.getByRole('button', {
      name: /New talent \d+ career options, \d+ total available/,
    });
    fireEvent.click(newTalent);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search talents' }), {
      target: { value: 'Acute Sense' },
    });
    const result = screen.getAllByRole('option')[0];
    expect(result).toBeTruthy();
    fireEvent.click(result);
    fireEvent.click(screen.getByRole('button', { name: 'Buy · 100 XP' }));
    await settleStorage();

    expect(getCurrentAlert()?.title).toBe('Bought talent');
    expect(JSON.parse(localStorage.getItem('gc.c1.talents.added') ?? '[]')).toEqual([
      { definitionId: 'tal.acute-sense', name: 'Acute Sense' },
    ]);
  });

  it('uses modelled fallback requirements for a formerly incomplete higher rank', async () => {
    localStorage.setItem('gc.c1.skills.adv', JSON.stringify({
      'Melee (Basic)': 10,
      'Ranged (Bow)': 10,
      'Ride (Horse)': 15,
    }));
    renderScreen(<CareerScreen />);

    expect(screen.getByText('3/3 skills ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Advance to rank 3' }));
    await settleStorage();

    expect(getCurrentAlert()?.title).toBe('Advanced!');
  });
});
