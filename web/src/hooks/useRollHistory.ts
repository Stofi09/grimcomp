import { useCallback } from 'react';
import { characterKey, useActiveCharId } from './useCharacter';
import { useStoredState } from './useStoredState';
import { readRollHistory, ROLL_HISTORY_LIMIT, type RollHistoryEntry } from '@/utils/rollHistory';

export function useRollHistory() {
  const id = useActiveCharId();
  const [stored, setStored] = useStoredState<unknown>(characterKey(id, 'rollHistory'), []);
  const recordRoll = useCallback((entry: Omit<RollHistoryEntry, 'id' | 'at'>) => {
    const next: RollHistoryEntry = {
      ...entry,
      title: entry.title.slice(0, 240),
      dice: entry.dice.slice(0, 40),
      detail: entry.detail.slice(0, 6000),
      result: { ...entry.result, label: entry.result.label?.slice(0, 240) },
      id: crypto.randomUUID(),
      at: Date.now(),
    };
    const ticket = setStored((previous: unknown) => [next, ...readRollHistory(previous)].slice(0, ROLL_HISTORY_LIMIT));
    return { entry: next, completion: ticket.completion };
  }, [setStored]);
  return { entries: readRollHistory(stored), recordRoll };
}
