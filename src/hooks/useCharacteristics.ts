// Live characteristic advances. Stores the *override* of each characteristic's
// `adv` value so the Buy +5 button in CharacteristicsScreen mutates the value
// shown on every screen (Overview wound calc, Combat hit-location formulas,
// Skills total = char base + char adv + skill adv).
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { CHARACTER, type CharacteristicKey, type Characteristic } from '@/data/character';

const KEY = 'gc.chars.adv';

type AdvMap = Record<CharacteristicKey, number>;

const seed: AdvMap = Object.fromEntries(
  CHARACTER.characteristics.map(c => [c.key, c.adv])
) as AdvMap;

export function useCharacteristics() {
  const [advances, setAdvances] = useStoredState<AdvMap>(KEY, seed);

  const get = useCallback((key: CharacteristicKey): number => {
    return advances[key] ?? seed[key];
  }, [advances]);

  /** Adjust `adv` by delta (positive or negative). */
  const adjust = useCallback((key: CharacteristicKey, delta: number) => {
    setAdvances(prev => ({ ...prev, [key]: Math.max(0, (prev[key] ?? seed[key]) + delta) }));
  }, [setAdvances]);

  /** Resolved characteristic — base init + the live adv override. */
  const list: (Characteristic & { current: number; bonus: number })[] = CHARACTER.characteristics.map(c => {
    const adv = advances[c.key] ?? c.adv;
    const current = c.init + adv;
    return { ...c, adv, current, bonus: Math.floor(current / 10) };
  });

  return { advances, list, get, adjust };
}
