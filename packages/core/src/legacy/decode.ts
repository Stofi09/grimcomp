import {
  decodeFailure,
  decodeSuccess,
  hasErrorDiagnostics,
  makeDiagnostic,
  type DecodeResult,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticPathSegment,
} from '../diagnostics';
import {
  DecodeContext,
  readExtensionRecord,
  safeRecord,
} from '../decodeSupport';
import type { ExtensionRecord, JsonValue } from '../types';

type Path = readonly DiagnosticPathSegment[];
type JsonRecord = Record<string, JsonValue>;

export interface LegacyCareerRankSnapshot {
  readonly level: number;
  readonly name: string;
  readonly status: string;
}

export interface LegacyCharacteristicSnapshot {
  readonly key: string;
  readonly name: string;
  readonly short: string;
  readonly init: number;
  readonly adv: number;
}

export interface LegacySkillSnapshot {
  readonly definitionId?: string;
  readonly name: string;
  readonly char: string;
  readonly adv: number;
  readonly career: boolean;
  readonly advanced?: boolean;
  readonly grouped?: string;
}

export interface LegacyTalentSnapshot {
  readonly definitionId?: string;
  readonly specialization?: string;
  readonly name: string;
  readonly times: number;
  readonly desc?: string;
  readonly career?: boolean;
}

export interface LegacyXpEntrySnapshot {
  readonly date: string;
  readonly reason: string;
  readonly amount: number;
  readonly kind?: string;
  readonly entityKey?: string;
}

export interface LegacyXpSnapshot {
  readonly current: number;
  readonly spent: number;
  readonly log: readonly LegacyXpEntrySnapshot[];
}

export interface LegacyCharacterSnapshot {
  readonly id: string;
  readonly name: string;
  readonly species: string;
  readonly raceId?: string;
  readonly class: string;
  readonly careerId?: string;
  readonly career: string;
  readonly careerLevel: number;
  readonly careerLevelName: string;
  readonly careerRanks: readonly LegacyCareerRankSnapshot[];
  readonly status: string;
  readonly age: number;
  readonly height: string;
  readonly hair: string;
  readonly eyes: string;
  readonly motivation: string;
  readonly fate: number;
  readonly fortune: number;
  readonly resilience: number;
  readonly resolve: number;
  readonly xpCurrent: number;
  readonly xpSpent: number;
  readonly wounds: { readonly current: number; readonly max: number };
  readonly corruption: number;
  readonly sin: number;
  readonly movement: number;
  readonly wealth: Readonly<Record<string, number>>;
  readonly characteristics: readonly LegacyCharacteristicSnapshot[];
  readonly skills: readonly LegacySkillSnapshot[];
  readonly talents: readonly LegacyTalentSnapshot[];
  readonly weapons: readonly JsonRecord[];
  readonly armour: readonly JsonRecord[];
  readonly ap: Readonly<Record<string, number>>;
  readonly conditions: readonly JsonRecord[];
  readonly criticals: readonly JsonRecord[];
  readonly trappings: readonly JsonRecord[];
  readonly party: JsonRecord;
  readonly psychology: readonly string[];
  readonly mutations: readonly JsonRecord[];
  readonly ambitionsShort: string;
  readonly ambitionsLong: string;
  readonly initials: string;
  readonly accent: string;
  readonly isCaster?: boolean;
  readonly isAnointed?: boolean;
  readonly knownSpells?: readonly string[];
  readonly knownPrayers?: readonly string[];
  readonly deity?: string;
  readonly spellLore?: string;
}

export interface LegacyIdentityOverlaySnapshot {
  readonly name?: string;
  readonly age?: number;
  readonly height?: string;
  readonly hair?: string;
  readonly eyes?: string;
  readonly motivation?: string;
  readonly ambitionsShort?: string;
  readonly ambitionsLong?: string;
}

