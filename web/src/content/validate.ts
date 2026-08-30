// Hand-rolled ContentPack validation. Used when loading the bundled packs and
// when importing user content packs so malformed JSON surfaces a readable
// error instead of crashing a screen at render time.
//
// Accepts both schema v2 ('grimcomp.content.v2') and legacy v1 packs
// ('grimcomp.content.v1'); v1 sections are normalized to their v2 shapes:
//   - conditions: string[]  →  ConditionDef[] ({ name })
//   - xpCosts ({ range: '0–5', cost })  →  xpRules.characteristicAdvances bands

import {
  CONTENT_SCHEMA,
  CONTENT_SCHEMA_V1,
  SCREEN_KINDS,
  SCREEN_ENABLED_WHEN_VARS,
  type ConditionDef,
  type ContentPack,
  type XpCostBand,
  type XpCostRow,
} from './types';
import { compileFormula } from '@/utils/formula';
import { validateCharacterTemplate } from './validateCharacter';

export interface ValidationResult {
  pack?: ContentPack;
  errors: string[];
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonBlankString = (v: unknown): v is string => isString(v) && v.trim().length > 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const MAX_CONTENT_ENTRIES = 10_000;
const MAX_VALIDATION_DIAGNOSTICS = 100;
const MAX_DIAGNOSTIC_LENGTH = 500;

function describeValue(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return (encoded === undefined ? typeof value : encoded).slice(0, 200);
  } catch {
    return '<unprintable>';
  }
}

/** A finite number within [min, max]. Bounds dice counts/sides so a tampered or
    malformed pack can't freeze the UI with an enormous roll loop (Number.isFinite
    also rejects NaN/Infinity that would otherwise pass a bare typeof check). */
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const HIT_LOCATION_KEYS = ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'];

/** Sections keyed by a unique entry id — the ones `deletions` can tombstone. */
const ID_KEYED_SECTIONS = new Set<string>([
  'spells', 'prayers', 'tables', 'races', 'careers', 'skills', 'talents',
  'references', 'weapons', 'armour', 'trappings', 'deities', 'characters',
]);

/** Every top-level key the v2 schema knows about. Others warn (not fail). */
const KNOWN_KEYS = new Set([
  '$schema', 'id', 'name', 'version',
  'spells', 'prayers', 'tables', 'conditions', 'xpCosts', 'xpRules', 'system',
  'characteristics', 'races', 'careers', 'skills', 'talents', 'weapons',
  'references', 'armour', 'trappings', 'hitLocations', 'figureLabels', 'criticals',
  'criticalTables', 'woundsRules', 'deities', 'creation', 'characters',
  'xpLogSeeds', 'noteSeeds', 'screens', 'screenGroups', 'resources',
  'capabilities', 'deletions',
]);

/** Known capability flags (others warn — likely a typo). */
const CAPABILITY_KEYS = new Set<string>([
  'faithWrath', 'magicMiscastOnDouble', 'combatHitLocations', 'psychologyCorruption',
]);

// Identifiers a screen `enabledWhen` predicate may reference (the documented
// vars plus the formula language's built-in functions). Anything else warns.
const SCREEN_ENABLED_WHEN_IDENTS = new Set<string>([
  ...SCREEN_ENABLED_WHEN_VARS, 'floor', 'ceil', 'round', 'abs', 'min', 'max',
]);

/**
 * Parse a legacy v1 xpCosts table into v2 characteristic-advance bands.
 * Accepts "0–5" (en-dash), "0-5" (hyphen), and the open-ended "46+" form.
 */
export function xpCostRowsToBands(rows: XpCostRow[]): XpCostBand[] {
  const bands: XpCostBand[] = [];
  for (const row of rows.slice(0, MAX_CONTENT_ENTRIES)) {
    const range = String(row.range).trim();
    const open = range.match(/^(\d+)\s*\+$/);
    if (open) {
      bands.push({ min: parseInt(open[1], 10), max: 999, cost: row.cost });
      continue;
    }
    const pair = range.match(/^(\d+)\s*[–\-—]\s*(\d+)$/);
    if (pair) {
      bands.push({ min: parseInt(pair[1], 10), max: parseInt(pair[2], 10), cost: row.cost });
    }
  }
  return bands;
}

interface EntrySpec {
  /** Required string fields on each entry. */
  strings?: string[];
  /** Required strings that must contain something besides whitespace. */
  nonBlankStrings?: string[];
  /** Required numeric fields on each entry. */
  numbers?: string[];
  /** Entries must carry a unique string id (default true). */
  requireId?: boolean;
  /** Extra per-entry validation. Push errors via `push`. */
  extra?: (entry: Record<string, unknown>, where: string, push: (msg: string) => void) => void;
}

/**
 * Validate an untrusted value as a ContentPack. On success `pack` is set (with
 * v1 sections normalized to v2 shapes); on failure `errors` lists every
 * problem found. `warnings` carries non-fatal notes (unknown sections).
 *
 * Id uniqueness is enforced *per section* — a spell and a prayer may
 * legitimately share an id since the registry keeps them in separate maps.
 */
