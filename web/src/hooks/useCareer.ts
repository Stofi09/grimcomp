// Live career rank, scoped to the active character.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';

export function useCareer() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const ranks = tpl.careerRanks ?? [];
  const [level, setLevel] = useStoredState<number>(
    characterKey(id, 'career.level'),
    tpl.careerLevel ?? 1,
  );

  const advance = useCallback(() => {
    setLevel(prev => Math.min(ranks.length, prev + 1));
  }, [setLevel, ranks.length]);

  const idx = Math.max(1, Math.min(ranks.length || 1, level)) - 1;
  const cur = ranks[idx];
  return {
    level,
    name: cur?.name ?? tpl.careerLevelName ?? '',
    status: cur?.status ?? tpl.status ?? '',
    ranks,
    canAdvance: level < ranks.length,
    advance,
  };
}
