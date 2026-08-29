// Live talent ranks, scoped to the active character.
import { useEffect, useMemo } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useContent } from '@/content/useContent';
import { type Talent } from '@/data/character';
import {
  canonicalizeAddedTalentRefs,
  isTalentCareerOption,
  migrateTalentTimes,
  normalizeAddedTalentRefs,
  resolveStoredTalentRef,
  storedTalentRefFor,
  talentIdentityKey,
  talentTimesEqual,
  type StoredTalentRef,
  type TalentRefLike,
  type TalentRankOwner,
} from '@/utils/talents';
import { careerDefForCharacter } from '@/utils/careers';

export interface LiveTalent extends Talent {
  times: number;
  /** Historical label retained for legacy XP-log refund matching. */
  storedName: string;
  /** True only for a character-scoped acquired overlay, never a template grant. */
  added: boolean;
}

export function useTalents() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const content = useContent();
  // Registry entity getters return fresh arrays; anchor them to the registry so
  // migration memos/effects do not churn on unrelated screen state changes.
  const talentDefs = useMemo(() => content.allTalentDefs, [content]);
  const careers = useMemo(() => content.allCareers, [content]);

  const templateEntries = useMemo(() => tpl.talents.map(talent => {
    const ref = storedTalentRefFor(talentDefs, talent);
    return { talent, ref, resolved: resolveStoredTalentRef(talentDefs, ref) };
  }), [talentDefs, tpl.talents]);
  const templateRefs = useMemo(
    () => templateEntries.map(entry => entry.ref),
    [templateEntries],
  );
  const seed = useMemo(() => Object.fromEntries(templateEntries.map(({ talent, ref }) => (
    [talentIdentityKey(ref), talent.times]
  ))), [templateEntries]);

  const [storedTimes, setStoredTimes] = useStoredState<unknown>(characterKey(id, 'talents.times'), seed);
  const [storedAdded, setStoredAdded] = useStoredState<unknown>(characterKey(id, 'talents.added'), []);
  const addedRefs = useMemo(
    () => canonicalizeAddedTalentRefs(talentDefs, storedAdded, templateRefs),
    [storedAdded, talentDefs, templateRefs],
  );
  const resolvedAddedRefs = useMemo(
    () => addedRefs.map(ref => resolveStoredTalentRef(talentDefs, ref)),
    [addedRefs, talentDefs],
  );
  const rankOwners = useMemo<TalentRankOwner[]>(() => [
    ...templateEntries.map(({ talent, ref, resolved }) => ({
      ref,
      aliases: [talent.name, resolved.name],
      initial: talent.times,
    })),
    ...resolvedAddedRefs.map(resolved => ({
      ref: resolved.stored,
      aliases: [resolved.stored.name, resolved.name],
      initial: 1,
    })),
  ], [resolvedAddedRefs, templateEntries]);
  const migratedRanks = useMemo(
    () => migrateTalentTimes(storedTimes, rankOwners),
    [rankOwners, storedTimes],
  );
  const times = migratedRanks.times;

  // Persist legacy-name migrations exactly once. The computed canonical state
  // is used immediately, so the first render is already correct.
  useEffect(() => {
    if (talentTimesEqual(storedTimes, migratedRanks.times)) return;
    setStoredTimes((previous: unknown) => {
      const canonical = migrateTalentTimes(previous, rankOwners).times;
      return talentTimesEqual(previous, canonical) ? previous : canonical;
    });
  }, [migratedRanks.times, rankOwners, setStoredTimes, storedTimes]);
  useEffect(() => {
    const unchanged = Array.isArray(storedAdded)
      && storedAdded.length === addedRefs.length
      && storedAdded.every((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const record = candidate as Record<string, unknown>;
        const ref = addedRefs[index];
        return Object.keys(record).every(key => ['name', 'definitionId', 'specialization'].includes(key))
          && record.name === ref?.name
          && record.definitionId === ref?.definitionId
          && record.specialization === ref?.specialization;
      });
    if (!unchanged) setStoredAdded(addedRefs);
  }, [addedRefs, setStoredAdded, storedAdded]);

  const canonicalMutationRef = (talent: TalentRefLike): StoredTalentRef => (
    storedTalentRefFor(talentDefs, talent)
  );
  const canonicalTimes = (value: unknown) => migrateTalentTimes(value, rankOwners).times;

  const buyAnother = (talent: TalentRefLike) => {
    const ref = canonicalMutationRef(talent);
    const key = talentIdentityKey(ref);
    setStoredTimes((previous: unknown) => {
      const current = canonicalTimes(previous);
      return { ...current, [key]: (current[key] ?? 0) + 1 };
    });
  };

  const refundRank = (talent: TalentRefLike) => {
    const ref = canonicalMutationRef(talent);
    const key = talentIdentityKey(ref);
    setStoredTimes((previous: unknown) => {
      const current = canonicalTimes(previous);
      return { ...current, [key]: Math.max(1, (current[key] ?? 1) - 1) };
    });
  };

  const forgetTalent = (talent: TalentRefLike) => {
    const ref = canonicalMutationRef(talent);
    const key = talentIdentityKey(ref);
    setStoredTimes((previous: unknown) => {
      const next = canonicalTimes(previous);
      delete next[key];
      return next;
    });
  };

  const addTalentRef = (ref: StoredTalentRef) => {
    setStoredAdded((previous: unknown) => canonicalizeAddedTalentRefs(
      talentDefs,
      [...normalizeAddedTalentRefs(previous), ref],
      templateRefs,
    ));
  };

  const removeTalentRef = (talent: TalentRefLike) => {
    const key = talentIdentityKey(canonicalMutationRef(talent));
    setStoredAdded((previous: unknown) => canonicalizeAddedTalentRefs(
      talentDefs,
      previous,
      templateRefs,
    ).filter(ref => talentIdentityKey(ref) !== key));
  };

  const registryCareer = careerDefForCharacter(careers, tpl);
  const careerTalentNames = new Set(registryCareer?.advanceScheme?.talents ?? []);
  const templateTalents: LiveTalent[] = templateEntries.map(({ talent, ref, resolved }) => ({
    ...talent,
    name: resolved.name,
    definitionId: ref.definitionId,
    specialization: resolved.specialization,
    times: times[talentIdentityKey(ref)] ?? talent.times,
    storedName: talent.name,
    added: false,
  }));
  const addedTalents: LiveTalent[] = resolvedAddedRefs.map(resolved => {
    const definition = resolved.definition;
    return {
      name: resolved.name,
      definitionId: resolved.stored.definitionId ?? definition?.id,
      specialization: resolved.specialization,
      times: times[talentIdentityKey(resolved.stored)] ?? 1,
      desc: definition?.description
        ?? 'Loaded definition unavailable; restore its content pack to view the rules summary.',
      career: isTalentCareerOption(careerTalentNames, talentDefs, definition, resolved.name),
      storedName: resolved.stored.name,
      added: true,
    };
  });
  const list = [...templateTalents, ...addedTalents];

  return {
    times,
    list,
    addedRefs,
    resolvedAddedRefs,
    buyAnother,
    refundRank,
    forgetTalent,
    addTalentRef,
    removeTalentRef,
  };
}