export function validatePack(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let errorsTruncated = false;
  let warningsTruncated = false;
  const push = (msg: string) => {
    if (errors.length < MAX_VALIDATION_DIAGNOSTICS) {
      errors.push(msg.slice(0, MAX_DIAGNOSTIC_LENGTH));
    } else if (!errorsTruncated) {
      errorsTruncated = true;
      errors[MAX_VALIDATION_DIAGNOSTICS - 1] = 'Additional validation errors were omitted.';
    }
  };
  const warn = (msg: string) => {
    if (warnings.length < MAX_VALIDATION_DIAGNOSTICS) {
      warnings.push(msg.slice(0, MAX_DIAGNOSTIC_LENGTH));
    } else if (!warningsTruncated) {
      warningsTruncated = true;
      warnings[MAX_VALIDATION_DIAGNOSTICS - 1] = 'Additional validation warnings were omitted.';
    }
  };

  if (!isObject(raw)) {
    return { errors: ['Content pack must be a JSON object.'], warnings };
  }

  if (raw.$schema !== CONTENT_SCHEMA && raw.$schema !== CONTENT_SCHEMA_V1) {
    push(`Unexpected $schema ${describeValue(raw.$schema)} — expected "${CONTENT_SCHEMA}" (or legacy "${CONTENT_SCHEMA_V1}").`);
  }
  if (!isNonBlankString(raw.id)) push('Pack is missing a nonblank string "id".');
  if (!isNonBlankString(raw.name)) push('Pack is missing a nonblank string "name".');
  if (!isNonBlankString(raw.version)) push('Pack is missing a nonblank string "version".');

  const limitArray = <T,>(value: readonly T[], where: string): readonly T[] => {
    if (value.length > MAX_CONTENT_ENTRIES) {
      push(`"${where}" exceeds the ${MAX_CONTENT_ENTRIES}-entry validation limit.`);
      return value.slice(0, MAX_CONTENT_ENTRIES);
    }
    return value;
  };
  const limitEntries = (
    value: Record<string, unknown>,
    where: string,
  ): readonly (readonly [string, unknown])[] => {
    const entries = Object.entries(value);
    if (entries.length > MAX_CONTENT_ENTRIES) {
      push(`"${where}" exceeds the ${MAX_CONTENT_ENTRIES}-entry validation limit.`);
      return entries.slice(0, MAX_CONTENT_ENTRIES);
    }
    return entries;
  };

  for (const [key] of limitEntries(raw, 'content pack')) {
    if (!KNOWN_KEYS.has(key)) {
      warn(`Unknown section "${key}" — ignored.`);
    }
  }

  const checkSection = (section: string, spec: EntrySpec) => {
    const value = (raw as Record<string, unknown>)[section];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      push(`"${section}" must be an array.`);
      return;
    }
    const ids = new Set<string>();
    limitArray(value, section).forEach((entry, i) => {
      const where = `${section}[${i}]`;
      if (!isObject(entry)) {
        push(`${where} must be an object.`);
        return;
      }
      if (spec.requireId !== false) {
        if (!isString(entry.id)) {
          push(`${where} is missing a string "id".`);
        } else if (!isNonBlankString(entry.id)) {
          push(`${where} field "id" must not be blank.`);
        } else if (ids.has(entry.id)) {
          push(`Duplicate id "${entry.id}" within "${section}".`);
        } else {
          ids.add(entry.id);
        }
      }
      for (const f of spec.strings ?? []) {
        if (!isString(entry[f])) push(`${where} is missing string field "${f}".`);
      }
      for (const f of spec.nonBlankStrings ?? []) {
        if (!isString(entry[f])) push(`${where} is missing string field "${f}".`);
        else if (!isNonBlankString(entry[f])) push(`${where} field "${f}" must not be blank.`);
      }
      for (const f of spec.numbers ?? []) {
        if (!isNumber(entry[f])) push(`${where} is missing numeric field "${f}".`);
      }
      spec.extra?.(entry, where, push);
    });
  };

  const checkBands = (value: unknown, where: string) => {
    if (!Array.isArray(value)) {
      push(`"${where}" must be an array.`);
      return;
    }
    limitArray(value, where).forEach((band, i) => {
      const w = `${where}[${i}]`;
      if (!isObject(band)) { push(`${w} must be an object.`); return; }
      if (!isNumber(band.min)) push(`${w} missing numeric "min".`);
      if (!isNumber(band.max)) push(`${w} missing numeric "max".`);
      if (!isNumber(band.cost)) push(`${w} missing numeric "cost".`);
    });
  };

  checkSection('spells', {
    nonBlankStrings: ['name', 'lore', 'range', 'target', 'duration', 'description'],
    numbers: ['cn'],
    extra: (entry, where, p) => {
      if (typeof entry.cn === 'number'
        && (!Number.isFinite(entry.cn) || !Number.isInteger(entry.cn) || entry.cn < 0)) {
        p(`${where} "cn" must be a finite integer greater than or equal to 0.`);
      }
      if (entry.damage !== undefined && !isString(entry.damage)) {
        p(`${where} "damage" must be a string when provided.`);
      }
      if (entry.sourceBook !== undefined && !isString(entry.sourceBook)) {
        p(`${where} "sourceBook" must be a string when provided.`);
      }
      if (entry.sourcePage !== undefined
        && (typeof entry.sourcePage !== 'number'
          || !Number.isFinite(entry.sourcePage)
          || !Number.isInteger(entry.sourcePage)
          || entry.sourcePage < 0)) {
        p(`${where} "sourcePage" must be a finite integer greater than or equal to 0 when provided.`);
      }
      if (entry.rulesNote !== undefined && !isString(entry.rulesNote)) {
        p(`${where} "rulesNote" must be a string when provided.`);
      }
      if (entry.rulesStatus !== undefined
        && entry.rulesStatus !== 'bibliographic'
        && entry.rulesStatus !== 'approximate') {
        p(`${where} "rulesStatus" must be "bibliographic" or "approximate" when provided.`);
      }
    },
  });

  checkSection('prayers', {
    strings: ['name', 'deity', 'range', 'target', 'duration', 'description'],
  });

  checkSection('tables', {
    strings: ['name'],
    extra: (entry, where, p) => {
      if (entry.dice !== undefined) {
        if (!isObject(entry.dice) || !inRange(entry.dice.count, 1, 100) || !inRange(entry.dice.sides, 1, 10000)) {
          p(`${where} "dice" must be { count: 1–100, sides: 1–10000 }.`);
        }
      }
      if (!Array.isArray(entry.rows)) {
        p(`${where} is missing a "rows" array.`);
        return;
      }
      limitArray(entry.rows, `${where}.rows`).forEach((row, j) => {
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
      if (entry.advanceScheme !== undefined) {
        const as = entry.advanceScheme;
        if (!isObject(as) || !Array.isArray(as.characteristics)
          || limitArray(as.characteristics, `${where}.advanceScheme.characteristics`).some(k => !isString(k))) {
          p(`${where} "advanceScheme.characteristics" must be an array of characteristic keys.`);
        } else if (isObject(as) && as.skills !== undefined && (!Array.isArray(as.skills)
          || limitArray(as.skills, `${where}.advanceScheme.skills`).some(s => !isString(s)))) {
          p(`${where} "advanceScheme.skills" must be an array of skill names.`);
        } else if (isObject(as) && as.talents !== undefined && (!Array.isArray(as.talents)
          || limitArray(as.talents, `${where}.advanceScheme.talents`).some(t => !isString(t)))) {
          p(`${where} "advanceScheme.talents" must be an array of talent names.`);
        }
      }
      if (entry.approximate !== undefined && typeof entry.approximate !== 'boolean') {
        p(`${where} "approximate" must be a boolean.`);
      }
      if (entry.sourceBook !== undefined && !isString(entry.sourceBook)) {
        p(`${where} "sourceBook" must be a string when provided.`);
      }
      if (entry.sourcePage !== undefined
        && (typeof entry.sourcePage !== 'number'
          || !Number.isFinite(entry.sourcePage)
          || !Number.isInteger(entry.sourcePage)
          || entry.sourcePage < 0)) {
        p(`${where} "sourcePage" must be a finite integer greater than or equal to 0 when provided.`);
      }
      if (entry.rulesNote !== undefined && !isString(entry.rulesNote)) {
        p(`${where} "rulesNote" must be a string when provided.`);
      }
      if (entry.rulesStatus !== undefined
        && entry.rulesStatus !== 'bibliographic'
        && entry.rulesStatus !== 'approximate') {
        p(`${where} "rulesStatus" must be "bibliographic" or "approximate" when provided.`);
      }
      if (entry.creationAvailable !== undefined && typeof entry.creationAvailable !== 'boolean') {
        p(`${where} "creationAvailable" must be a boolean when provided.`);
      }
      if (entry.randomEligible !== undefined && typeof entry.randomEligible !== 'boolean') {
        p(`${where} "randomEligible" must be a boolean when provided.`);
      }
      if (entry.magicAccess !== undefined
        && entry.magicAccess !== 'none'
        && entry.magicAccess !== 'starting'
        && entry.magicAccess !== 'later') {
        p(`${where} "magicAccess" must be "none", "starting", or "later" when provided.`);
      }
      if (!Array.isArray(entry.ranks)) {
        p(`${where} "ranks" must be an array.`);
        return;
      }
      limitArray(entry.ranks, `${where}.ranks`).forEach((rank, j) => {
        const rw = `${where}.ranks[${j}]`;
        if (!isObject(rank)) { p(`${rw} must be an object.`); return; }
        if (!isNumber(rank.level)) p(`${rw} missing numeric "level".`);
        if (!isString(rank.name)) p(`${rw} missing string "name".`);
        if (!isString(rank.status)) p(`${rw} missing string "status".`);
        if (rank.requirements !== undefined) {
          if (!Array.isArray(rank.requirements)) {
            p(`${rw} "requirements" must be an array.`);
            return;
          }
          limitArray(rank.requirements, `${rw}.requirements`).forEach((req, k) => {
            const qw = `${rw}.requirements[${k}]`;
            if (!isObject(req)) { p(`${qw} must be an object.`); return; }
            if (!isString(req.skill)) p(`${qw} missing string "skill".`);
            if (!isNumber(req.min)) p(`${qw} missing numeric "min".`);
          });
        }
      });
    },
  });

  checkSection('skills', {
    nonBlankStrings: ['name', 'char', 'description'],
    extra: (entry, where, p) => {
      if (typeof entry.advanced !== 'boolean') p(`${where} "advanced" must be a boolean.`);
      if (typeof entry.grouped !== 'boolean') p(`${where} "grouped" must be a boolean.`);
      if (entry.sourceBook !== undefined && !isString(entry.sourceBook)) {
        p(`${where} "sourceBook" must be a string when provided.`);
      }
      if (entry.sourcePage !== undefined
        && (typeof entry.sourcePage !== 'number'
          || !Number.isFinite(entry.sourcePage)
          || !Number.isInteger(entry.sourcePage)
          || entry.sourcePage < 0)) {
        p(`${where} "sourcePage" must be a finite integer greater than or equal to 0 when provided.`);
      }
      if (entry.rulesNote !== undefined && !isString(entry.rulesNote)) {
        p(`${where} "rulesNote" must be a string when provided.`);
      }
      if (entry.restriction !== undefined && !isNonBlankString(entry.restriction)) {
        p(`${where} "restriction" must be a nonblank string when provided.`);
      }
      if (entry.exclusiveWith !== undefined) {
        if (!Array.isArray(entry.exclusiveWith)
          || limitArray(entry.exclusiveWith, `${where}.exclusiveWith`).some(value => !isNonBlankString(value))) {
          p(`${where} "exclusiveWith" must be an array of nonblank skill ids when provided.`);
        } else if (new Set(entry.exclusiveWith.map(value => value.trim())).size
          !== entry.exclusiveWith.length) {
          p(`${where} "exclusiveWith" must not contain duplicate skill ids.`);
        }
      }
      if (entry.rulesStatus !== undefined
        && entry.rulesStatus !== 'bibliographic'
        && entry.rulesStatus !== 'approximate') {
        p(`${where} "rulesStatus" must be "bibliographic" or "approximate" when provided.`);
      }
    },
  });

  checkSection('talents', {
    nonBlankStrings: ['name', 'description'],
    extra: (entry, where, p) => {
      if (entry.max !== undefined
        && (typeof entry.max !== 'number'
          || !Number.isFinite(entry.max)
          || !Number.isInteger(entry.max)
          || entry.max < 1)) {
        p(`${where} "max" must be a finite integer greater than or equal to 1.`);
      }
      if (entry.maxChar !== undefined && !isString(entry.maxChar)) p(`${where} "maxChar" must be a characteristic key.`);
      if (entry.tests !== undefined && !isNonBlankString(entry.tests)) {
        p(`${where} "tests" must be a nonblank string when provided.`);
      }
      if (entry.specializations !== undefined) {
        if (!Array.isArray(entry.specializations)
          || entry.specializations.length === 0
          || limitArray(entry.specializations, `${where}.specializations`).some(value => !isNonBlankString(value))) {
          p(`${where} "specializations" must be a nonempty array of nonblank strings when provided.`);
        } else if (new Set(entry.specializations.map(value => value.trim().toLocaleLowerCase())).size
          !== entry.specializations.length) {
          p(`${where} "specializations" must not contain duplicate values.`);
        }
      }
      if (entry.restriction !== undefined && !isNonBlankString(entry.restriction)) {
        p(`${where} "restriction" must be a nonblank string when provided.`);
      }
      if (entry.sourceBook !== undefined && !isString(entry.sourceBook)) {
        p(`${where} "sourceBook" must be a string when provided.`);
      }
      if (entry.sourcePage !== undefined
        && (typeof entry.sourcePage !== 'number'
          || !Number.isFinite(entry.sourcePage)
          || !Number.isInteger(entry.sourcePage)
          || entry.sourcePage < 0)) {
        p(`${where} "sourcePage" must be a finite integer greater than or equal to 0 when provided.`);
      }
      if (entry.rulesNote !== undefined && !isString(entry.rulesNote)) {
        p(`${where} "rulesNote" must be a string when provided.`);
      }
      if (entry.rulesStatus !== undefined
        && entry.rulesStatus !== 'bibliographic'
        && entry.rulesStatus !== 'approximate') {
        p(`${where} "rulesStatus" must be "bibliographic" or "approximate" when provided.`);
      }
    },
  });

  checkSection('references', {
    strings: ['category', 'name', 'description'],
    extra: (entry, where, p) => {
      if (entry.meta !== undefined && !isString(entry.meta)) p(`${where} "meta" must be a string.`);
      if (entry.approximate !== undefined && typeof entry.approximate !== 'boolean') {
        p(`${where} "approximate" must be a boolean.`);
      }
    },
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

  checkSection('deities', {
    strings: ['name', 'epithet', 'dogma'],
  });

  // Characteristic keys are open strings — the roster defines the stat set,
  // so any game system's characteristics are valid.
  checkSection('characteristics', {
    strings: ['key', 'name', 'short'],
    requireId: false,
  });

  checkSection('hitLocations', {
    strings: ['key', 'label'],
    numbers: ['min', 'max'],
    requireId: false,
    extra: (entry, where, p) => {
      if (isString(entry.key) && !HIT_LOCATION_KEYS.includes(entry.key)) {
        p(`${where} "key" must be one of ${HIT_LOCATION_KEYS.join('|')}.`);
      }
    },
  });

  checkSection('criticals', {
    strings: ['name', 'effect'],
    numbers: ['days'],
    requireId: false,
  });

  // criticalTables: location-keyed d100 tables of { min, max, name, effect, days }.
  checkSection('criticalTables', {
    requireId: false,
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.locations)
        || limitArray(entry.locations, `${where}.locations`).some(k => !isString(k) || !HIT_LOCATION_KEYS.includes(k))) {
        p(`${where} "locations" must be an array of ${HIT_LOCATION_KEYS.join('|')}.`);
      }
      if (!Array.isArray(entry.rows)) {
        p(`${where} is missing a "rows" array.`);
        return;
      }
      limitArray(entry.rows, `${where}.rows`).forEach((row, j) => {
        const rw = `${where}.rows[${j}]`;
        if (!isObject(row)) { p(`${rw} must be an object.`); return; }
        if (!isNumber(row.min)) p(`${rw} missing numeric "min".`);
        if (!isNumber(row.max)) p(`${rw} missing numeric "max".`);
        if (!isString(row.name)) p(`${rw} missing string "name".`);
        if (!isString(row.effect)) p(`${rw} missing string "effect".`);
        if (!isNumber(row.days)) p(`${rw} missing numeric "days".`);
      });
    },
  });

  // Character templates are consumed directly by roster/state hooks, so a
  // malformed nested value must be rejected at the pack boundary.
  checkSection('characters', {
    extra: (entry, where, p) => {
      for (const error of validateCharacterTemplate(entry, where)) p(error);
    },
  });

  // conditions: v2 array of { name, penalty?, maxStacks?, description? };
  // v1 plain strings are accepted and normalized below.
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      push('"conditions" must be an array.');
    } else {
      limitArray(raw.conditions, 'conditions').forEach((c, i) => {
        const w = `conditions[${i}]`;
        if (isString(c)) return; // legacy v1 entry
        if (!isObject(c)) { push(`${w} must be a string or an object.`); return; }
        if (!isString(c.name)) push(`${w} missing string "name".`);
        if (c.penalty !== undefined && !isNumber(c.penalty)) push(`${w} "penalty" must be a number.`);
        if (c.maxStacks !== undefined && !isNumber(c.maxStacks)) push(`${w} "maxStacks" must be a number.`);
        if (c.description !== undefined && !isString(c.description)) push(`${w} "description" must be a string.`);
        if (c.clearsAtSceneEnd !== undefined && typeof c.clearsAtSceneEnd !== 'boolean') push(`${w} "clearsAtSceneEnd" must be a boolean.`);
      });
    }
  }

  // xpCosts: legacy v1 table [{ range: string, cost: number }].
  if (raw.xpCosts !== undefined) {
    if (!Array.isArray(raw.xpCosts)) {
      push('"xpCosts" must be an array.');
    } else {
      limitArray(raw.xpCosts, 'xpCosts').forEach((row, i) => {
        const w = `xpCosts[${i}]`;
        if (!isObject(row)) { push(`${w} must be an object.`); return; }
        if (!isString(row.range)) push(`${w} missing string "range".`);
        if (!isNumber(row.cost)) push(`${w} missing numeric "cost".`);
      });
    }
  }

  // xpRules: partial overlay object.
  if (raw.xpRules !== undefined) {
    if (!isObject(raw.xpRules)) {
      push('"xpRules" must be an object.');
    } else {
      const xr = raw.xpRules;
      if (xr.characteristicAdvances !== undefined) checkBands(xr.characteristicAdvances, 'xpRules.characteristicAdvances');
      if (xr.skillAdvances !== undefined) checkBands(xr.skillAdvances, 'xpRules.skillAdvances');
      for (const f of ['talentCostPerRank', 'careerAdvanceCost', 'nonCareerSkillMultiplier', 'nonCareerCharacteristicMultiplier', 'buyStep']) {
        if (xr[f] !== undefined && !isNumber(xr[f])) push(`"xpRules.${f}" must be a number.`);
      }
      if (xr.quickAwards !== undefined) {
        if (!Array.isArray(xr.quickAwards)
          || limitArray(xr.quickAwards, 'xpRules.quickAwards').some(n => !isNumber(n))) {
          push('"xpRules.quickAwards" must be an array of numbers.');
        }
      }
    }
  }

  // system: partial overlay of game-system mechanics. Formulas are compiled
  // here so a typo fails the import instead of breaking a screen at render.
  if (raw.system !== undefined) {
    if (!isObject(raw.system)) {
      push('"system" must be an object.');
    } else {
      const sys = raw.system;
      // Optional test fields accept an explicit null, which removes the value
      // inherited from earlier packs (JSON has no way to write undefined).
      const checkFormula = (value: unknown, where: string, nullable = false) => {
        if (value === undefined || (nullable && value === null)) return;
        if (!isString(value)) { push(`"${where}" must be a formula string.`); return; }
        try {
          compileFormula(value);
        } catch (e) {
          push(`"${where}": ${e instanceof Error ? e.message : 'invalid formula.'}`);
        }
      };
      const checkBand = (value: unknown, where: string) => {
        if (value === undefined || value === null) return;
        if (!isObject(value) || !isNumber(value.min) || !isNumber(value.max)) {
          push(`"${where}" must be { min, max } (or null to remove it).`);
        }
      };
      const checkStrings = (section: unknown, where: string, fields: string[]) => {
        if (section === undefined) return false;
        if (!isObject(section)) { push(`"${where}" must be an object.`); return false; }
        for (const f of fields) {
          if (section[f] !== undefined && !isString(section[f])) push(`"${where}.${f}" must be a string.`);
        }
        return true;
      };

      if (sys.test !== undefined) {
        if (!isObject(sys.test)) {
          push('"system.test" must be an object.');
        } else {
          const t = sys.test;
          if (t.dice !== undefined && (!isObject(t.dice) || !inRange(t.dice.count, 1, 100) || !inRange(t.dice.sides, 1, 10000))) {
            push('"system.test.dice" must be { count: 1–100, sides: 1–10000 }.');
          }
          if (t.direction !== undefined && t.direction !== 'under' && t.direction !== 'over') {
            push('"system.test.direction" must be "under" or "over".');
          }
          checkBand(t.autoSuccess, 'system.test.autoSuccess');
          checkBand(t.autoFailure, 'system.test.autoFailure');
          checkBand(t.targetClamp, 'system.test.targetClamp');
          if (t.doubles !== undefined && t.doubles !== null && typeof t.doubles !== 'boolean') {
            push('"system.test.doubles" must be a boolean.');
          }
          checkFormula(t.sl, 'system.test.sl', true);
        }
      }

      if (sys.formulas !== undefined) {
        if (!isObject(sys.formulas)) {
          push('"system.formulas" must be an object.');
        } else {
          for (const f of ['bonus', 'maxWounds', 'walk', 'run', 'maxEncumbrance', 'corruptionThreshold', 'restRecovery']) {
            checkFormula(sys.formulas[f], `system.formulas.${f}`);
          }
        }
      }

      if (sys.currency !== undefined) {
        if (!isObject(sys.currency)) {
          push('"system.currency" must be an object.');
        } else {
          const cur = sys.currency;
          if (cur.baseLabel !== undefined && !isString(cur.baseLabel)) push('"system.currency.baseLabel" must be a string.');
          if (cur.units !== undefined) {
            if (!Array.isArray(cur.units)) {
              push('"system.currency.units" must be an array.');
            } else {
              limitArray(cur.units, 'system.currency.units').forEach((u, i) => {
                const w = `system.currency.units[${i}]`;
                if (!isObject(u)) { push(`${w} must be an object.`); return; }
                if (!isString(u.key)) push(`${w} missing string "key".`);
                if (!isString(u.label)) push(`${w} missing string "label".`);
                if (!isNumber(u.factor)) push(`${w} missing numeric "factor".`);
              });
            }
          }
        }
      }

      checkStrings(sys.magic, 'system.magic',
        ['channellingSkillPrefix', 'castSkill', 'channelChar', 'castChar', 'minorMiscastTable', 'majorMiscastTable']);
      if (checkStrings(sys.faith, 'system.faith', ['praySkill', 'prayChar', 'wrathTable'])) {
        const f = sys.faith as Record<string, unknown>;
        if (f.wrathBonusPerSin !== undefined && !isNumber(f.wrathBonusPerSin)) {
          push('"system.faith.wrathBonusPerSin" must be a number.');
        }
      }
      if (checkStrings(sys.combat, 'system.combat',
        ['rangedGroupPattern', 'meleeChar', 'rangedChar', 'meleeSkillPattern', 'rangedSkillPattern'])) {
        // The pattern is executed as a regex at render time — compile it here
        // so a malformed one fails the import instead of crashing Combat.
        const pattern = (sys.combat as Record<string, unknown>).rangedGroupPattern;
        if (isString(pattern)) {
          try {
            new RegExp(pattern, 'i');
          } catch (e) {
            push(`"system.combat.rangedGroupPattern": ${e instanceof Error ? e.message : 'invalid regular expression.'}`);
          }
        }
      }
    }
  }

  // figureLabels: { head: 'FEJ', … }.
  if (raw.figureLabels !== undefined) {
    if (!isObject(raw.figureLabels)) {
      push('"figureLabels" must be an object.');
    } else {
      for (const [k, v] of limitEntries(raw.figureLabels, 'figureLabels')) {
        if (!HIT_LOCATION_KEYS.includes(k)) push(`"figureLabels" has unknown location key "${k}".`);
        if (!isString(v)) push(`"figureLabels.${k}" must be a string.`);
      }
    }
  }

  // woundsRules: { smallSizes: string[], bonusTalent: string }.
  if (raw.woundsRules !== undefined) {
    if (!isObject(raw.woundsRules)) {
      push('"woundsRules" must be an object.');
    } else {
      const wr = raw.woundsRules;
      if (!Array.isArray(wr.smallSizes)
        || limitArray(wr.smallSizes, 'woundsRules.smallSizes').some(s => !isString(s))) {
        push('"woundsRules.smallSizes" must be an array of strings.');
      }
      if (!isString(wr.bonusTalent)) push('"woundsRules.bonusTalent" must be a string.');
    }
  }

  // creation: singleton char-creation config.
  if (raw.creation !== undefined) {
    if (!isObject(raw.creation)) {
      push('"creation" must be an object.');
    } else {
      const cr = raw.creation;
      if (!isObject(cr.statRoll)) {
        push('"creation.statRoll" must be an object.');
      } else {
        // count is looped per characteristic at roll time — bound it so a huge
        // value can't freeze character creation.
        const sr = cr.statRoll as Record<string, unknown>;
        if (!inRange(sr.count, 0, 100)) push('"creation.statRoll.count" must be a number 0–100.');
        if (!inRange(sr.sides, 1, 10000)) push('"creation.statRoll.sides" must be a number 1–10000.');
        if (!inRange(sr.plus, -100000, 100000)) push('"creation.statRoll.plus" must be a finite number.');
      }
      if (!Array.isArray(cr.archetypes)) {
        push('"creation.archetypes" must be an array.');
      } else {
        limitArray(cr.archetypes, 'creation.archetypes').forEach((a, i) => {
          const w = `creation.archetypes[${i}]`;
          if (!isObject(a)) { push(`${w} must be an object.`); return; }
          for (const f of ['key', 'label', 'blurb', 'icon', 'templateId', 'careerId', 'accent']) {
            if (!isString(a[f])) push(`${w} missing string field "${f}".`);
          }
        });
      }
      if (!isObject(cr.defaults)) {
        push('"creation.defaults" must be an object.');
      } else {
        if (!isString((cr.defaults as Record<string, unknown>).species)) push('"creation.defaults.species" must be a string.');
        if (!isString((cr.defaults as Record<string, unknown>).archetype)) push('"creation.defaults.archetype" must be a string.');
      }
      if (!isString(cr.pettyLore)) push('"creation.pettyLore" must be a string.');
      if (!isString(cr.anyDeity)) push('"creation.anyDeity" must be a string.');
    }
  }

  // xpLogSeeds: Record<charId, XpEntry[]>.
  if (raw.xpLogSeeds !== undefined) {
    if (!isObject(raw.xpLogSeeds)) {
      push('"xpLogSeeds" must be an object keyed by character id.');
    } else {
      for (const [charId, entries] of limitEntries(raw.xpLogSeeds, 'xpLogSeeds')) {
        if (!Array.isArray(entries)) {
          push(`"xpLogSeeds.${charId}" must be an array.`);
          continue;
        }
        limitArray(entries, `xpLogSeeds.${charId}`).forEach((e, i) => {
          const w = `xpLogSeeds.${charId}[${i}]`;
          if (!isObject(e)) { push(`${w} must be an object.`); return; }
          if (!isString(e.date)) push(`${w} missing string "date".`);
          if (!isString(e.reason)) push(`${w} missing string "reason".`);
          if (!isNumber(e.amount)) push(`${w} missing numeric "amount".`);
          if (!isString(e.kind)) push(`${w} missing string "kind".`);
        });
      }
    }
  }

  // noteSeeds: { notes, categories, srcOptions }.
  if (raw.noteSeeds !== undefined) {
    if (!isObject(raw.noteSeeds)) {
      push('"noteSeeds" must be an object.');
    } else {
      const ns = raw.noteSeeds;
      if (!Array.isArray(ns.notes)) {
        push('"noteSeeds.notes" must be an array.');
      } else {
        limitArray(ns.notes, 'noteSeeds.notes').forEach((n, i) => {
          const w = `noteSeeds.notes[${i}]`;
          if (!isObject(n)) { push(`${w} must be an object.`); return; }
          for (const f of ['cat', 'title', 'src', 'body']) {
            if (!isString(n[f])) push(`${w} missing string field "${f}".`);
          }
        });
      }
      const checkOptions = (value: unknown, where: string) => {
        if (value === undefined) return;
        if (!Array.isArray(value)) { push(`"${where}" must be an array.`); return; }
        limitArray(value, where).forEach((o, i) => {
          const w = `${where}[${i}]`;
          if (!isObject(o)) { push(`${w} must be an object.`); return; }
          if (!isString(o.value)) push(`${w} missing string "value".`);
          if (!isString(o.label)) push(`${w} missing string "label".`);
        });
      };
      checkOptions(ns.categories, 'noteSeeds.categories');
      checkOptions(ns.srcOptions, 'noteSeeds.srcOptions');
    }
  }

  // screenGroups: [{ id, label }].
  if (raw.screenGroups !== undefined) {
    if (!Array.isArray(raw.screenGroups)) {
      push('"screenGroups" must be an array.');
    } else {
      limitArray(raw.screenGroups, 'screenGroups').forEach((g, i) => {
        const w = `screenGroups[${i}]`;
        if (!isObject(g)) { push(`${w} must be an object.`); return; }
        if (!isString(g.id)) push(`${w} missing string "id".`);
        if (!isString(g.label)) push(`${w} missing string "label".`);
      });
    }
  }

  // screens: [{ id, kind, label, group, icon?, enabledWhen?, hideFromNav?, badge? }].
  if (raw.screens !== undefined) {
    if (!Array.isArray(raw.screens)) {
      push('"screens" must be an array.');
    } else {
      const ids = new Set<string>();
      limitArray(raw.screens, 'screens').forEach((s, i) => {
        const w = `screens[${i}]`;
        if (!isObject(s)) { push(`${w} must be an object.`); return; }
        if (!isString(s.id)) {
          push(`${w} missing string "id".`);
        } else if (ids.has(s.id)) {
          push(`Duplicate id "${s.id}" within "screens".`);
        } else {
          ids.add(s.id);
        }
        if (!isString(s.kind)) push(`${w} missing string "kind".`);
        else if (!(SCREEN_KINDS as readonly string[]).includes(s.kind)) {
          push(`${w} has unknown kind "${s.kind}".`);
        }
        if (!isString(s.label)) push(`${w} missing string "label".`);
        if (!isString(s.group)) push(`${w} missing string "group".`);
        if (s.icon !== undefined && !isString(s.icon)) push(`${w} "icon" must be a string.`);
        if (s.badge !== undefined && !isString(s.badge)) push(`${w} "badge" must be a string.`);
        if (s.hideFromNav !== undefined && typeof s.hideFromNav !== 'boolean') {
          push(`${w} "hideFromNav" must be a boolean.`);
        }
        if (s.enabledWhen !== undefined) {
          if (!isString(s.enabledWhen)) {
            push(`${w} "enabledWhen" must be a formula string.`);
          } else {
            try {
              compileFormula(s.enabledWhen);
            } catch (e) {
              push(`${w} "enabledWhen": ${e instanceof Error ? e.message : 'invalid formula.'}`);
            }
            // Unknown identifiers compile fine but evaluate to 0 at runtime,
            // silently hiding the screen — warn so typos are caught.
            const idents = s.enabledWhen.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
            for (const ident of limitArray(idents, `${w}.enabledWhen identifiers`)) {
              if (!SCREEN_ENABLED_WHEN_IDENTS.has(ident)) {
                warn(
                  `${w} "enabledWhen" references unknown variable "${ident}" (evaluates to 0). Allowed: ${SCREEN_ENABLED_WHEN_VARS.join(', ')}.`,
                );
              }
            }
          }
        }
      });
    }
  }

  // capabilities: { faithWrath?: boolean, … }.
  if (raw.capabilities !== undefined) {
    if (!isObject(raw.capabilities)) {
      push('"capabilities" must be an object.');
    } else {
      for (const [k, v] of limitEntries(raw.capabilities, 'capabilities')) {
        if (!CAPABILITY_KEYS.has(k)) {
          warn(`"capabilities" has unknown flag "${k}" — ignored.`);
        } else if (typeof v !== 'boolean') {
          push(`"capabilities.${k}" must be a boolean.`);
        }
      }
    }
  }

  // resources: [{ id, label, capBy?, refreshTo? }].
  if (raw.resources !== undefined) {
    if (!Array.isArray(raw.resources)) {
      push('"resources" must be an array.');
    } else {
      const ids = new Set<string>();
      const limitedResources = limitArray(raw.resources, 'resources');
      limitedResources.forEach((r, i) => {
        const w = `resources[${i}]`;
        if (!isObject(r)) { push(`${w} must be an object.`); return; }
        if (!isString(r.id)) {
          push(`${w} missing string "id".`);
        } else if (ids.has(r.id)) {
          push(`Duplicate id "${r.id}" within "resources".`);
        } else {
          ids.add(r.id);
        }
        if (!isString(r.label)) push(`${w} missing string "label".`);
        if (r.capBy !== undefined && !isString(r.capBy)) push(`${w} "capBy" must be a string.`);
        if (r.refreshTo !== undefined && r.refreshTo !== 'cap') push(`${w} "refreshTo" must be "cap".`);
      });
      // capBy must point at a real pool, or the cap silently behaves as 0.
      limitedResources.forEach((r, i) => {
        if (isObject(r) && isString(r.capBy) && !ids.has(r.capBy)) {
          warn(`resources[${i}] "capBy" references unknown resource "${r.capBy}".`);
        }
      });
    }
  }

  // deletions: { <section>: string[] } — tombstones applied after all packs
  // merge, so a pack can remove a bundled entry by id.
  if (raw.deletions !== undefined) {
    if (!isObject(raw.deletions)) {
      push('"deletions" must be an object keyed by section.');
    } else {
      for (const [section, ids] of limitEntries(raw.deletions, 'deletions')) {
        if (!ID_KEYED_SECTIONS.has(section)) {
          warn(`"deletions" has unknown section "${section}" — ignored.`);
        }
        if (!Array.isArray(ids)
          || limitArray(ids, `deletions.${section}`).some(x => !isString(x))) {
          push(`"deletions.${section}" must be an array of string ids.`);
        }
      }
    }
  }

  // A declared-but-empty (or entirely hidden) screens section would otherwise
  // yield an empty rail with no feedback. The registry falls back to the
  // built-in nav for an empty array; warn either way so the author knows.
  if (Array.isArray(raw.screens)) {
    if (raw.screens.length === 0) {
      warn('"screens" is empty — the built-in navigation will be used instead.');
    } else if (!limitArray(raw.screens, 'screens').some(s => isObject(s) && s.hideFromNav !== true)) {
      warn('"screens" has no visible (non-hidden) entries — the rail will be empty.');
    }
  }

  if (errors.length > 0) return { errors, warnings };

  // --- Normalization: produce a v2-shaped pack. ---
  const pack = { ...raw } as Record<string, unknown>;

  if (Array.isArray(raw.conditions)) {
    pack.conditions = (raw.conditions as Array<string | ConditionDef>).map(c =>
      isString(c) ? { name: c } : c,
    );
  }

  if (Array.isArray(raw.xpCosts) && raw.xpRules === undefined) {
    const bands = xpCostRowsToBands(raw.xpCosts as unknown as XpCostRow[]);
    if (bands.length > 0) {
      pack.xpRules = { characteristicAdvances: bands };
    }
  }

  return { pack: pack as unknown as ContentPack, errors: [], warnings };
}
