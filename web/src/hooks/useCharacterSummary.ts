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
import {
  canonicalizeAddedTalentRefs,
  migrateTalentTimes,
  resolveStoredTalentRef,
  storedTalentRefFor,
  talentIdentityKey,
} from '@/utils/talents';

type AdvanceMap = Record<CharacteristicKey, number>;

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
  const [storedTalentTimes] = useStoredState<unknown>(
    characterKey(id, 'talents.times'),
    Object.fromEntries(template.talents.map(t => [t.name, t.times])),
  );
  const [storedAddedTalents] = useStoredState<unknown>(characterKey(id, 'talents.added'), []);

  const races = useRaces();
  const talentDefs = useTalentDefs();
  const woundsRules = useWoundsRules();
  const { formulas } = useSystemRules();

  return useMemo(() => {
    const templateTalentEntries = template.talents.map(talent => {
      const ref = storedTalentRefFor(talentDefs, talent);
      return { talent, ref, resolved: resolveStoredTalentRef(talentDefs, ref) };
    });
    const templateTalentRefs = templateTalentEntries.map(entry => entry.ref);
    const addedTalentRefs = canonicalizeAddedTalentRefs(
      talentDefs,
      storedAddedTalents,
      templateTalentRefs,
    );
    const resolvedAddedTalents = addedTalentRefs.map(ref => resolveStoredTalentRef(talentDefs, ref));
    const talentTimes = migrateTalentTimes(storedTalentTimes, [
      ...templateTalentEntries.map(({ talent, ref, resolved }) => ({
        ref,
        aliases: [talent.name, resolved.name],
        initial: talent.times,
      })),
      ...resolvedAddedTalents.map(resolved => ({
        ref: resolved.stored,
        aliases: [resolved.stored.name, resolved.name],
        initial: 1,
      })),
    ]).times;
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
    const templateTalents = templateTalentEntries.map(({ talent, ref, resolved }) => {
      return {
        ...talent,
        name: resolved.name,
        definitionId: ref.definitionId,
        specialization: resolved.specialization,
        times: talentTimes[talentIdentityKey(ref)] ?? talent.times,
      };
    });
    const addedTalents: Array<Talent & { times: number }> = resolvedAddedTalents.map(resolved => {
      const ref = resolved.stored;
      const def = resolved.definition;
      return {
        name: resolved.name,
        definitionId: ref.definitionId ?? def?.id,
        specialization: resolved.specialization,
        times: talentTimes[talentIdentityKey(ref)] ?? 1,
        desc: def?.description
          ?? 'Loaded definition unavailable; restore its content pack to view the rules summary.',
        career: false,
      };
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
    storedTalentTimes,
    storedAddedTalents,
    talentDefs,
    races,
    woundsRules,
    formulas,
    careerLevel,
    wounds,
    xp,
  ]);
}
