// Live talent ranks, scoped to the active character.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useCareers, useTalentDefs } from '@/content/useContent';
import { type Talent } from '@/data/character';

type TimesMap = Record<string, number>;

export function useTalents() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const talentDefs = useTalentDefs();
  const careers = useCareers();
  const seed = Object.fromEntries(tpl.talents.map(t => [t.name, t.times]));
  const [times, setTimes] = useStoredState<TimesMap>(characterKey(id, 'talents.times'), seed);
  const [addedNames] = useStoredState<string[]>(characterKey(id, 'talents.added'), []);

  const buyAnother = useCallback((name: string) => {
    setTimes(prev => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  }, [setTimes]);

  // Reverse a purchased rank (used by the undo path after a successful XP
  // refund). Never drops a talent below a single rank — you can't un-know it.
  const refundRank = useCallback((name: string) => {
    setTimes(prev => ({ ...prev, [name]: Math.max(1, (prev[name] ?? 1) - 1) }));
  }, [setTimes]);

  const forgetTalent = useCallback((name: string) => {
    setTimes(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, [setTimes]);

  const templateTalents: (Talent & { times: number })[] = tpl.talents.map(t => ({
    ...t,
    times: times[t.name] ?? t.times,
  }));
  const templateNames = new Set(templateTalents.map(talent => talent.name));
  const registryCareer = careers.find(candidate => candidate.name === tpl.career);
  const careerTalentNames = new Set(registryCareer?.advanceScheme?.talents ?? []);
  const defsByName = new Map(talentDefs.map(def => [def.name, def]));
  // Talents bought through the picker are stored as names + rank overlays rather
  // than being written back into the immutable character template. Compose them
  // here so every consumer (including derived Max Wounds) sees the same live list.
  const addedTalents: (Talent & { times: number })[] = addedNames.flatMap(name => {
    if (templateNames.has(name)) return [];
    const def = defsByName.get(name);
    if (!def) return [];
    return [{
      name: def.name,
      times: times[def.name] ?? 1,
      desc: def.description,
      career: careerTalentNames.has(def.name),
    }];
  });
  const list = [...templateTalents, ...addedTalents];

  return { times, list, buyAnother, refundRank, forgetTalent };
}