export interface DecodedLegacyOverlays {
  readonly identity?: LegacyIdentityOverlaySnapshot;
  readonly careerLevel?: number;
  readonly xp?: LegacyXpSnapshot;
  readonly characteristicAdvances?: Readonly<Record<string, number>>;
  readonly skillAdvances?: Readonly<Record<string, number>>;
  readonly extraSkills?: readonly LegacySkillSnapshot[];
  readonly talentTimes?: Readonly<Record<string, number>>;
  readonly addedTalents?: readonly LegacyTalentSnapshot[];
  readonly vitals?: Readonly<Record<string, number>>;
  readonly wounds?: number;
  readonly sin?: number;
  readonly advantage?: number;
  readonly magicPool?: number;
  readonly spellbook?: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly wealth?: Readonly<Record<string, number>>;
  readonly ap?: Readonly<Record<string, number>>;
  readonly weapons?: readonly JsonRecord[];
  readonly armour?: readonly JsonRecord[];
  readonly trappings?: readonly JsonRecord[];
  readonly conditions?: Readonly<Record<string, number>> | readonly JsonRecord[];
  readonly criticals?: readonly JsonRecord[];
  readonly mutations?: readonly JsonRecord[];
  readonly psychology?: readonly string[];
}

export interface DecodedLegacyCharacterSource {
  readonly character: LegacyCharacterSnapshot;
  readonly overlays: DecodedLegacyOverlays;
  readonly xpLogSeed?: readonly LegacyXpEntrySnapshot[];
  readonly rawCharacter: ExtensionRecord;
  readonly rawOverlays: ExtensionRecord;
  readonly rawXpLogSeed?: JsonValue;
}

function path(parent: Path, segment: DiagnosticPathSegment): Path {
  return [...parent, segment];
}

function report(
  diagnostics: Diagnostic[],
  code: DiagnosticCode,
  at: Path,
  message: string,
  severity: Diagnostic['severity'] = 'error',
): void {
  diagnostics.push(makeDiagnostic(code, at, message, severity));
}

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const result = safeRecord<JsonValue>();
    for (const key of Object.keys(value).sort()) result[key] = canonicalJson(value[key]);
    return result;
  }
  return value;
}

/** Capture an inert, bounded JSON object and normalize all object key order. */
export function decodeInertLegacyRecord(
  raw: unknown,
  rootLabel: string,
): DecodeResult<ExtensionRecord> {
  const context = new DecodeContext();
  const wrapper = safeRecord<unknown>();
  wrapper[rootLabel] = raw;
  const captured = readExtensionRecord(wrapper, rootLabel, context, [], true);
  const result = context.finish(captured);
  if (!result.ok) return result;
  return decodeSuccess(canonicalJson(result.value) as ExtensionRecord, result.diagnostics);
}

function record(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  label: string,
): JsonRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    report(diagnostics, 'invalid_type', at, `${label} must be an object.`);
    return undefined;
  }
  return value;
}

function array(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  label: string,
): JsonValue[] | undefined {
  if (!Array.isArray(value)) {
    report(diagnostics, 'invalid_type', at, `${label} must be an array.`);
    return undefined;
  }
  return value;
}

function stringValue(
  object: JsonRecord,
  key: string,
  diagnostics: Diagnostic[],
  at: Path,
  options: { optional?: boolean; blank?: boolean } = {},
): string | undefined {
  const value = object[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string') {
    report(diagnostics, 'invalid_type', path(at, key), `${key} must be a string.`);
    return undefined;
  }
  if (!options.blank && value.trim().length === 0) {
    report(diagnostics, 'blank_string', path(at, key), `${key} must not be blank.`);
    return undefined;
  }
  return value;
}

function numberValue(
  object: JsonRecord,
  key: string,
  diagnostics: Diagnostic[],
  at: Path,
  options: { optional?: boolean; integer?: boolean; minimum?: number } = {},
): number | undefined {
  const value = object[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'number') {
    report(diagnostics, 'invalid_type', path(at, key), `${key} must be a number.`);
    return undefined;
  }
  if (!Number.isFinite(value)) {
    report(diagnostics, 'nonfinite_number', path(at, key), `${key} must be finite.`);
    return undefined;
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    report(diagnostics, 'invalid_integer', path(at, key), `${key} must be a safe integer.`);
    return undefined;
  }
  if (options.minimum !== undefined && value < options.minimum) {
    report(diagnostics, 'out_of_range', path(at, key), `${key} must be >= ${options.minimum}.`);
    return undefined;
  }
  return value;
}

