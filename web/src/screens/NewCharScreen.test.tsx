// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import { closeCurrentAlert, getCurrentAlert } from '@/ui/alertStore';
import { rollStat } from '@/utils/creation';
import { NewCharScreen } from './NewCharScreen';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import creationPack from '../../public/content/core-creation.json';
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
  creationPack,
] as unknown as ContentPack[]);

function renderCreator(onNav = vi.fn(), content = registry) {
  render(
    <ContentContext.Provider value={content}>
      <NewCharScreen onNav={onNav} />
    </ContentContext.Provider>,
  );
  return onNav;
}

function drainAlerts(): void {
  while (getCurrentAlert() !== null) closeCurrentAlert();
}

function reachCareerStep(): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Marta Keller' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Step 2: Characteristics' }));
  fireEvent.click(screen.getByRole('button', { name: 'Roll stats' }));
  fireEvent.click(screen.getByRole('button', { name: 'Step 3: Career' }));
}

afterEach(() => {
  cleanup();
  drainAlerts();
  localStorage.clear();
  _resetStoredCache();
});

describe('NewCharScreen', () => {
  it('never produces a zero on a die when Math.random returns zero', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollStat(2, 10, 20)).toBe(22);
    random.mockRestore();
  });

  it('keeps future wizard steps locked until their prerequisites are complete', () => {
    renderCreator();

    const characteristicsStep = screen.getByRole('button', { name: 'Step 2: Characteristics' });
    const careerStep = screen.getByRole('button', { name: 'Step 3: Career' });
    const reviewStep = screen.getByRole('button', { name: 'Step 4: Review' });
    expect(characteristicsStep.hasAttribute('disabled')).toBe(true);
    expect(careerStep.hasAttribute('disabled')).toBe(true);
    expect(reviewStep.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Marta Keller' },
    });
    expect(characteristicsStep.hasAttribute('disabled')).toBe(false);
    expect(careerStep.hasAttribute('disabled')).toBe(true);

    fireEvent.click(characteristicsStep);
    fireEvent.click(screen.getByRole('button', { name: 'Roll stats' }));
    expect(careerStep.hasAttribute('disabled')).toBe(false);
    expect(reviewStep.hasAttribute('disabled')).toBe(true);
  });

  it('navigates immediately when Finish & switch creates a character', () => {
    const onNav = renderCreator();

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Marta Keller' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Step 2: Characteristics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll stats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step 3: Career' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roadwarden · APPROX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish & switch' }));

    expect(onNav).toHaveBeenCalledWith('overview');
    expect(getCurrentAlert()?.title).toBe('Character created');
    expect(getCurrentAlert()?.buttons?.[0]?.text).toBe('Done');
  });

  it('locks rewarded species and career rolls after the first result', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderCreator();

    const speciesRoll = screen.getByRole('button', { name: 'Roll once (+20 XP)' });
    fireEvent.click(speciesRoll);
    expect(screen.getByRole('button', { name: 'First species roll used' }).hasAttribute('disabled')).toBe(true);

    reachCareerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Roll & accept · +50 XP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll one career' }));

    expect(screen.getByRole('button', { name: 'First career roll accepted' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Roll 3, pick one · +25 XP' }).hasAttribute('disabled')).toBe(true);
    random.mockRestore();
  });

  it('hides reference-only careers and keeps manual-only careers out of random rolls', () => {
    const restrictedCareers = JSON.parse(JSON.stringify(careersPack)) as ContentPack;
    for (const career of restrictedCareers.careers ?? []) {
      career.creationAvailable = false;
      career.randomEligible = false;
    }
    const manualOnly = restrictedCareers.careers?.find(career => career.id === 'car.roadwarden');
    const randomCareer = restrictedCareers.careers?.find(career => career.id === 'car.wizard');
    if (!manualOnly || !randomCareer) throw new Error('Career test fixtures are missing');
    manualOnly.creationAvailable = true;
    manualOnly.randomEligible = false;
    randomCareer.creationAvailable = true;
    randomCareer.randomEligible = true;

    const restrictedRegistry = new ContentRegistry([
      rulesPack,
      racesPack,
      restrictedCareers,
      skillsPack,
      talentsPack,
      charactersPack,
      creationPack,
    ] as unknown as ContentPack[]);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    renderCreator(vi.fn(), restrictedRegistry);
    reachCareerStep();

    expect(screen.getByText(/2 careers open to Human\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Apothecary/ })).toBeNull();
    const manualButton = screen.getByRole('button', { name: /^Roadwarden/ });
    fireEvent.click(manualButton);
    expect(manualButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Roll & accept · +50 XP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll one career' }));

    expect(screen.getByText('Wizard')).toBeTruthy();
    expect(screen.queryByText('Roadwarden')).toBeNull();
    random.mockRestore();
  });

  it('shows the total after species modifiers', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderCreator();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Bardin Stone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dwarf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step 2: Characteristics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll stats' }));

    expect(screen.getByText('250')).toBeTruthy();
    random.mockRestore();
  });

  it('creates a rank-one character with legal free advances and no experienced demo kit', () => {
    renderCreator();
    reachCareerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Roadwarden · APPROX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish & switch' }));

    const custom = JSON.parse(localStorage.getItem('gc.customChars') ?? '{}');
    const created = Object.values(custom)[0] as {
      characteristics: Array<{ adv: number }>;
      skills: Array<{ adv: number; career: boolean }>;
      talents: Array<{ career: boolean }>;
      weapons: Array<{ name: string }>;
      armour: unknown[];
      careerId?: string;
      careerLevel: number;
    };
    expect(created.careerId).toBe('car.roadwarden');
    expect(created.careerLevel).toBe(1);
    expect(created.characteristics.reduce((sum, c) => sum + c.adv, 0)).toBe(5);
    expect(created.skills.filter(s => s.career)).toHaveLength(8);
    expect(created.skills.filter(s => s.career).reduce((sum, s) => sum + s.adv, 0)).toBe(40);
    expect(created.talents.filter(t => t.career)).toHaveLength(1);
    expect(created.weapons.map(w => w.name)).toEqual(['Hand Weapon']);
    expect(created.armour).toEqual([]);
  });

  it('never grants an unspecialised parameterised Talent during creation', () => {
    const careersWithGroupedTalent = JSON.parse(JSON.stringify(careersPack)) as ContentPack;
    const roadwarden = careersWithGroupedTalent.careers?.find(career => career.id === 'car.roadwarden');
    if (!roadwarden) throw new Error('Roadwarden test fixture is missing');
    roadwarden.advanceScheme = {
      ...roadwarden.advanceScheme,
      talents: ['Suffuse with (Wind)', 'Acute Sense'],
    };
    const groupedTalentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'test-grouped-talent',
      name: 'Test grouped talent',
      version: '1',
      talents: [{
        id: 'tal.suffuse-with-wind',
        name: 'Suffuse with (Wind)',
        description: 'Choose a Wind.',
        max: 1,
        specializations: ['Aqshy', 'Azyr'],
      }],
    } as ContentPack;
    const groupedRegistry = new ContentRegistry([
      rulesPack,
      racesPack,
      careersWithGroupedTalent,
      skillsPack,
      talentsPack,
      groupedTalentPack,
      charactersPack,
      creationPack,
    ] as unknown as ContentPack[]);

    renderCreator(vi.fn(), groupedRegistry);
    reachCareerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Roadwarden · APPROX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish & switch' }));

    const custom = JSON.parse(localStorage.getItem('gc.customChars') ?? '{}');
    const created = Object.values(custom)[0] as {
      talents: Array<{ definitionId?: string; name: string; specialization?: string }>;
    };
    expect(created.talents).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionId: 'tal.acute-sense', name: 'Acute Sense' }),
    ]));
    expect(created.talents.some(talent => talent.name.includes('Suffuse with'))).toBe(false);
  });
});
