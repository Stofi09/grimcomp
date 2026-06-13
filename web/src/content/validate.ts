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
  type ConditionDef,
  type ContentPack,
  type XpCostBand,
  type XpCostRow,
} from './types';
import { compileFormula } from '@/utils/formula';

export interface ValidationResult {
  pack?: ContentPack;
  errors: string[];
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';

const HIT_LOCATION_KEYS = ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'];

/** Every top-level key the v2 schema knows about. Others warn (not fail). */
const KNOWN_KEYS = new Set([
  '$schema', 'id', 'name', 'version',
  'spells', 'prayers', 'tables', 'conditions', 'xpCosts', 'xpRules', 'system',
  'characteristics', 'races', 'careers', 'skills', 'talents', 'weapons',
  'armour', 'trappings', 'hitLocations', 'figureLabels', 'criticals',
  'woundsRules', 'deities', 'creation', 'characters', 'xpLogSeeds', 'noteSeeds',
]);

/**
 * Parse a legacy v1 xpCosts table into v2 characteristic-advance bands.
 * Accepts "0–5" (en-dash), "0-5" (hyphen), and the open-ended "46+" form.
 */
export function xpCostRowsToBands(rows: XpCostRow[]): XpCostBand[] {
  const bands: XpCostBand[] = [];
  for (const row of rows) {
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
  const push = (msg: string) => errors.push(msg);

  if (!isObject(raw)) {
    return { errors: ['Content pack must be a JSON object.'], warnings };
  }

  if (raw.$schema !== CONTENT_SCHEMA && raw.$schema !== CONTENT_SCHEMA_V1) {
    push(`Unexpected $schema "${String(raw.$schema)}" — expected "${CONTENT_SCHEMA}" (or legacy "${CONTENT_SCHEMA_V1}").`);
  }
  if (!isString(raw.id)) push('Pack is missing a string "id".');
  if (!isString(raw.name)) push('Pack is missing a string "name".');
  if (!isString(raw.version)) push('Pack is missing a string "version".');

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`Unknown section "${key}" — ignored.`);
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
    value.forEach((entry, i) => {
      const where = `${section}[${i}]`;
      if (!isObject(entry)) {
        push(`${where} must be an object.`);
        return;
      }
      if (spec.requireId !== false) {
        if (!isString(entry.id)) {
          push(`${where} is missing a string "id".`);
        } else if (ids.has(entry.id)) {
          push(`Duplicate id "${entry.id}" within "${section}".`);
        } else {
          ids.add(entry.id);
        }
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

  const checkBands = (value: unknown, where: string) => {
    if (!Array.isArray(value)) {
      push(`"${where}" must be an array.`);
      return;
    }
    value.forEach((band, i) => {
      const w = `${where}[${i}]`;
      if (!isObject(band)) { push(`${w} must be an object.`); return; }
      if (!isNumber(band.min)) push(`${w} missing numeric "min".`);
      if (!isNumber(band.max)) push(`${w} missing numeric "max".`);
      if (!isNumber(band.cost)) push(`${w} missing numeric "cost".`);
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
      if (entry.dice !== undefined) {
        if (!isObject(entry.dice) || !isNumber(entry.dice.count) || !isNumber(entry.dice.sides)) {
          p(`${where} "dice" must be { count, sides }.`);
        }
      }
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
        if (rank.requirements !== undefined) {
          if (!Array.isArray(rank.requirements)) {
            p(`${rw} "requirements" must be an array.`);
            return;
          }
          rank.requirements.forEach((req, k) => {
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

  // Characters carry the full template shape; validate the load-bearing
  // fields rather than the whole structure.
  checkSection('characters', {
    strings: ['name', 'species', 'class', 'career'],
    extra: (entry, where, p) => {
      if (!Array.isArray(entry.characteristics)) p(`${where} "characteristics" must be an array.`);
      if (!Array.isArray(entry.skills)) p(`${where} "skills" must be an array.`);
      if (!Array.isArray(entry.talents)) p(`${where} "talents" must be an array.`);
      if (!Array.isArray(entry.careerRanks)) p(`${where} "careerRanks" must be an array.`);
      if (!isObject(entry.wounds)) p(`${where} "wounds" must be an object.`);
    },
  });

  // conditions: v2 array of { name, penalty?, maxStacks?, description? };
  // v1 plain strings are accepted and normalized below.
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      push('"conditions" must be an array.');
    } else {
      raw.conditions.forEach((c, i) => {
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
      raw.xpCosts.forEach((row, i) => {
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
      for (const f of ['talentCostPerRank', 'careerAdvanceCost', 'nonCareerSkillMultiplier', 'buyStep']) {
        if (xr[f] !== undefined && !isNumber(xr[f])) push(`"xpRules.${f}" must be a number.`);
      }
      if (xr.quickAwards !== undefined) {
        if (!Array.isArray(xr.quickAwards) || xr.quickAwards.some(n => !isNumber(n))) {
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
          if (t.dice !== undefined && (!isObject(t.dice) || !isNumber(t.dice.count) || !isNumber(t.dice.sides))) {
            push('"system.test.dice" must be { count, sides }.');
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
              cur.units.forEach((u, i) => {
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
      for (const [k, v] of Object.entries(raw.figureLabels)) {
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
      if (!Array.isArray(wr.smallSizes) || wr.smallSizes.some(s => !isString(s))) {
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
        for (const f of ['count', 'sides', 'plus']) {
          if (!isNumber((cr.statRoll as Record<string, unknown>)[f])) push(`"creation.statRoll.${f}" must be a number.`);
        }
      }
      if (!Array.isArray(cr.archetypes)) {
        push('"creation.archetypes" must be an array.');
      } else {
        cr.archetypes.forEach((a, i) => {
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
      for (const [charId, entries] of Object.entries(raw.xpLogSeeds)) {
        if (!Array.isArray(entries)) {
          push(`"xpLogSeeds.${charId}" must be an array.`);
          continue;
        }
        entries.forEach((e, i) => {
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
        ns.notes.forEach((n, i) => {
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
        value.forEach((o, i) => {
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