function booleanValue(
  object: JsonRecord,
  key: string,
  diagnostics: Diagnostic[],
  at: Path,
  optional = false,
): boolean | undefined {
  const value = object[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'boolean') {
    report(diagnostics, 'invalid_type', path(at, key), `${key} must be a boolean.`);
    return undefined;
  }
  return value;
}

function stringArray(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  label: string,
): string[] | undefined {
  const values = array(value, diagnostics, at, label);
  if (!values) return undefined;
  const result: string[] = [];
  values.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      report(diagnostics, 'invalid_type', path(at, index), `${label} entries must be strings.`);
    } else if (!entry.trim()) {
      report(diagnostics, 'blank_string', path(at, index), `${label} entries must not be blank.`);
    } else result.push(entry);
  });
  return result;
}

function numberMap(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  label: string,
  options: { integer?: boolean; minimum?: number } = {},
): Record<string, number> | undefined {
  const source = record(value, diagnostics, at, label);
  if (!source) return undefined;
  const result = safeRecord<number>();
  for (const key of Object.keys(source)) {
    if (!key.trim()) {
      report(diagnostics, 'blank_id', path(at, key), `${label} keys must not be blank.`);
      continue;
    }
    const entry = source[key];
    if (typeof entry !== 'number') {
      report(diagnostics, 'invalid_type', path(at, key), `${label} values must be numbers.`);
    } else if (!Number.isFinite(entry)) {
      report(diagnostics, 'nonfinite_number', path(at, key), `${label} values must be finite.`);
    } else if (options.integer && !Number.isSafeInteger(entry)) {
      report(diagnostics, 'invalid_integer', path(at, key), `${label} values must be safe integers.`);
    } else if (options.minimum !== undefined && entry < options.minimum) {
      report(diagnostics, 'out_of_range', path(at, key), `${label} values must be >= ${options.minimum}.`);
    } else result[key] = entry;
  }
  return result;
}

function objectArray(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  label: string,
): JsonRecord[] | undefined {
  const values = array(value, diagnostics, at, label);
  if (!values) return undefined;
  const result: JsonRecord[] = [];
  values.forEach((entry, index) => {
    const decoded = record(entry, diagnostics, path(at, index), `${label} entry`);
    if (decoded) result.push(decoded);
  });
  return result;
}

function validateXpEntries(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
): LegacyXpEntrySnapshot[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'XP log');
  if (!entries) return undefined;
  entries.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'date', diagnostics, entryPath, { blank: true });
    stringValue(entry, 'reason', diagnostics, entryPath);
    numberValue(entry, 'amount', diagnostics, entryPath);
    stringValue(entry, 'kind', diagnostics, entryPath, { optional: true });
    stringValue(entry, 'entityKey', diagnostics, entryPath, { optional: true });
  });
  return entries as unknown as LegacyXpEntrySnapshot[];
}

function validateXp(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
): LegacyXpSnapshot | undefined {
  const xp = record(value, diagnostics, at, 'XP overlay');
  if (!xp) return undefined;
  numberValue(xp, 'current', diagnostics, at);
  numberValue(xp, 'spent', diagnostics, at);
  const log = validateXpEntries(xp.log, diagnostics, path(at, 'log'));
  if (!log) return undefined;
  return { current: xp.current as number, spent: xp.spent as number, log };
}

function validateCareerRanks(
  character: JsonRecord,
  diagnostics: Diagnostic[],
  at: Path,
): void {
  const ranks = objectArray(character.careerRanks, diagnostics, path(at, 'careerRanks'), 'careerRanks');
  const levels = new Set<number>();
  ranks?.forEach((rank, index) => {
    const rankPath = [...at, 'careerRanks', index] as const;
    const level = numberValue(rank, 'level', diagnostics, rankPath, { integer: true, minimum: 1 });
    stringValue(rank, 'name', diagnostics, rankPath);
    stringValue(rank, 'status', diagnostics, rankPath);
    if (level !== undefined) {
      if (levels.has(level)) {
        report(diagnostics, 'duplicate_value', path(rankPath, 'level'), 'Career rank levels must be unique.');
      }
      levels.add(level);
    }
  });
}

