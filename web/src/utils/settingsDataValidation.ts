import { isValidStorageKeySegment } from '@grimcomp/core';
import { validatePack } from '@/content/validate';
import { validateCharacterTemplate } from '@/content/validateCharacter';
import { MAX_STORED_CONTENT_PACKS } from '@/content/storedContentPacks';

export interface SettingsValidationContext {
  readonly builtInCharacterIds?: ReadonlySet<string>;
}

const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isNonBlankString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

function invalid(label: string, key: string, detail: string): never {
  throw new Error(`${label} ${JSON.stringify(key)} ${detail}`);
}

function requireArray(value: unknown, label: string, key: string): unknown[] {
  if (!Array.isArray(value)) invalid(label, key, 'must be an array.');
  return value;
}

function requireRecord(value: unknown, label: string, key: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(label, key, 'must be an object.');
  return value;
}

function validateStringArray(value: unknown, label: string, key: string): void {
  const list = requireArray(value, label, key);
  if (list.some(item => !isNonBlankString(item))) {
    invalid(label, key, 'must contain only nonblank strings.');
  }
}

function validateNumberMap(
  value: unknown,
  label: string,
  key: string,
  options: { readonly integer?: boolean; readonly min?: number } = {},
): void {
  const record = requireRecord(value, label, key);
  for (const [entryKey, number] of Object.entries(record)) {
    if (!entryKey.trim() || !isFiniteNumber(number)) {
      invalid(label, key, 'must map nonblank keys to finite numbers.');
    }
    if (options.integer && !Number.isInteger(number)) {
      invalid(label, key, 'must map keys to finite integers.');
    }
    if (options.min !== undefined && number < options.min) {
      invalid(label, key, `must not contain numbers below ${options.min}.`);
    }
  }
}

function validateRecordArray(
  value: unknown,
  label: string,
  key: string,
  validate: (record: Record<string, unknown>, entryKey: string) => void,
): void {
  requireArray(value, label, key).forEach((entry, index) => {
    const entryKey = `${key}[${index}]`;
    validate(requireRecord(entry, label, entryKey), entryKey);
  });
}

function requireFields(
  record: Record<string, unknown>,
  label: string,
  key: string,
  strings: readonly string[],
  numbers: readonly string[],
): void {
  if (strings.some(field => typeof record[field] !== 'string')) {
    invalid(label, key, `must contain string fields: ${strings.join(', ')}.`);
  }
  if (numbers.some(field => !isFiniteNumber(record[field]))) {
    invalid(label, key, `must contain finite-number fields: ${numbers.join(', ')}.`);
  }
}

export function validateCustomCharacterMap(
  value: unknown,
  label: string,
  context: SettingsValidationContext = {},
): Record<string, Record<string, unknown>> {
  const key = 'gc.customChars';
  const record = requireRecord(value, label, key);
  for (const [characterId, candidate] of Object.entries(record)) {
    if (FORBIDDEN_RECORD_KEYS.has(characterId)) {
      invalid(label, key, `contains a forbidden id: ${JSON.stringify(characterId)}.`);
    }
    if (!isValidStorageKeySegment(characterId)) {
      invalid(label, key, `contains an invalid character id: ${JSON.stringify(characterId)}.`);
    }
    if (context.builtInCharacterIds?.has(characterId)) {
      invalid(label, key, `contains id ${JSON.stringify(characterId)}, which collides with a built-in character.`);
    }
    const characterKey = `gc.customChars[${JSON.stringify(characterId)}]`;
    const character = requireRecord(candidate, label, characterKey);
    if (character.id !== characterId) {
      invalid(label, characterKey, `must declare id ${JSON.stringify(characterId)}.`);
    }
    const errors = validateCharacterTemplate(character, `${label} ${characterKey}`);
    if (errors.length > 0) {
      const shown = errors.slice(0, 3).join(' ');
      const remainder = errors.length > 3 ? ` (${errors.length - 3} more errors)` : '';
      throw new Error(`${shown}${remainder}`);
    }
  }
  return record as Record<string, Record<string, unknown>>;
}

function validateContentPacks(value: unknown, label: string, key: string): void {
  const storedPacks = requireArray(value, label, key);
  if (storedPacks.length > MAX_STORED_CONTENT_PACKS) {
    invalid(label, key, `must contain at most ${MAX_STORED_CONTENT_PACKS} packs.`);
  }
  const ids = new Set<string>();
  validateRecordArray(storedPacks, label, key, (stored, entryKey) => {
    if (typeof stored.enabled !== 'boolean') invalid(label, entryKey, '"enabled" must be a boolean.');
    const pack = requireRecord(stored.pack, label, `${entryKey}.pack`);
    const validation = validatePack(pack);
    if (validation.errors.length > 0) {
      invalid(label, `${entryKey}.pack`, `is not a valid content pack: ${validation.errors[0]}`);
    }
    if (typeof pack.id === 'string') {
      if (ids.has(pack.id)) invalid(label, key, `contains duplicate pack id ${JSON.stringify(pack.id)}.`);
      ids.add(pack.id);
    }
  });
}

