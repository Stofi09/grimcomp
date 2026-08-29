// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { characterKey } from './useCharacter';
import { useTalents } from './useTalents';
import { _resetStoredCache } from './useStoredState';
import rulesPack from '../../public/content/core-rules.json';
import racesPack from '../../public/content/core-races.json';
import talentsPack from '../../public/content/core-talents.json';
import charactersPack from '../../public/content/core-characters.json';

const basePacks = [rulesPack, racesPack, talentsPack, charactersPack] as unknown as ContentPack[];

function Harness({ registry }: { registry: ContentRegistry }) {
  const { list } = useTalents();
  return (
    <ContentContext.Provider value={registry}>
      <output data-testid="n">{list.length}</output>
    </ContentContext.Provider>
  );
}

function Probe() {
  const { list } = useTalents();
  return <output data-testid="n">{list.map(t => `${t.name}=${t.times}`).join(',')}</output>;
}

afterEach(() => { cleanup(); localStorage.clear(); _resetStoredCache(); vi.restoreAllMocks(); });

describe('scratch', () => {
  it('converges for a clean template', () => {
    localStorage.setItem('gc.activeCharId', JSON.stringify('c1'));
    _resetStoredCache();
    const registry = new ContentRegistry(basePacks);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    render(<ContentContext.Provider value={registry}><Probe /></ContentContext.Provider>);
    const writes = spy.mock.calls.filter(c => String(c[0]).includes('talents'));
    console.log('CLEAN writes:', writes.length, JSON.stringify(writes).slice(0, 600));
  });

  it('malformed template talent times (imported pack) — does it loop?', () => {
    const badChars = {
      id: 'pack.badchars',
      characters: [{
        ...(charactersPack as any).characters[0],
        id: 'cbad',
        talents: [{ name: 'Hardy' }, { name: 'Savvy', times: 2.5 }],
      }],
    };
    localStorage.setItem('gc.activeCharId', JSON.stringify('cbad'));
    _resetStoredCache();
    const registry = new ContentRegistry([...basePacks, badChars] as unknown as ContentPack[]);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    let err: unknown;
    try {
      render(<ContentContext.Provider value={registry}><Probe /></ContentContext.Provider>);
    } catch (e) { err = e; }
    const writes = spy.mock.calls.filter(c => String(c[0]).includes('talents.times'));
    console.log('BAD writes:', writes.length, 'err:', (err as Error)?.message?.slice(0, 120));
    console.log('last stored:', localStorage.getItem(characterKey('cbad', 'talents.times')));
  });
});
