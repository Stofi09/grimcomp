import {
  MAX_TRANSACTION_OPERATIONS,
  SETTINGS_BACKUP_SCHEMA,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  isValidStorageKey,
  isValidStorageKeySegment,
} from '@grimcomp/core';
import { validatePack } from '../content/validate';
import { NATIVE_STORAGE_VERSION_KEY } from './migrations';
import { NATIVE_RECOVERY_RESET_INTENT_KEY } from './nativeRecoveryKeys';

export type NativeStoredValueValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface NativeSettingsValidationContext {
  /** Character ids already present in the runtime roster before the import. */
  readonly availableCharacterIds?: ReadonlySet<string>;
}

const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CHARACTERISTIC_KEYS = new Set(['ws', 'bs', 's', 't', 'i', 'ag', 'dex', 'int', 'wp', 'fel']);
const XP_KINDS = new Set(['gain', 'skill', 'char', 'talent', 'career']);
const AP_KEYS = ['head', 'arm_l', 'arm_r', 'body', 'leg_l', 'leg_r', 'shield'] as const;

class InvalidNativeData extends Error {}

function fail(where: string, detail: string): never {
  throw new InvalidNativeData(`${where} ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where, 'must be an object.');
  return value;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be an array.');
  return value;
}

function requireString(value: unknown, where: string, nonBlank = false): string {
  if (typeof value !== 'string') fail(where, 'must be a string.');
  if (nonBlank && value.trim().length === 0) fail(where, 'must be a nonblank string.');
  return value;
}

function requireFinite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(where, 'must be a finite number.');
  return value;
}

function requireInteger(value: unknown, where: string, minimum?: number): number {
  const number = requireFinite(value, where);
  if (!Number.isInteger(number)) fail(where, 'must be an integer.');
  if (minimum !== undefined && number < minimum) fail(where, `must be at least ${minimum}.`);
  return number;
}

function validateStringArray(value: unknown, where: string, nonBlank = false): void {
  requireArray(value, where).forEach((entry, index) => {
    requireString(entry, `${where}[${index}]`, nonBlank);
  });
}

function validateNumberMap(
  value: unknown,
  where: string,
  options: { readonly integer?: boolean; readonly minimum?: number } = {},
): void {
  const record = requireRecord(value, where);
  for (const [name, entry] of Object.entries(record)) {
    if (!name.trim() || FORBIDDEN_RECORD_KEYS.has(name)) {
      fail(where, `contains an unsafe or blank entry name ${JSON.stringify(name)}.`);
    }
    if (options.integer) requireInteger(entry, `${where}.${name}`, options.minimum);
    else {
      const number = requireFinite(entry, `${where}.${name}`);
      if (options.minimum !== undefined && number < options.minimum) {
        fail(`${where}.${name}`, `must be at least ${options.minimum}.`);
      }
    }
  }
}

function validateRecordArray(
  value: unknown,
  where: string,
  validate: (record: Record<string, unknown>, entryWhere: string) => void,
): void {
  requireArray(value, where).forEach((entry, index) => {
    const entryWhere = `${where}[${index}]`;
    validate(requireRecord(entry, entryWhere), entryWhere);
  });
}

function validateWeapon(record: Record<string, unknown>, where: string): void {
  requireString(record.name, `${where}.name`);
  requireString(record.group, `${where}.group`);
  requireFinite(record.enc, `${where}.enc`);
  requireString(record.dmg, `${where}.dmg`);
  validateStringArray(record.qual, `${where}.qual`);
  if (record.reach !== undefined) requireString(record.reach, `${where}.reach`);
  if (record.range !== undefined) requireString(record.range, `${where}.range`);
}

function validateArmour(record: Record<string, unknown>, where: string): void {
  requireString(record.name, `${where}.name`);
  validateStringArray(record.locs, `${where}.locs`);
  requireFinite(record.enc, `${where}.enc`);
  requireFinite(record.ap, `${where}.ap`);
  validateStringArray(record.qual, `${where}.qual`);
}

function validateTrapping(record: Record<string, unknown>, where: string): void {
  requireString(record.name, `${where}.name`);
  requireFinite(record.enc, `${where}.enc`);
}

function validateCritical(record: Record<string, unknown>, where: string): void {
  requireString(record.loc, `${where}.loc`);
  requireFinite(record.roll, `${where}.roll`);
  requireString(record.name, `${where}.name`);
  requireString(record.effect, `${where}.effect`);
  requireFinite(record.days, `${where}.days`);
}

function validateCharacter(value: unknown, expectedId: string, where: string): void {
  const character = requireRecord(value, where);
  const id = requireString(character.id, `${where}.id`, true);
  if (id !== expectedId) fail(`${where}.id`, `must match map key ${JSON.stringify(expectedId)}.`);

  for (const field of [
    'name', 'species', 'class', 'career', 'careerLevelName', 'status',
    'height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong',
    'initials', 'accent',
  ]) requireString(character[field], `${where}.${field}`);
  for (const field of [
    'age', 'fate', 'fortune', 'resilience', 'resolve', 'xpCurrent', 'xpSpent',
    'corruption', 'sin', 'movement',
  ]) requireFinite(character[field], `${where}.${field}`);
  requireInteger(character.careerLevel, `${where}.careerLevel`, 1);

  // careerRanks and conditions were added after the original native roster.
  // Current hooks explicitly tolerate their absence, so legacy characters do
  // not become unrecoverable solely because those optional additions are absent.
  if (character.careerRanks !== undefined) {
    validateRecordArray(character.careerRanks, `${where}.careerRanks`, (rank, rankWhere) => {
      requireInteger(rank.level, `${rankWhere}.level`, 1);
      requireString(rank.name, `${rankWhere}.name`);
      requireString(rank.status, `${rankWhere}.status`);
    });
  }

  const wounds = requireRecord(character.wounds, `${where}.wounds`);
  requireFinite(wounds.current, `${where}.wounds.current`);
  requireFinite(wounds.max, `${where}.wounds.max`);

  const wealth = requireRecord(character.wealth, `${where}.wealth`);
  for (const denomination of ['gc', 'ss', 'd']) {
    requireFinite(wealth[denomination], `${where}.wealth.${denomination}`);
  }
  for (const [denomination, amount] of Object.entries(wealth)) {
    if (!denomination.trim() || FORBIDDEN_RECORD_KEYS.has(denomination)) {
      fail(`${where}.wealth`, `contains an unsafe or blank denomination ${JSON.stringify(denomination)}.`);
    }
    requireFinite(amount, `${where}.wealth.${denomination}`);
  }

  const seenCharacteristics = new Set<string>();
  validateRecordArray(character.characteristics, `${where}.characteristics`, (entry, entryWhere) => {
    const key = requireString(entry.key, `${entryWhere}.key`, true);
    if (!CHARACTERISTIC_KEYS.has(key)) fail(`${entryWhere}.key`, `is not a native characteristic: ${JSON.stringify(key)}.`);
    if (seenCharacteristics.has(key)) fail(`${entryWhere}.key`, `duplicates ${JSON.stringify(key)}.`);
    seenCharacteristics.add(key);
    requireString(entry.name, `${entryWhere}.name`);
    requireString(entry.short, `${entryWhere}.short`);
    requireFinite(entry.init, `${entryWhere}.init`);
    requireFinite(entry.adv, `${entryWhere}.adv`);
  });
  for (const key of CHARACTERISTIC_KEYS) {
    if (!seenCharacteristics.has(key)) fail(`${where}.characteristics`, `is missing native characteristic ${JSON.stringify(key)}.`);
  }

  validateRecordArray(character.skills, `${where}.skills`, (entry, entryWhere) => {
    requireString(entry.name, `${entryWhere}.name`);
    const characteristic = requireString(entry.char, `${entryWhere}.char`, true);
    if (!CHARACTERISTIC_KEYS.has(characteristic)) {
      fail(`${entryWhere}.char`, `is not a native characteristic: ${JSON.stringify(characteristic)}.`);
    }
    requireFinite(entry.adv, `${entryWhere}.adv`);
    if (typeof entry.career !== 'boolean') fail(`${entryWhere}.career`, 'must be a boolean.');
    if (entry.advanced !== undefined && typeof entry.advanced !== 'boolean') {
      fail(`${entryWhere}.advanced`, 'must be a boolean when provided.');
    }
    if (entry.grouped !== undefined) requireString(entry.grouped, `${entryWhere}.grouped`);
  });

  validateRecordArray(character.talents, `${where}.talents`, (entry, entryWhere) => {
    requireString(entry.name, `${entryWhere}.name`);
    requireInteger(entry.times, `${entryWhere}.times`, 1);
    requireString(entry.desc, `${entryWhere}.desc`);
    if (typeof entry.career !== 'boolean') fail(`${entryWhere}.career`, 'must be a boolean.');
  });
  validateRecordArray(character.weapons, `${where}.weapons`, validateWeapon);
  validateRecordArray(character.armour, `${where}.armour`, validateArmour);

  const ap = requireRecord(character.ap, `${where}.ap`);
  for (const key of AP_KEYS) requireFinite(ap[key], `${where}.ap.${key}`);

  if (character.conditions !== undefined) {
    validateRecordArray(character.conditions, `${where}.conditions`, (entry, entryWhere) => {
      requireString(entry.type, `${entryWhere}.type`);
      requireInteger(entry.stacks, `${entryWhere}.stacks`, 0);
    });
  }
  validateRecordArray(character.criticals, `${where}.criticals`, validateCritical);
  validateRecordArray(character.trappings, `${where}.trappings`, validateTrapping);

  const party = requireRecord(character.party, `${where}.party`);
  requireString(party.name, `${where}.party.name`);
  requireString(party.short, `${where}.party.short`);
  validateRecordArray(party.members, `${where}.party.members`, (member, memberWhere) => {
    requireString(member.name, `${memberWhere}.name`);
    requireString(member.role, `${memberWhere}.role`);
  });
  validateStringArray(character.psychology, `${where}.psychology`);
  validateRecordArray(character.mutations, `${where}.mutations`, (mutation, mutationWhere) => {
    requireString(mutation.name, `${mutationWhere}.name`);
  });

  for (const field of ['isCaster', 'isAnointed']) {
    if (character[field] !== undefined && typeof character[field] !== 'boolean') {
      fail(`${where}.${field}`, 'must be a boolean when provided.');
    }
  }
  for (const field of ['deity', 'spellLore']) {
    if (character[field] !== undefined) requireString(character[field], `${where}.${field}`);
  }
  for (const field of ['knownSpells', 'knownPrayers']) {
    if (character[field] !== undefined) validateStringArray(character[field], `${where}.${field}`, true);
  }
}

function validateCustomCharacters(value: unknown, where: string): void {
  const characters = requireRecord(value, where);
  for (const [id, character] of Object.entries(characters)) {
    if (
      !id.trim()
      || FORBIDDEN_RECORD_KEYS.has(id)
      || !isValidStorageKeySegment(id)
    ) fail(where, `contains an unsafe character id ${JSON.stringify(id)}.`);
    validateCharacter(character, id, `${where}[${JSON.stringify(id)}]`);
  }
}

function validateStoredPacks(value: unknown, where: string): void {
  const seen = new Set<string>();
  validateRecordArray(value, where, (stored, entryWhere) => {
    if (typeof stored.enabled !== 'boolean') fail(`${entryWhere}.enabled`, 'must be a boolean.');
    const validation = validatePack(stored.pack);
    if (!validation.pack || validation.errors.length > 0) {
      fail(`${entryWhere}.pack`, `is not a valid native content pack: ${validation.errors[0] ?? 'unknown validation error'}`);
    }
    if (seen.has(validation.pack.id)) fail(where, `contains duplicate pack id ${JSON.stringify(validation.pack.id)}.`);
    seen.add(validation.pack.id);
  });
}

function validateXp(value: unknown, where: string): void {
  const state = requireRecord(value, where);
  requireFinite(state.current, `${where}.current`);
  requireFinite(state.spent, `${where}.spent`);
  validateRecordArray(state.log, `${where}.log`, (entry, entryWhere) => {
    requireString(entry.date, `${entryWhere}.date`);
    requireString(entry.reason, `${entryWhere}.reason`);
    requireFinite(entry.amount, `${entryWhere}.amount`);
    // Early native XP logs omitted kind. Preserve those logs, but require the
    // current enum whenever the field is present.
    if (entry.kind !== undefined) {
      const kind = requireString(entry.kind, `${entryWhere}.kind`);
      if (!XP_KINDS.has(kind)) fail(`${entryWhere}.kind`, `is unknown: ${JSON.stringify(kind)}.`);
    }
  });
}

function validateNewCharacterDraft(value: unknown, where: string): void {
  const draft = requireRecord(value, where);
  requireString(draft.name, `${where}.name`);
  requireString(draft.species, `${where}.species`);
  requireString(draft.archetypeKey, `${where}.archetypeKey`);
  const inits = requireRecord(draft.inits, `${where}.inits`);
  for (const [key, initial] of Object.entries(inits)) {
    if (!CHARACTERISTIC_KEYS.has(key)) fail(`${where}.inits`, `contains unknown characteristic ${JSON.stringify(key)}.`);
    requireFinite(initial, `${where}.inits.${key}`);
  }
}

function validateKnownNativeValue(key: string, value: unknown): void {
  const where = JSON.stringify(key);
  if (key === 'gc.customChars') return validateCustomCharacters(value, where);
  if (key === 'gc.activeCharId') {
    const id = requireString(value, where, true);
    if (FORBIDDEN_RECORD_KEYS.has(id) || !isValidStorageKeySegment(id)) {
      fail(where, 'must contain a safe character id.');
    }
    return;
  }
  if (key === 'gc.content.packs') return validateStoredPacks(value, where);
  if (key === 'gc.settings.xpRule') {
    if (value !== 'strict' && value !== 'flexible') fail(where, 'must be "strict" or "flexible".');
    return;
  }
  if (key === 'gc.screen' || key === 'gc.notes.filter') {
    requireString(value, where);
    return;
  }
  if (key === 'gc.notes') {
    validateRecordArray(value, where, (note, noteWhere) => {
      requireString(note.cat, `${noteWhere}.cat`);
      requireString(note.title, `${noteWhere}.title`);
      requireString(note.body, `${noteWhere}.body`);
      if (note.src !== 'official' && note.src !== 'local') {
        fail(`${noteWhere}.src`, 'must be "official" or "local".');
      }
    });
    return;
  }
  if (key === 'gc.newchar.step') {
    const step = requireInteger(value, where, 0);
    if (step > 3) fail(where, 'must not exceed the final native creation step (3).');
    return;
  }
  if (key === 'gc.newchar.draft') return validateNewCharacterDraft(value, where);

  if (key.endsWith('.xp')) return validateXp(value, where);
  if (key.endsWith('.career.level')) {
    requireInteger(value, where, 1);
    return;
  }
  if (key.endsWith('.wounds') || key.endsWith('.sin') || key.endsWith('.magic.pool')) {
    requireFinite(value, where);
    return;
  }
  if (key.endsWith('.chars.adv') || key.endsWith('.skills.adv')) {
    validateNumberMap(value, where);
    return;
  }
  if (key.endsWith('.vitals')) {
    const vitals = requireRecord(value, where);
    for (const field of ['fate', 'fortune', 'resilience', 'resolve', 'corruption']) {
      requireFinite(vitals[field], `${where}.${field}`);
    }
    return;
  }
  if (key.endsWith('.conditions')) {
    validateNumberMap(value, where, { integer: true, minimum: 0 });
    return;
  }
  if (key.endsWith('.talents.times')) {
    // A legacy overlay can explicitly record zero before the first purchase.
    validateNumberMap(value, where, { integer: true, minimum: 0 });
    return;
  }
  if (key.endsWith('.weapons')) {
    validateRecordArray(value, where, validateWeapon);
    return;
  }
  if (key.endsWith('.armour')) {
    validateRecordArray(value, where, validateArmour);
    return;
  }
  if (key.endsWith('.trappings')) {
    validateRecordArray(value, where, validateTrapping);
    return;
  }
  if (key.endsWith('.criticals')) validateRecordArray(value, where, validateCritical);
  // Unrecognized gc.* globals and per-character suffixes are intentionally
  // retained for forward compatibility. They are not consumed by native UI.
}

/**
 * Validates the runtime-facing shapes consumed directly by the native app.
 * This checks structure, not game-rule policy, and deliberately passes through
 * unknown gc.* keys so a newer build's data is not destroyed by an older one.
 */
export function validateNativeStoredValue(key: string, value: unknown): NativeStoredValueValidation {
  try {
    validateKnownNativeValue(key, value);
    return { ok: true };
  } catch (error) {
    if (error instanceof InvalidNativeData) return { ok: false, message: error.message };
    let detail = 'could not be inspected safely.';
    try {
      if (error instanceof Error && error.message) detail = `could not be inspected safely: ${error.message.slice(0, 200)}`;
    } catch { /* hostile values stay bounded */ }
    return { ok: false, message: `${JSON.stringify(key)} ${detail}` };
  }
}

/** Normal exports are typed backups; corrupt raw bytes belong only in the diagnostic export. */
export function decodeNativeStoredValueForExport(key: string, raw: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new Error(`Cannot export ${key}: its stored value is not valid JSON.`); }
  const validation = validateNativeStoredValue(key, parsed);
  if (!validation.ok) throw new Error(`Cannot export ${key}: ${validation.message}`);
  return parsed;
}

export function isPortableNativeDataKey(key: string): boolean {
  return (
    key.startsWith('gc.')
    && key !== STORAGE_TRANSACTION_JOURNAL_KEY
    && key !== NATIVE_STORAGE_VERSION_KEY
    && key !== NATIVE_RECOVERY_RESET_INTENT_KEY
    && isValidStorageKey(key)
  );
}

/** Pure validation for a Settings import before it reaches the storage singleton. */
export function validateNativeSettingsImport(
  raw: unknown,
  context: NativeSettingsValidationContext = {},
):
  | { readonly ok: true; readonly dump: Record<string, unknown>; readonly keyCount: number }
  | { readonly ok: false; readonly message: string } {
  if (!isRecord(raw) || raw.$schema !== SETTINGS_BACKUP_SCHEMA) {
    return { ok: false, message: 'Expected a grimcomp.v1 export object.' };
  }

  let keys: string[];
  try { keys = Object.keys(raw).filter((key) => key.startsWith('gc.')); }
  catch { return { ok: false, message: 'The export object could not be inspected safely.' }; }
  if (keys.length === 0) return { ok: false, message: 'The export contains no Grim Companion data keys.' };
  if (keys.length > MAX_TRANSACTION_OPERATIONS) {
    return { ok: false, message: `The export contains more than ${MAX_TRANSACTION_OPERATIONS} data keys.` };
  }

  for (const key of keys) {
    if (!isPortableNativeDataKey(key)) {
      return { ok: false, message: `The export contains an invalid or internal storage key: ${JSON.stringify(key)}.` };
    }
    let candidate: unknown;
    let serialized: string | undefined;
    try {
      candidate = raw[key];
      serialized = JSON.stringify(candidate);
    } catch {
      return { ok: false, message: `The value for ${key} is not JSON-serializable.` };
    }
    if (serialized === undefined) {
      return { ok: false, message: `The value for ${key} is not JSON-serializable.` };
    }
    const validation = validateNativeStoredValue(key, candidate);
    if (!validation.ok) {
      return { ok: false, message: `The export contains incompatible native data: ${validation.message}` };
    }
  }

  const activeId = raw['gc.activeCharId'];
  if (typeof activeId === 'string' && context.availableCharacterIds) {
    const importedCustom = isRecord(raw['gc.customChars']) ? raw['gc.customChars'] : {};
    if (
      !context.availableCharacterIds.has(activeId)
      && !Object.prototype.hasOwnProperty.call(importedCustom, activeId)
    ) {
      return {
        ok: false,
        message: `The active character ${JSON.stringify(activeId)} does not exist in the post-import roster.`,
      };
    }
  }

  return { ok: true, dump: raw, keyCount: keys.length };
}
