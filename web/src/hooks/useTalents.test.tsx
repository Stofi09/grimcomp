// @vitest-environment jsdom

import { StrictMode, act, useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { characterKey } from './useCharacter';
import { useStoredState, _resetStoredCache } from './useStoredState';
import { useTalents } from './useTalents';
import { talentIdentityKey, talentTimesEqual } from '@/utils/talents';
import {
  cleanupStorageTest,
  prepareStorageTest,
  waitForStorageIdle,
} from '@/test/storageTestUtils';
import rulesPack from '../../public/content/core-rules.json';
import racesPack from '../../public/content/core-races.json';
import careersPack from '../../public/content/core-careers.json';
import talentsPack from '../../public/content/core-talents.json';
import charactersPack from '../../public/content/core-characters.json';

const basePacks = [
  rulesPack,
  racesPack,
  careersPack,
  talentsPack,
  charactersPack,
] as unknown as ContentPack[];

const sourceCharacter = (
  charactersPack as unknown as { characters: Array<Record<string, unknown>> }
).characters[0];

function registryWithTalents(
  id: string,
  talents: Array<Record<string, unknown>>,
): ContentRegistry {
  const pack = {
    $schema: 'grimcomp.content.v2',
    id: `test-characters-${id}`,
    name: 'Test characters',
    version: '1',
    characters: [{ ...sourceCharacter, id, name: 'Imported Hero', talents }],
  } as unknown as ContentPack;
  return new ContentRegistry([...basePacks, pack]);
}

function Probe() {
  const { list } = useTalents();
  return (
    <output data-testid="talents">
      {list.map(talent => `${talent.name}=${talent.times}`).join(',')}
    </output>
  );
}

function renderProbe(registry: ContentRegistry) {
  return render(
    <StrictMode>
      <ContentContext.Provider value={registry}>
        <Probe />
      </ContentContext.Provider>
    </StrictMode>,
  );
}

function LayoutUpdateProbe({ id, rank }: { id: string; rank: number }) {
  const { list } = useTalents();
  const [, setStoredTimes] = useStoredState<unknown>(characterKey(id, 'talents.times'), {});
  const [, setApplied] = useState(false);
  const hardyKey = talentIdentityKey({ name: 'Hardy', definitionId: 'tal.hardy' });

  // Layout effects run before useTalents' passive migration effect. This models
  // a newer same-key update landing after render but before migration persists.
  useLayoutEffect(() => {
    const latest = { [hardyKey]: rank };
    setStoredTimes((previous: unknown) => (
      talentTimesEqual(previous, latest) ? previous : latest
    ));
    setApplied(true);
  }, [hardyKey, rank, setStoredTimes]);

  return (
    <output data-testid="talents">
      {list.map(talent => `${talent.name}=${talent.times}`).join(',')}
    </output>
  );
}

async function settleStorage(): Promise<void> {
  await act(async () => { await waitForStorageIdle(); });
}

beforeEach(async () => prepareStorageTest());

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await cleanupStorageTest();
});

describe('useTalents rank convergence', () => {
  it('repairs malformed template ranks and a legacy name key in one bounded write', async () => {
    const id = 'malformed-talents';
    const storageKey = characterKey(id, 'talents.times');
    localStorage.setItem('gc.activeCharId', JSON.stringify(id));
    localStorage.setItem(storageKey, JSON.stringify({
      Hardy: 3,
      Corrupt: null,
      Fractional: 1.5,
    }));
    _resetStoredCache();

    const registry = registryWithTalents(id, [{
      name: 'Hardy',
      definitionId: 'tal.hardy',
      desc: 'Malformed import omitted times.',
      career: true,
    }, {
      name: 'Savvy',
      definitionId: 'tal.savvy',
      times: 2.5,
      desc: 'Malformed import supplied a fractional rank.',
      career: false,
    }]);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const view = renderProbe(registry);
    await settleStorage();

    expect(screen.getByTestId('talents').textContent).toBe('Hardy=3,Savvy=1');
    const stored = localStorage.getItem(storageKey);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('null');
    expect(JSON.parse(stored ?? '{}')).toEqual({
      [talentIdentityKey({ name: 'Hardy', definitionId: 'tal.hardy' })]: 3,
      [talentIdentityKey({ name: 'Savvy', definitionId: 'tal.savvy' })]: 1,
    });
    expect(setItem.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(1);

    view.rerender(
      <StrictMode>
        <ContentContext.Provider value={registry}>
          <Probe />
        </ContentContext.Provider>
      </StrictMode>,
    );
    await settleStorage();
    expect(setItem.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(1);
  });

  it('does not persist an already-canonical rank map', () => {
    const id = 'canonical-talents';
    const storageKey = characterKey(id, 'talents.times');
    const canonical = {
      [talentIdentityKey({ name: 'Hardy', definitionId: 'tal.hardy' })]: 2,
    };
    localStorage.setItem('gc.activeCharId', JSON.stringify(id));
    localStorage.setItem(storageKey, JSON.stringify(canonical));
    _resetStoredCache();

    const registry = registryWithTalents(id, [{
      name: 'Hardy',
      definitionId: 'tal.hardy',
      times: 2,
      desc: 'Valid canonical template talent.',
      career: true,
    }]);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    renderProbe(registry);

    expect(screen.getByTestId('talents').textContent).toBe('Hardy=2');
    expect(setItem.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(0);
  });

  it('preserves a newer same-key layout update over the pending passive migration', async () => {
    const id = 'layout-update-talents';
    const storageKey = characterKey(id, 'talents.times');
    const hardyKey = talentIdentityKey({ name: 'Hardy', definitionId: 'tal.hardy' });
    localStorage.setItem('gc.activeCharId', JSON.stringify(id));
    localStorage.setItem(storageKey, JSON.stringify({ Hardy: 3 }));
    _resetStoredCache();

    const registry = registryWithTalents(id, [{
      name: 'Hardy',
      definitionId: 'tal.hardy',
      times: 1,
      desc: 'A valid template talent.',
      career: true,
    }]);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <StrictMode>
        <ContentContext.Provider value={registry}>
          <LayoutUpdateProbe id={id} rank={4} />
        </ContentContext.Provider>
      </StrictMode>,
    );
    await settleStorage();

    expect(screen.getByTestId('talents').textContent).toBe('Hardy=4');
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual({ [hardyKey]: 4 });
    expect(setItem.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(1);
  });
});
