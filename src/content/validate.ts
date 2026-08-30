// Hand-rolled ContentPack validation. Used when importing user content packs
// so malformed JSON surfaces a readable error instead of crashing a screen at
// render time.

import { CONTENT_SCHEMA, type ContentPack } from './types';

export interface ValidationResult {
  pack?: ContentPack;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonBlankString = (v: unknown): v is string => isString(v) && v.trim().length > 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const CHARACTERISTIC_KEYS = new Set(['ws', 'bs', 's', 't', 'i', 'ag', 'dex', 'int', 'wp', 'fel']);
const MAX_CONTENT_ENTRIES = 10_000;
const MAX_VALIDATION_DIAGNOSTICS = 100;

function describeValue(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return (encoded === undefined ? typeof value : encoded).slice(0, 200);
  } catch {
    return '<unprintable>';
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value)
    && value.length <= MAX_CONTENT_ENTRIES
    && value.every(isNonBlankString)
  );
}

interface EntrySpec {
  /** Required string fields on each entry. */
  strings?: string[];
  /** Required numeric fields on each entry. */
  numbers?: string[];
  /** Extra per-entry validation. Push errors via `push`. */
  extra?: (entry: Record<string, unknown>, where: string, push: (msg: string) => void) => void;
}

/**
 * Validate an untrusted value as a ContentPack. On success `pack` is set; on
 * failure `errors` lists every problem found.
 *
 * Id uniqueness is enforced *per section* — a spell and a prayer may legitimately
 * share an id since the registry keeps them in separate maps.
 */