function validateXp(value: unknown, label: string, key: string): void {
  const xp = requireRecord(value, label, key);
  if (!isFiniteNumber(xp.current) || !isFiniteNumber(xp.spent) || !Array.isArray(xp.log)) {
    invalid(label, key, 'must contain finite "current"/"spent" values and a "log" array.');
  }
  xp.log.forEach((entry, index) => {
    const entryKey = `${key}.log[${index}]`;
    const record = requireRecord(entry, label, entryKey);
    requireFields(record, label, entryKey, ['date', 'reason'], ['amount']);
    if (record.kind !== undefined && typeof record.kind !== 'string') {
      invalid(label, entryKey, '"kind" must be a string when provided.');
    }
    if (record.entityKey !== undefined && typeof record.entityKey !== 'string') {
      invalid(label, entryKey, '"entityKey" must be a string when provided.');
    }
  });
}

function validateIdentity(value: unknown, label: string, key: string): void {
  const identity = requireRecord(value, label, key);
  for (const field of ['name', 'height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong']) {
    if (identity[field] !== undefined && typeof identity[field] !== 'string') {
      invalid(label, key, `${JSON.stringify(field)} must be a string when provided.`);
    }
  }
  if (identity.age !== undefined && !isFiniteNumber(identity.age)) {
    invalid(label, key, '"age" must be a finite number when provided.');
  }
}

function validateCollection(value: unknown, label: string, key: string, kind: string): void {
  if (kind === 'weapons') {
    validateRecordArray(value, label, key, (record, entryKey) => {
      requireFields(record, label, entryKey, ['name', 'group', 'dmg'], ['enc']);
      validateStringArray(record.qual, label, `${entryKey}.qual`);
      for (const field of ['reach', 'range']) {
        if (record[field] !== undefined && typeof record[field] !== 'string') {
          invalid(label, entryKey, `${JSON.stringify(field)} must be a string when provided.`);
        }
      }
    });
    return;
  }
  if (kind === 'armour') {
    validateRecordArray(value, label, key, (record, entryKey) => {
      requireFields(record, label, entryKey, ['name'], ['enc', 'ap']);
      validateStringArray(record.locs, label, `${entryKey}.locs`);
      validateStringArray(record.qual, label, `${entryKey}.qual`);
    });
    return;
  }
  if (kind === 'trappings') {
    validateRecordArray(value, label, key, (record, entryKey) => {
      requireFields(record, label, entryKey, ['name'], ['enc']);
    });
    return;
  }
  if (kind === 'criticals') {
    validateRecordArray(value, label, key, (record, entryKey) => {
      requireFields(record, label, entryKey, ['loc', 'name', 'effect'], ['roll', 'days']);
    });
  }
}

function validateExtraSkills(value: unknown, label: string, key: string): void {
  validateRecordArray(value, label, key, (record, entryKey) => {
    requireFields(record, label, entryKey, ['name', 'char'], ['adv']);
    if (!isNonBlankString(record.name) || !isNonBlankString(record.char)) {
      invalid(label, entryKey, '"name" and "char" must be nonblank strings.');
    }
    if (typeof record.adv !== 'number' || !Number.isInteger(record.adv) || record.adv < 0) {
      invalid(label, entryKey, '"adv" must be a non-negative integer.');
    }
    if (typeof record.career !== 'boolean') invalid(label, entryKey, '"career" must be a boolean.');
    if (record.advanced !== undefined && typeof record.advanced !== 'boolean') {
      invalid(label, entryKey, '"advanced" must be a boolean when provided.');
    }
    if (record.definitionId !== undefined && !isNonBlankString(record.definitionId)) {
      invalid(label, entryKey, '"definitionId" must be a nonblank string when provided.');
    }
    // The defensive runtime normalizer historically accepted an empty grouped
    // label, so keep that legacy shape portable.
    if (record.grouped !== undefined && typeof record.grouped !== 'string') {
      invalid(label, entryKey, '"grouped" must be a string when provided.');
    }
  });
}

function validateAddedTalents(value: unknown, label: string, key: string): void {
  requireArray(value, label, key).forEach((entry, index) => {
    if (isNonBlankString(entry)) return; // legacy string[] form
    const entryKey = `${key}[${index}]`;
    const record = requireRecord(entry, label, entryKey);
    if (!isNonBlankString(record.name)) invalid(label, entryKey, '"name" must be a nonblank string.');
    for (const field of ['definitionId', 'specialization']) {
      if (record[field] !== undefined && !isNonBlankString(record[field])) {
        invalid(label, entryKey, `${JSON.stringify(field)} must be a nonblank string when provided.`);
      }
    }
  });
}

function validateNotes(value: unknown, label: string, key: string): void {
  validateRecordArray(value, label, key, (record, entryKey) => {
    requireFields(record, label, entryKey, ['cat', 'title', 'src', 'body'], []);
    // Old seeded notes predate stable ids. They remain readable; current notes
    // carry ids and must keep them string-shaped when present.
    if (record.id !== undefined && typeof record.id !== 'string') {
      invalid(label, entryKey, '"id" must be a string when provided.');
    }
  });
}

