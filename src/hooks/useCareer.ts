// Live career rank.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { CHARACTER } from '@/data/character';

const KEY = 'gc.career.level';

const RANK_NAMES = ['Roadwarden', 'Road Sergeant', 'Mounted Sergeant', 'Captain'];
const RANK_STATUS = ['Silver 2', 'Silver 3', 'Silver 4', 'Gold 1'];

export interface CareerState {
  level: number;
  name: string;
  status: string;
}

export function useCareer() {
  const [level, setLevel] = useStoredState<number>(KEY, CHARACTER.careerLevel);

  /** Bump rank by 1; clamps at 4. */
  const advance = useCallback(() => {
    setLevel(prev => Math.min(4, prev + 1));
  }, [setLevel]);

  const idx = Math.max(1, Math.min(4, level)) - 1;
  return {
    level,
    name: RANK_NAMES[idx],
    status: RANK_STATUS[idx],
    canAdvance: level < 4,
    advance,
  };
}
