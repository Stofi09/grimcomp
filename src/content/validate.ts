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
const isNumber = (v: unknown): v is number => typeof v === 'number';

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
  const push = (msg: string) => errors.push(msg);

  if (!isObject(raw)) {
    return { errors: ['Content pack must be a JSON object.'] };
  }

  if (raw.$schema !== CONTENT_SCHEMA) {
    push(`Unexpected $schema "${String(raw.$schema)}" — expected "${CONTENT_SCHEMA}".`);
  }
  if (!isString(raw.id)) push('Pack is missing a string "id".');
  if (!isString(raw.name)) push('Pack is missing a string "name".');
  if (!isString(raw.version)) push('Pack is missing a string "version".');

  const checkSection = (section: string, spec: EntrySpec) => {
    const value = (raw as Record<string, unknown>)[section];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      push(`"${section}" must be an array.`);
      return;
    }
    const ids = new Set<string>();
    value.forEach((entry, i) => {
      const where = `${section}[${i}]`;
      if (!isObject(entry)) {
        push(`${where} must be an object.`);
        return;
      }
      if (!isString(entry.id)) {
        push(`${where} is missing a string "id".`);
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
      entry.rows.forEach((row, j) => {
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
      }
      if (!Array.isArray(entry.skills)) p(`${where} "skills" must be an array of skill ids.`);
      if (!Array.isArray(entry.talents)) p(`${where} "talents" must be an array of talent ids.`);
    },
  });

  checkSection('careers', {
    strings: ['name', 'class'],
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.species)) p(`${where} "species" must be an array of race ids.`);
      if (!Array.isArray(entry.ranks)) {
        p(`${where} "ranks" must be an array.`);
        return;
      }
      entry.ranks.forEach((rank, j) => {
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
    },
  });

  checkSection('talents', {
    strings: ['name', 'description'],
  });

  checkSection('weapons', {
    strings: ['name', 'group', 'dmg'],
    numbers: ['enc'],
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.qual)) p(`${where} "qual" must be an array.`);
    },
  });

  checkSection('armour', {
    strings: ['name'],
    numbers: ['enc', 'ap'],
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.locs)) p(`${where} "locs" must be an array of locations.`);
      if (!Array.isArray(entry.qual)) p(`${where} "qual" must be an array.`);
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
      raw.conditions.forEach((c, i) => {
        if (!isString(c)) push(`conditions[${i}] must be a string.`);
      });
    }
  }

  // xpCosts: optional [{ range: string, cost: number }].
  if (raw.xpCosts !== undefined) {
    if (!Array.isArray(raw.xpCosts)) {
      push('"xpCosts" must be an array.');
    } else {
      raw.xpCosts.forEach((row, i) => {
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
