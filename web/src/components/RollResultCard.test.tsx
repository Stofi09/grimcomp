// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RollResultCard } from './RollResultCard';
import { resolveTest } from '@/utils/roll';
import { readRollHistory, type RollHistoryEntry } from '@/utils/rollHistory';
import { validatePortableStorageValue } from '@/utils/settingsDataValidation';

afterEach(cleanup);
const entry: RollHistoryEntry = {
  id: 'test', at: 1, dice: 'd100', title: 'Sword — NO HIT', detail: '',
  result: resolveTest({ target: 60, forceRoll: 52 }),
};

describe('attack history outcomes', () => {
  it('shows a lost opposition as no hit despite a successful individual test, including old records', () => {
    render(<RollResultCard entry={entry} />);
    expect(screen.getByText('Attack · NO HIT')).toBeTruthy();
    expect(screen.getByRole('article').className).toContain('roll-result--failure');
    expect(screen.getByText('Your test: SUCCESS')).toBeTruthy();
  });

  it('shows both opposed rolls prominently and preserves validated attack metadata', () => {
    const complete = { ...entry, attack: { landed: false, defender: { target: 40, roll: 24, sl: 2 } } };
    render(<RollResultCard entry={complete} />);
    expect(screen.getByText(/Defender \+2 SL \(roll 24 vs 40\)/)).toBeTruthy();
    expect(() => validatePortableStorageValue('gc.c1.rollHistory', [complete], 'test')).not.toThrow();
    expect(readRollHistory([complete])).toEqual([complete]);
    expect(readRollHistory([{ ...complete, attack: { landed: 'no' } }])).toEqual([]);
  });
});
