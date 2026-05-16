// Live characteristic advances, scoped to the active character.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { type CharacteristicKey, type Characteristic } from '@/data/character';

type AdvMap = Record<CharacteristicKey, number>;

export function useCharacteristics() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const seed = Object.fromEntries(
    tpl.characteristics.map(c => [c.key, c.adv])
  ) as AdvMap;
  const [advances, setAdvances] = useStoredState<AdvMap>(characterKey(id, 'chars.adv'), seed);

  const getCh = useCallback((key: CharacteristicKey): number => {
    return advances[key] ?? (tpl.characteristics.find(c => c.key === key)?.adv ?? 0);
  }, [advances, tpl]);

  const adjust = useCallback((key: CharacteristicKey, delta: number) => {
    setAdvances(prev => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) }));
  }, [setAdvances]);

  const list: (Characteristic & { current: number; bonus: number })[] = tpl.characteristics.map(c => {
    const adv = advances[c.key] ?? c.adv;
    const current = c.init + adv;
    return { ...c, adv, current, bonus: Math.floor(current / 10) };
  });

  return { advances, list, get: getCh, adjust };
}