function validateCharacteristics(
  character: JsonRecord,
  diagnostics: Diagnostic[],
  at: Path,
): Set<string> {
  const entries = objectArray(
    character.characteristics,
    diagnostics,
    path(at, 'characteristics'),
    'characteristics',
  );
  const keys = new Set<string>();
  entries?.forEach((entry, index) => {
    const entryPath = [...at, 'characteristics', index] as const;
    const key = stringValue(entry, 'key', diagnostics, entryPath);
    stringValue(entry, 'name', diagnostics, entryPath);
    stringValue(entry, 'short', diagnostics, entryPath);
    numberValue(entry, 'init', diagnostics, entryPath);
    numberValue(entry, 'adv', diagnostics, entryPath);
    if (key) {
      if (keys.has(key)) report(diagnostics, 'duplicate_id', path(entryPath, 'key'), 'Characteristic keys must be unique.');
      keys.add(key);
    }
  });
  return keys;
}

function validateSkills(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  characteristicKeys: ReadonlySet<string> | undefined,
): LegacySkillSnapshot[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'skills');
  entries?.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'definitionId', diagnostics, entryPath, { optional: true });
    stringValue(entry, 'name', diagnostics, entryPath);
    const characteristic = stringValue(entry, 'char', diagnostics, entryPath);
    numberValue(entry, 'adv', diagnostics, entryPath, { minimum: 0 });
    booleanValue(entry, 'career', diagnostics, entryPath);
    booleanValue(entry, 'advanced', diagnostics, entryPath, true);
    stringValue(entry, 'grouped', diagnostics, entryPath, { optional: true, blank: true });
    if (characteristic && characteristicKeys && !characteristicKeys.has(characteristic)) {
      report(
        diagnostics,
        'missing_reference',
        path(entryPath, 'char'),
        'Skill characteristic must reference a legacy characteristic key.',
      );
    }
  });
  return entries as unknown as LegacySkillSnapshot[] | undefined;
}

function talentIdentity(talent: JsonRecord): string | undefined {
  const name = typeof talent.name === 'string' ? talent.name.trim().toLowerCase() : undefined;
  const definitionId = typeof talent.definitionId === 'string'
    ? talent.definitionId.trim()
    : undefined;
  const specialization = typeof talent.specialization === 'string'
    ? talent.specialization.trim().toLowerCase()
    : '';
  return definitionId
    ? `definition:${definitionId}|specialization:${specialization}`
    : name ? `name:${name}` : undefined;
}

function validateTalents(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
  template: boolean,
): LegacyTalentSnapshot[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'talents');
  const identities = new Set<string>();
  entries?.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'definitionId', diagnostics, entryPath, { optional: true });
    stringValue(entry, 'specialization', diagnostics, entryPath, { optional: true });
    stringValue(entry, 'name', diagnostics, entryPath);
    if (template) {
      numberValue(entry, 'times', diagnostics, entryPath, { integer: true, minimum: 1 });
      stringValue(entry, 'desc', diagnostics, entryPath);
      booleanValue(entry, 'career', diagnostics, entryPath);
    }
    const identity = talentIdentity(entry);
    if (identity) {
      if (identities.has(identity)) {
        report(diagnostics, 'duplicate_id', entryPath, 'Talent identities must be unique within this collection.');
      }
      identities.add(identity);
    }
  });
  return entries as unknown as LegacyTalentSnapshot[] | undefined;
}

function validateWeapons(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'weapons');
  entries?.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'name', diagnostics, entryPath);
    stringValue(entry, 'group', diagnostics, entryPath);
    numberValue(entry, 'enc', diagnostics, entryPath);
    stringValue(entry, 'dmg', diagnostics, entryPath);
    stringValue(entry, 'reach', diagnostics, entryPath, { optional: true });
    stringValue(entry, 'range', diagnostics, entryPath, { optional: true });
    stringArray(entry.qual, diagnostics, path(entryPath, 'qual'), 'weapon qualities');
  });
  return entries;
}

