// Live, read-only summary for any roster character. Unlike the active-character
// hooks, this takes an explicit template so every roster card can subscribe to
// its own overlays without changing the globally active character.

import { useMemo } from 'react';
import type { Character, CharacteristicKey, Talent } from '@/data/character';
import type { XpState } from './useXp';
import {
  applyIdentityOverlay,
  characterKey,
  type IdentityOverlay,
} from './useCharacter';
import { useStoredState } from './useStoredState';
import { useRaces, useSystemRules, useTalentDefs, useWoundsRules } from '@/content/useContent';
import { evalFormulaSafe } from '@/utils/formula';
import { deriveStats } from '@/utils/derived';

type AdvanceMap = Record<CharacteristicKey, number>;
type TalentTimesMap = Record<string, number>;

export function useCharacterSummary(template: Character) {
  const id = template.id;
  const [identity] = useStoredState<IdentityOverlay>(characterKey(id, 'identity'), {});
  const [xp] = useStoredState<XpState>(characterKey(id, 'xp'), {
    current: template.xpCurrent,
    spent: template.xpSpent,
    log: [],
  });
  const [wounds] = useStoredState<number>(
    characterKey(id, 'wounds'),
    template.wounds.current,
  );
  const [careerLevel] = useStoredState<number>(
    characterKey(id, 'career.level'),
    template.careerLevel ?? 1,
  );
  const [advances] = useStoredState<AdvanceMap>(
    characterKey(id, 'chars.adv'),
    Object.fromEntries(template.characteristics.map(c => [c.key, c.adv])),
  );
  const [talentTimes] = useStoredState<TalentTimesMap>(
    characterKey(id, 'talents.times'),
    Object.fromEntries(template.talents.map(t => [t.name, t.times])),
  );
  const [addedTalentNames] = useStoredState<string[]>(characterKey(id, 'talents.added'), []);

  const races = useRaces();
  const talentDefs = useTalentDefs();
  const woundsRules = useWoundsRules();
  const { formulas } = useSystemRules();

  return useMemo(() => {
    const character = applyIdentityOverlay(template, identity);
    const characteristics = template.characteristics.map(c => {
      const adv = advances[c.key] ?? c.adv;
      const current = c.init + adv;
      return {
        ...c,
        adv,
        current,
        bonus: evalFormulaSafe(formulas.bonus, { value: current }),
      };
    });
    const templateTalents = template.talents.map(t => ({
      ...t,
      times: talentTimes[t.name] ?? t.times,
    }));
    const templateTalentNames = new Set(templateTalents.map(talent => talent.name));
    const defsByName = new Map(talentDefs.map(def => [def.name, def]));
    const addedTalents: Array<Talent & { times: number }> = addedTalentNames.flatMap(name => {
      if (templateTalentNames.has(name)) return [];
      const def = defsByName.get(name);
      if (!def) return [];
      return [{
        name: def.name,
        times: talentTimes[def.name] ?? 1,
        desc: def.description,
        career: false,
      }];
    });
    const talents = [...templateTalents, ...addedTalents];
    const derived = deriveStats(
      character,
      characteristics,
      talents,
      races,
      woundsRules,
      formulas,
    );
    const level = Math.max(
      1,
      Math.min(template.careerRanks.length || 1, careerLevel),
    );
    const rank = template.careerRanks[level - 1];

    return {
      character,
      wounds,
      maxWounds: derived.maxWounds,
      xpCurrent: xp.current,
      careerLevel: level,
      careerName: rank?.name ?? template.careerLevelName ?? template.career,
      status: rank?.status ?? template.status,
    };
  }, [
    template,
    identity,
    advances,
    talentTimes,
    addedTalentNames,
    talentDefs,
    races,
    woundsRules,
    formulas,
    careerLevel,
    wounds,
    xp,
  ]);
}
