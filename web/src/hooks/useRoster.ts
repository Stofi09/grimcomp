// Combined roster source-of-truth: the content registry's character templates
// (authored in the core-characters pack) plus any user-created characters
// persisted under `gc.customChars`. NewCharScreen `add`s to this; useCharacter
// reads from it; RosterScreen lists from it.

import { useCallback } from 'react';
import { useStoredState, clearStoredKeys } from './useStoredState';
import { useContent } from '@/content/useContent';
import { FALLBACK_CHARACTER_ID, type Character } from '@/data/character';

const KEY = 'gc.customChars';

type CustomMap = Record<string, Character>;

// Minimal safe template, used only while the content packs are still being
// fetched (the registry has no templates yet). It keeps the per-character
// hooks from crashing during that brief loading phase; nothing derived from it
// is ever persisted, because useStoredState never writes seeds to storage.
const FALLBACK_CHARACTER: Character = {
  id: FALLBACK_CHARACTER_ID,
  name: '—',
  species: 'Human',
  class: '',
  career: '',
  careerLevel: 1,
  careerLevelName: '',
  careerRanks: [],
  status: '',
  age: 0,
  height: '',
  hair: '',
  eyes: '',
  motivation: '',
  fate: 0,
  fortune: 0,
  resilience: 0,
  resolve: 0,
  xpCurrent: 0,
  xpSpent: 0,
  wounds: { current: 0, max: 0 },
  corruption: 0,
  sin: 0,
  movement: 0,
  wealth: { gc: 0, ss: 0, d: 0 },
  characteristics: [
    { key: 'ws', name: 'Weapon Skill', short: 'WS', init: 0, adv: 0 },
    { key: 'bs', name: 'Ballistic Skill', short: 'BS', init: 0, adv: 0 },
    { key: 's', name: 'Strength', short: 'S', init: 0, adv: 0 },
    { key: 't', name: 'Toughness', short: 'T', init: 0, adv: 0 },
    { key: 'i', name: 'Initiative', short: 'I', init: 0, adv: 0 },
    { key: 'ag', name: 'Agility', short: 'Ag', init: 0, adv: 0 },
    { key: 'dex', name: 'Dexterity', short: 'Dex', init: 0, adv: 0 },
    { key: 'int', name: 'Intelligence', short: 'Int', init: 0, adv: 0 },
    { key: 'wp', name: 'Willpower', short: 'WP', init: 0, adv: 0 },
    { key: 'fel', name: 'Fellowship', short: 'Fel', init: 0, adv: 0 },
  ],
  skills: [],
  talents: [],
  weapons: [],
  armour: [],
  ap: { head: 0, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },
  conditions: [],
  criticals: [],
  trappings: [],
  party: { name: '', short: '', members: [] },
  psychology: [],
  mutations: [],
  ambitionsShort: '',
  ambitionsLong: '',
  initials: '·',
  accent: '#8b2d2d',
};

export function useRoster() {
  const [custom, setCustom] = useStoredState<CustomMap>(KEY, {});
  const registry = useContent();
  const templateList: Character[] = registry.allCharacterTemplates ?? [];
  const templates: Record<string, Character> = {};
  for (const c of templateList) templates[c.id] = c;

  // Built-ins live in the content registry; custom live in localStorage.
  // Custom wins in the combined map if the same id ever collides (we mint
  // unique ids on creation so this shouldn't happen in practice).
  const all: Record<string, Character> = { ...templates, ...custom };
  const list: Character[] = Object.values(all);

  /** Add a freshly-created character. Returns the (possibly remapped) id. */
  const add = useCallback((c: Character): string => {
    setCustom(prev => ({ ...prev, [c.id]: c }));
    return c.id;
  }, [setCustom]);

  /** Delete a custom character. Built-ins (registry template ids) can't be
      deleted — they never live in the custom map. Also purges every
      `gc.<id>.*` overlay key (xp, advances, talents, wounds, conditions,
      career level, weapons, armour, trappings, criticals, sin, …) so the
      deletion is actually complete and a later character that reuses this id
      can't inherit the dead character's state. */
  const remove = useCallback((id: string) => {
    clearStoredKeys(k => k.startsWith(`gc.${id}.`));
    setCustom(prev => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, [setCustom]);

  /** Resolve a character id: registry template → custom character → first
      registry template → (registry still loading / empty) safe fallback. */
  const get = useCallback((id: string): Character => {
    return templates[id] ?? custom[id] ?? templateList[0] ?? FALLBACK_CHARACTER;
  }, [all]);

  /** Mint a fresh id (cN) that's not in use yet. */
  const nextId = useCallback((): string => {
    let i = Object.keys(all).length + 1;
    while (`c${i}` in all) i += 1;
    return `c${i}`;
  }, [all]);

  return { all, list, custom, add, remove, get, nextId };
}