function validateArmour(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'armour');
  entries?.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'name', diagnostics, entryPath);
    numberValue(entry, 'enc', diagnostics, entryPath);
    numberValue(entry, 'ap', diagnostics, entryPath);
    stringArray(entry.locs, diagnostics, path(entryPath, 'locs'), 'armour locations');
    stringArray(entry.qual, diagnostics, path(entryPath, 'qual'), 'armour qualities');
  });
  return entries;
}

function validateTrappings(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'trappings');
  entries?.forEach((entry, index) => {
    stringValue(entry, 'name', diagnostics, path(at, index));
    numberValue(entry, 'enc', diagnostics, path(at, index));
  });
  return entries;
}

function validateConditions(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'conditions');
  entries?.forEach((entry, index) => {
    stringValue(entry, 'type', diagnostics, path(at, index));
    numberValue(entry, 'stacks', diagnostics, path(at, index), { integer: true, minimum: 0 });
  });
  return entries;
}

function validateCriticals(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'criticals');
  entries?.forEach((entry, index) => {
    const entryPath = path(at, index);
    stringValue(entry, 'loc', diagnostics, entryPath, { blank: true });
    numberValue(entry, 'roll', diagnostics, entryPath, { integer: true });
    stringValue(entry, 'name', diagnostics, entryPath);
    stringValue(entry, 'effect', diagnostics, entryPath);
    numberValue(entry, 'days', diagnostics, entryPath, { integer: true });
  });
  return entries;
}

function validateMutations(value: JsonValue | undefined, diagnostics: Diagnostic[], at: Path): JsonRecord[] | undefined {
  const entries = objectArray(value, diagnostics, at, 'mutations');
  entries?.forEach((entry, index) => stringValue(entry, 'name', diagnostics, path(at, index)));
  return entries;
}

const CHARACTER_KEYS = new Set([
  'id', 'name', 'species', 'raceId', 'class', 'careerId', 'career', 'careerLevel',
  'careerLevelName', 'careerRanks', 'status', 'age', 'height', 'hair', 'eyes',
  'motivation', 'fate', 'fortune', 'resilience', 'resolve', 'xpCurrent', 'xpSpent',
  'wounds', 'corruption', 'sin', 'movement', 'wealth', 'characteristics', 'skills',
  'talents', 'weapons', 'armour', 'ap', 'conditions', 'criticals', 'trappings',
  'party', 'psychology', 'mutations', 'ambitionsShort', 'ambitionsLong', 'initials',
  'accent', 'isCaster', 'isAnointed', 'knownSpells', 'knownPrayers', 'deity', 'spellLore',
]);