export function validatePack(raw: unknown): ValidationResult {
  const errors: string[] = [];
  let diagnosticsTruncated = false;
  const push = (msg: string) => {
    if (errors.length < MAX_VALIDATION_DIAGNOSTICS) {
      errors.push(msg.slice(0, 500));
    } else if (!diagnosticsTruncated) {
      diagnosticsTruncated = true;
      errors.push('Additional validation errors were omitted.');
    }
  };

  if (!isObject(raw)) {
    return { errors: ['Content pack must be a JSON object.'] };
  }

  if (raw.$schema !== CONTENT_SCHEMA) {
    push(`Unexpected $schema ${describeValue(raw.$schema)} — expected "${CONTENT_SCHEMA}".`);
  }
  if (!isNonBlankString(raw.id)) push('Pack is missing a nonblank string "id".');
  if (!isNonBlankString(raw.name)) push('Pack is missing a nonblank string "name".');
  if (!isNonBlankString(raw.version)) push('Pack is missing a nonblank string "version".');

  const checkSection = (section: string, spec: EntrySpec) => {
    const value = (raw as Record<string, unknown>)[section];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      push(`"${section}" must be an array.`);
      return;
    }
    if (value.length > MAX_CONTENT_ENTRIES) {
      push(`"${section}" exceeds the ${MAX_CONTENT_ENTRIES}-entry validation limit.`);
    }
    const ids = new Set<string>();
    value.slice(0, MAX_CONTENT_ENTRIES).forEach((entry, i) => {
      const where = `${section}[${i}]`;
      if (!isObject(entry)) {
        push(`${where} must be an object.`);
        return;
      }
      if (!isNonBlankString(entry.id)) {
        push(`${where} is missing a nonblank string "id".`);
      } else if (ids.has(entry.id)) {
        push(`Duplicate id "${entry.id}" within "${section}".`);
      } else {
        ids.add(entry.id);
      }
      for (const f of spec.strings ?? []) {
        if (!isString(entry[f])) push(`${where} is missing string field "${f}".`);
      }
      for (const f of spec.numbers ?? []) {
        if (!isNumber(entry[f])) push(`${where} is missing numeric field "${f}".`);
      }
      spec.extra?.(entry, where, push);
    });
  };

  checkSection('spells', {
    strings: ['name', 'lore', 'range', 'target', 'duration', 'description'],
    numbers: ['cn'],
  });

  checkSection('prayers', {
    strings: ['name', 'deity', 'range', 'target', 'duration', 'description'],
  });

  checkSection('tables', {
    strings: ['name'],
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.rows)) {
        p(`${where} is missing a "rows" array.`);
        return;
      }
      if (entry.rows.length > MAX_CONTENT_ENTRIES) p(`${where}.rows exceeds the validation limit.`);
      entry.rows.slice(0, MAX_CONTENT_ENTRIES).forEach((row, j) => {
        const rw = `${where}.rows[${j}]`;
        if (!isObject(row)) { p(`${rw} must be an object.`); return; }
        if (!isNumber(row.min)) p(`${rw} missing numeric "min".`);
        if (!isNumber(row.max)) p(`${rw} missing numeric "max".`);
        if (!isString(row.effect)) p(`${rw} missing string "effect".`);
      });
    },
  });

  checkSection('races', {
    strings: ['name', 'description'],
    numbers: ['movement', 'fate', 'resilience', 'extra'],
    extra: (entry, where, p) => {
      if (!isObject(entry.charModifiers)) {
        p(`${where} "charModifiers" must be an object.`);
      } else {
        for (const [key, modifier] of Object.entries(entry.charModifiers)) {
          if (!CHARACTERISTIC_KEYS.has(key) || !isNumber(modifier)) {
            p(`${where} "charModifiers.${key}" must be a finite native characteristic modifier.`);
          }
        }
      }
      if (!isStringArray(entry.skills)) p(`${where} "skills" must be an array of nonblank skill ids.`);
      if (!isStringArray(entry.talents)) p(`${where} "talents" must be an array of nonblank talent ids.`);
      if (entry.size !== undefined && !isNonBlankString(entry.size)) p(`${where} "size" must be a nonblank string.`);
    },
  });

  checkSection('careers', {
    strings: ['name', 'class'],
    extra: (entry, where, p) => {
      if (!isStringArray(entry.species)) p(`${where} "species" must be an array of nonblank race ids.`);
      if (!Array.isArray(entry.ranks)) {
        p(`${where} "ranks" must be an array.`);
        return;
      }
      if (entry.ranks.length > MAX_CONTENT_ENTRIES) p(`${where}.ranks exceeds the validation limit.`);
      entry.ranks.slice(0, MAX_CONTENT_ENTRIES).forEach((rank, j) => {
        const rw = `${where}.ranks[${j}]`;
        if (!isObject(rank)) { p(`${rw} must be an object.`); return; }
        if (!isNumber(rank.level)) p(`${rw} missing numeric "level".`);
        if (!isString(rank.name)) p(`${rw} missing string "name".`);
        if (!isString(rank.status)) p(`${rw} missing string "status".`);
      });
    },
  });

  checkSection('skills', {
    strings: ['name', 'char', 'description'],
    extra: (entry, where, p) => {
      if (typeof entry.advanced !== 'boolean') p(`${where} "advanced" must be a boolean.`);
      if (typeof entry.grouped !== 'boolean') p(`${where} "grouped" must be a boolean.`);
      if (!CHARACTERISTIC_KEYS.has(entry.char as string)) {
        p(`${where} "char" must be a native characteristic key.`);
      }
    },
  });

  checkSection('talents', {
    strings: ['name', 'description'],
  });

  checkSection('weapons', {
    strings: ['name', 'group', 'dmg'],
    numbers: ['enc'],
    extra: (entry, where, p) => {
      if (!isStringArray(entry.qual)) p(`${where} "qual" must be an array of nonblank strings.`);
      if (entry.reach !== undefined && !isString(entry.reach)) p(`${where} "reach" must be a string.`);
      if (entry.range !== undefined && !isString(entry.range)) p(`${where} "range" must be a string.`);
    },
  });

  checkSection('armour', {
    strings: ['name'],
    numbers: ['enc', 'ap'],
    extra: (entry, where, p) => {
      if (!isStringArray(entry.locs)) p(`${where} "locs" must be an array of nonblank locations.`);
      if (!isStringArray(entry.qual)) p(`${where} "qual" must be an array of nonblank strings.`);
    },
  });

  checkSection('trappings', {
    strings: ['name'],
    numbers: ['enc'],
  });

  // conditions: optional string[].
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      push('"conditions" must be an array of strings.');
    } else {
      if (raw.conditions.length > MAX_CONTENT_ENTRIES) push('"conditions" exceeds the validation limit.');
      raw.conditions.slice(0, MAX_CONTENT_ENTRIES).forEach((c, i) => {
        if (!isString(c)) push(`conditions[${i}] must be a string.`);
      });
    }
  }

  // xpCosts: optional [{ range: string, cost: number }].
  if (raw.xpCosts !== undefined) {
    if (!Array.isArray(raw.xpCosts)) {
      push('"xpCosts" must be an array.');
    } else {
      if (raw.xpCosts.length > MAX_CONTENT_ENTRIES) push('"xpCosts" exceeds the validation limit.');
      raw.xpCosts.slice(0, MAX_CONTENT_ENTRIES).forEach((row, i) => {
        const w = `xpCosts[${i}]`;
        if (!isObject(row)) { push(`${w} must be an object.`); return; }
        if (!isString(row.range)) push(`${w} missing string "range".`);
        if (!isNumber(row.cost)) push(`${w} missing numeric "cost".`);
      });
    }
  }

  if (errors.length > 0) return { errors };
  return { pack: raw as unknown as ContentPack, errors: [] };
}
