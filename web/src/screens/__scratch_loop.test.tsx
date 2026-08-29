// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ContentContext } from '@/content/contentContext';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { _resetStoredCache } from '@/hooks/useStoredState';
import careersPack from '../../public/content/core-careers.json';
import charactersPack from '../../public/content/core-characters.json';
import racesPack from '../../public/content/core-races.json';
import rulesPack from '../../public/content/core-rules.json';
import talentsPack from '../../public/content/core-talents.json';
import { TalentsScreen } from '@/screens/TalentsScreen';

const basePacks = [rulesPack, racesPack, careersPack, talentsPack, charactersPack] as unknown as ContentPack[];
const src = (charactersPack as unknown as { characters: Record<string, unknown>[] }).characters[0];
const badPack = {
  $schema: 'grimcomp.content.v2', id: 'friend-pack', name: 'Friend pack', version: '1',
  characters: [{ ...src, id: 'cx', name: 'Imported Hero',
    talents: [{ name: 'Hardy', definitionId: 'tal.hardy', desc: 'x', career: true }] }],
} as unknown as ContentPack;

afterEach(() => { cleanup(); localStorage.clear(); _resetStoredCache(); });

describe('loop', () => {
  it('renders', { timeout: 8000 }, () => {
    localStorage.setItem('gc.activeCharId', JSON.stringify('cx'));
    _resetStoredCache();
    let writes = 0;
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'gc.cx.talents.times') writes += 1;
      return realSet.call(this, k, v);
    };
    try {
      render(<ContentContext.Provider value={new ContentRegistry([...basePacks, badPack])}><TalentsScreen /></ContentContext.Provider>);
    } finally { Storage.prototype.setItem = realSet; }
    console.log('writes=', writes);
    expect(writes).toBeLessThan(5);
  });
});