function validateCharacter(character: JsonRecord, diagnostics: Diagnostic[]): void {
  const at = ['source', 'character'] as const;
  for (const key of Object.keys(character)) {
    if (!CHARACTER_KEYS.has(key)) {
      report(
        diagnostics,
        'legacy_unmapped_value',
        path(at, key),
        'Unknown legacy character field is preserved only in legacyExtensions.',
        'warning',
      );
    }
  }
  for (const key of ['id', 'name', 'species', 'class', 'career', 'careerLevelName', 'status', 'initials', 'accent']) {
    stringValue(character, key, diagnostics, at);
  }
  for (const key of ['height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong']) {
    stringValue(character, key, diagnostics, at, { blank: true });
  }
  for (const key of ['raceId', 'careerId', 'deity', 'spellLore']) {
    stringValue(character, key, diagnostics, at, { optional: true });
  }
  numberValue(character, 'careerLevel', diagnostics, at, { integer: true, minimum: 1 });
  for (const key of [
    'age', 'fate', 'fortune', 'resilience', 'resolve', 'xpCurrent', 'xpSpent',
    'corruption', 'sin', 'movement',
  ]) numberValue(character, key, diagnostics, at);
  booleanValue(character, 'isCaster', diagnostics, at, true);
  booleanValue(character, 'isAnointed', diagnostics, at, true);
  validateCareerRanks(character, diagnostics, at);

  const wounds = record(character.wounds, diagnostics, path(at, 'wounds'), 'wounds');
  if (wounds) {
    numberValue(wounds, 'current', diagnostics, path(at, 'wounds'));
    numberValue(wounds, 'max', diagnostics, path(at, 'wounds'));
  }
  numberMap(character.wealth, diagnostics, path(at, 'wealth'), 'wealth');
  const characteristicKeys = validateCharacteristics(character, diagnostics, at);
  validateSkills(character.skills, diagnostics, path(at, 'skills'), characteristicKeys);
  validateTalents(character.talents, diagnostics, path(at, 'talents'), true);
  validateWeapons(character.weapons, diagnostics, path(at, 'weapons'));
  validateArmour(character.armour, diagnostics, path(at, 'armour'));
  numberMap(character.ap, diagnostics, path(at, 'ap'), 'armour points');
  validateConditions(character.conditions, diagnostics, path(at, 'conditions'));
  validateCriticals(character.criticals, diagnostics, path(at, 'criticals'));
  validateTrappings(character.trappings, diagnostics, path(at, 'trappings'));
  validateMutations(character.mutations, diagnostics, path(at, 'mutations'));
  stringArray(character.psychology, diagnostics, path(at, 'psychology'), 'psychology');
  if (character.knownSpells !== undefined) {
    stringArray(character.knownSpells, diagnostics, path(at, 'knownSpells'), 'knownSpells');
  }
  if (character.knownPrayers !== undefined) {
    stringArray(character.knownPrayers, diagnostics, path(at, 'knownPrayers'), 'knownPrayers');
  }
  const party = record(character.party, diagnostics, path(at, 'party'), 'party');
  if (party) {
    stringValue(party, 'name', diagnostics, path(at, 'party'), { blank: true });
    stringValue(party, 'short', diagnostics, path(at, 'party'), { blank: true });
    const members = objectArray(party.members, diagnostics, [...at, 'party', 'members'], 'party members');
    members?.forEach((member, index) => {
      const memberPath = [...at, 'party', 'members', index] as const;
      stringValue(member, 'name', diagnostics, memberPath);
      stringValue(member, 'role', diagnostics, memberPath);
    });
  }
}

const OVERLAY_KEYS = new Set([
  'identity', 'career.level', 'xp', 'chars.adv', 'skills.adv', 'skills.extra',
  'talents.times', 'talents.added', 'vitals', 'wounds', 'sin', 'advantage',
  'magic.pool', 'magic.spellbook', 'wealth', 'ap', 'weapons', 'armour', 'trappings',
  'conditions', 'criticals', 'mutations', 'psychology',
]);

function parseIdentityOverlay(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
): LegacyIdentityOverlaySnapshot | undefined {
  const identity = record(value, diagnostics, at, 'identity overlay');
  if (!identity) return undefined;
  const allowed = new Set([
    'name', 'age', 'height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong',
  ]);
  for (const key of Object.keys(identity)) {
    if (!allowed.has(key)) {
      report(
        diagnostics,
        'legacy_unmapped_value',
        path(at, key),
        'Unknown identity overlay field is preserved only in legacyExtensions.',
        'warning',
      );
    }
  }
  stringValue(identity, 'name', diagnostics, at, { optional: true, blank: true });
  numberValue(identity, 'age', diagnostics, at, { optional: true });
  for (const key of ['height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong']) {
    stringValue(identity, key, diagnostics, at, { optional: true, blank: true });
  }
  return identity as unknown as LegacyIdentityOverlaySnapshot;
}

function parseAddedTalents(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  at: Path,
): LegacyTalentSnapshot[] | undefined {
  const values = array(value, diagnostics, at, 'added talents');
  if (!values) return undefined;
  const normalized: LegacyTalentSnapshot[] = [];
  values.forEach((entry, index) => {
    if (typeof entry === 'string') {
      if (!entry.trim()) report(diagnostics, 'blank_string', path(at, index), 'Added talent names must not be blank.');
      else normalized.push({ name: entry, times: 1 });
      return;
    }
    const object = record(entry, diagnostics, path(at, index), 'added talent');
    if (!object) return;
    stringValue(object, 'name', diagnostics, path(at, index));
    stringValue(object, 'definitionId', diagnostics, path(at, index), { optional: true });
    stringValue(object, 'specialization', diagnostics, path(at, index), { optional: true });
    normalized.push({
      name: object.name as string,
      times: 1,
      ...(typeof object.definitionId === 'string' ? { definitionId: object.definitionId } : {}),
      ...(typeof object.specialization === 'string' ? { specialization: object.specialization } : {}),
    });
  });
  return normalized;
}