function validateRecentReferences(value: unknown, label: string, key: string): void {
  validateRecordArray(value, label, key, (record, entryKey) => {
    requireFields(record, label, entryKey, ['id', 'category', 'name', 'meta', 'detail'], []);
  });
}

function validateNewCharacterDraft(value: unknown, label: string, key: string): void {
  const draft = requireRecord(value, label, key);
  requireFields(draft, label, key, ['name', 'species', 'careerId'], ['extraToFate']);
  if (typeof draft.speciesRandom !== 'boolean') {
    invalid(label, key, '"speciesRandom" must be a boolean.');
  }
  for (const field of ['speciesRollLocked', 'careerRollLocked']) {
    if (draft[field] !== undefined && typeof draft[field] !== 'boolean') {
      invalid(label, key, `${JSON.stringify(field)} must be a boolean when provided.`);
    }
  }
  if (!['choose', 'first', 'three'].includes(String(draft.careerMode))) {
    invalid(label, key, '"careerMode" must be "choose", "first", or "three".');
  }
  validateStringArray(draft.careerChoices, label, `${key}.careerChoices`);
  validateNumberMap(draft.inits, label, `${key}.inits`);
}

/**
 * Validate storage shapes consumed directly by current screens. Unknown gc.*
 * globals and unlisted per-character suffixes intentionally remain
 * pass-through (after key/JSON/serializability checks). Keys claiming one of
 * the known suffixes below are validated even when their character id is not
 * currently loaded. This keeps future dynamic overlays portable without
 * letting malformed current shapes reach screens that assume them.
 */
export function validatePortableStorageValue(
  key: string,
  value: unknown,
  label: string,
  context: SettingsValidationContext = {},
): void {
  if (key === 'gc.customChars') {
    validateCustomCharacterMap(value, label, context);
    return;
  }
  if (key === 'gc.activeCharId') {
    if (
      !isValidStorageKeySegment(value)
      || FORBIDDEN_RECORD_KEYS.has(value)
    ) {
      invalid(label, key, 'must be a nonblank, non-reserved character id without dots.');
    }
    return;
  }
  if (key === 'gc.content.packs') {
    validateContentPacks(value, label, key);
    return;
  }
  if (key === 'gc.content.userEdits') {
    const pack = requireRecord(value, label, key);
    const validation = validatePack(pack);
    if (validation.errors.length > 0) invalid(label, key, `is not a valid content pack: ${validation.errors[0]}`);
    return;
  }
  if (key === 'gc.settings.xpRule') {
    if (value !== 'strict' && value !== 'flexible') invalid(label, key, 'must be "strict" or "flexible".');
    return;
  }
  if (key === 'gc.screen' || key === 'gc.notes.filter') {
    if (typeof value !== 'string') invalid(label, key, 'must be a string.');
    return;
  }
  if (key === 'gc.notes') {
    validateNotes(value, label, key);
    return;
  }
  if (key === 'gc.reference.recent') {
    validateRecentReferences(value, label, key);
    return;
  }
  if (key === 'gc.newchar.step') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      invalid(label, key, 'must be a non-negative integer.');
    }
    return;
  }
  if (key === 'gc.newchar.draft') {
    validateNewCharacterDraft(value, label, key);
    return;
  }

  if (key.endsWith('.xp')) return validateXp(value, label, key);
  if (key.endsWith('.identity')) return validateIdentity(value, label, key);
  if (key.endsWith('.career.level')) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      invalid(label, key, 'must be an integer of at least 1.');
    }
    return;
  }
  if (['.wounds', '.advantage', '.sin', '.magic.pool'].some(suffix => key.endsWith(suffix))) {
    if (!isFiniteNumber(value)) invalid(label, key, 'must be a finite number.');
    return;
  }
  if (['.chars.adv', '.skills.adv', '.vitals'].some(suffix => key.endsWith(suffix))) {
    validateNumberMap(value, label, key, { min: 0 });
    return;
  }
  if (key.endsWith('.conditions')) {
    validateNumberMap(value, label, key, { integer: true, min: 0 });
    return;
  }
  if (key.endsWith('.wealth')) {
    validateNumberMap(value, label, key);
    return;
  }
  if (key.endsWith('.talents.times')) {
    validateNumberMap(value, label, key, { integer: true, min: 1 });
    return;
  }
  for (const kind of ['weapons', 'armour', 'trappings', 'criticals']) {
    if (key.endsWith(`.${kind}`)) return validateCollection(value, label, key, kind);
  }
  if (key.endsWith('.skills.extra')) return validateExtraSkills(value, label, key);
  if (key.endsWith('.talents.added')) return validateAddedTalents(value, label, key);
  if (key.endsWith('.magic.spellbook')) {
    const overlay = requireRecord(value, label, key);
    validateStringArray(overlay.added, label, `${key}.added`);
    validateStringArray(overlay.removed, label, `${key}.removed`);
  }
}