function parseOverlays(overlays: ExtensionRecord, diagnostics: Diagnostic[]): DecodedLegacyOverlays {
  const root = ['source', 'overlays'] as const;
  for (const key of Object.keys(overlays)) {
    if (!OVERLAY_KEYS.has(key)) {
      report(
        diagnostics,
        'legacy_unmapped_value',
        path(root, key),
        'Unrecognized overlay is preserved only in legacyExtensions.',
        'warning',
      );
    }
  }
  const result: {
    identity?: LegacyIdentityOverlaySnapshot;
    careerLevel?: number;
    xp?: LegacyXpSnapshot;
    characteristicAdvances?: Readonly<Record<string, number>>;
    skillAdvances?: Readonly<Record<string, number>>;
    extraSkills?: readonly LegacySkillSnapshot[];
    talentTimes?: Readonly<Record<string, number>>;
    addedTalents?: readonly LegacyTalentSnapshot[];
    vitals?: Readonly<Record<string, number>>;
    wounds?: number;
    sin?: number;
    advantage?: number;
    magicPool?: number;
    spellbook?: { readonly added: readonly string[]; readonly removed: readonly string[] };
    wealth?: Readonly<Record<string, number>>;
    ap?: Readonly<Record<string, number>>;
    weapons?: readonly JsonRecord[];
    armour?: readonly JsonRecord[];
    trappings?: readonly JsonRecord[];
    conditions?: Readonly<Record<string, number>> | readonly JsonRecord[];
    criticals?: readonly JsonRecord[];
    mutations?: readonly JsonRecord[];
    psychology?: readonly string[];
  } = {};

  if (overlays.identity !== undefined) {
    result.identity = parseIdentityOverlay(overlays.identity, diagnostics, path(root, 'identity'));
  }
  if (overlays['career.level'] !== undefined) {
    const holder = safeRecord<JsonValue>();
    holder.value = overlays['career.level'];
    result.careerLevel = numberValue(holder, 'value', diagnostics, path(root, 'career.level'), {
      integer: true,
      minimum: 1,
    });
  }
  if (overlays.xp !== undefined) result.xp = validateXp(overlays.xp, diagnostics, path(root, 'xp'));
  if (overlays['chars.adv'] !== undefined) {
    result.characteristicAdvances = numberMap(
      overlays['chars.adv'], diagnostics, path(root, 'chars.adv'), 'characteristic advances', { minimum: 0 },
    );
  }
  if (overlays['skills.adv'] !== undefined) {
    result.skillAdvances = numberMap(
      overlays['skills.adv'], diagnostics, path(root, 'skills.adv'), 'skill advances', { minimum: 0 },
    );
  }
  if (overlays['skills.extra'] !== undefined) {
    result.extraSkills = validateSkills(
      overlays['skills.extra'], diagnostics, path(root, 'skills.extra'), undefined,
    );
  }
  if (overlays['talents.times'] !== undefined) {
    result.talentTimes = numberMap(
      overlays['talents.times'], diagnostics, path(root, 'talents.times'), 'talent ranks',
      { integer: true, minimum: 1 },
    );
  }
  if (overlays['talents.added'] !== undefined) {
    result.addedTalents = parseAddedTalents(
      overlays['talents.added'], diagnostics, path(root, 'talents.added'),
    );
  }
  if (overlays.vitals !== undefined) {
    result.vitals = numberMap(overlays.vitals, diagnostics, path(root, 'vitals'), 'vitals');
  }
  for (const [overlayKey, resultKey] of [
    ['wounds', 'wounds'], ['sin', 'sin'], ['advantage', 'advantage'], ['magic.pool', 'magicPool'],
  ] as const) {
    if (overlays[overlayKey] === undefined) continue;
    const holder = safeRecord<JsonValue>();
    holder.value = overlays[overlayKey];
    result[resultKey] = numberValue(holder, 'value', diagnostics, path(root, overlayKey));
  }
  if (overlays['magic.spellbook'] !== undefined) {
    const spellbook = record(
      overlays['magic.spellbook'], diagnostics, path(root, 'magic.spellbook'), 'spellbook overlay',
    );
    if (spellbook) {
      const added = stringArray(
        spellbook.added, diagnostics, [...root, 'magic.spellbook', 'added'], 'added spell ids',
      );
      const removed = stringArray(
        spellbook.removed, diagnostics, [...root, 'magic.spellbook', 'removed'], 'removed spell ids',
      );
      if (added && removed) result.spellbook = { added, removed };
    }
  }
  if (overlays.wealth !== undefined) {
    result.wealth = numberMap(overlays.wealth, diagnostics, path(root, 'wealth'), 'wealth');
  }
  if (overlays.ap !== undefined) result.ap = numberMap(overlays.ap, diagnostics, path(root, 'ap'), 'armour points');
  if (overlays.weapons !== undefined) result.weapons = validateWeapons(overlays.weapons, diagnostics, path(root, 'weapons'));
  if (overlays.armour !== undefined) result.armour = validateArmour(overlays.armour, diagnostics, path(root, 'armour'));
  if (overlays.trappings !== undefined) {
    result.trappings = validateTrappings(overlays.trappings, diagnostics, path(root, 'trappings'));
  }
  if (overlays.conditions !== undefined) {
    result.conditions = Array.isArray(overlays.conditions)
      ? validateConditions(overlays.conditions, diagnostics, path(root, 'conditions'))
      : numberMap(
        overlays.conditions, diagnostics, path(root, 'conditions'), 'condition stacks',
        { integer: true, minimum: 0 },
      );
  }
  if (overlays.criticals !== undefined) {
    result.criticals = validateCriticals(overlays.criticals, diagnostics, path(root, 'criticals'));
  }
  if (overlays.mutations !== undefined) {
    result.mutations = validateMutations(overlays.mutations, diagnostics, path(root, 'mutations'));
  }
  if (overlays.psychology !== undefined) {
    result.psychology = stringArray(
      overlays.psychology, diagnostics, path(root, 'psychology'), 'psychology',
    );
  }
  return result;
}

export function decodeLegacyCharacterSourceV1(raw: unknown): DecodeResult<DecodedLegacyCharacterSource> {
  const captured = decodeInertLegacyRecord(raw, 'source');
  if (!captured.ok) return captured;
  const diagnostics = [...captured.diagnostics];
  const source = captured.value;
  for (const key of Object.keys(source)) {
    if (!['character', 'overlays', 'xpLogSeed'].includes(key)) {
      report(diagnostics, 'unknown_key', ['source', key], 'Unknown legacy source field.');
    }
  }
  const character = record(source.character, diagnostics, ['source', 'character'], 'legacy character');
  const overlays = record(source.overlays, diagnostics, ['source', 'overlays'], 'legacy overlays');
  if (character) validateCharacter(character, diagnostics);
  const parsedOverlays = overlays ? parseOverlays(overlays, diagnostics) : {};
  const xpLogSeed = source.xpLogSeed === undefined
    ? undefined
    : validateXpEntries(source.xpLogSeed, diagnostics, ['source', 'xpLogSeed']);
  if (!character || !overlays || hasErrorDiagnostics(diagnostics)) return decodeFailure(diagnostics);
  return decodeSuccess({
    character: character as unknown as LegacyCharacterSnapshot,
    overlays: parsedOverlays,
    ...(xpLogSeed ? { xpLogSeed } : {}),
    rawCharacter: character as ExtensionRecord,
    rawOverlays: overlays as ExtensionRecord,
    ...(source.xpLogSeed !== undefined ? { rawXpLogSeed: source.xpLogSeed } : {}),
  }, diagnostics);
}
