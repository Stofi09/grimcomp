import {
  decodeCharacterDocumentV2,
  decodeExchangeEnvelopeV1,
} from '../decoders';
import {
  decodeFailure,
  decodeSuccess,
  hasErrorDiagnostics,
  makeDiagnostic,
  quoteDiagnosticValue,
  type Diagnostic,
  type DiagnosticPathSegment,
} from '../diagnostics';
import { safeRecord } from '../decodeSupport';
import type {
  CharacterDocumentV2,
  CharacterOrigin,
  DefinitionRef,
  ExchangeEnvelopeV1,
  ExtensionRecord,
  InventoryItem,
  JsonValue,
  NamedAbility,
  SkillStat,
  TalentAbility,
  UnresolvedRef,
} from '../types';
import {
  decodeInertLegacyRecord,
  decodeLegacyCharacterSourceV1,
  type DecodedLegacyCharacterSource,
  type LegacySkillSnapshot,
  type LegacyTalentSnapshot,
} from './decode';
import type {
  LegacyAdapterResult,
  LegacyCharacterAdapterContext,
  LegacyCharacterSourceV1,
  LegacyEnvelopeContext,
  LegacyReferenceKind,
  LegacyReferenceResolution,
  LegacyRosterEntry,
} from './types';

const ADAPTER_ID = 'grimcomp.legacy-v1-adapter';
const ADAPTER_VERSION = '1.0.0';
const REFERENCE_KINDS = new Set<LegacyReferenceKind>([
  'species', 'career', 'skill', 'talent', 'spell', 'prayer', 'weapon', 'armour',
  'trapping', 'condition', 'critical', 'mutation',
]);
type Path = readonly DiagnosticPathSegment[];
type JsonRecord = Record<string, JsonValue>;

interface DecodedAdapterContext extends LegacyCharacterAdapterContext {
  readonly revision: number;
  readonly originKind: CharacterOrigin['kind'];
  readonly resolutions: readonly LegacyReferenceResolution[];
}

interface ReferenceSubject {
  readonly kind: LegacyReferenceKind;
  readonly legacyId?: string;
  readonly legacyName?: string;
  readonly specialization?: string;
  readonly sourcePath: Path;
  readonly outputPath: string;
}

interface ReferenceMatch {
  readonly ref: DefinitionRef;
  readonly displayName?: string;
}

function ownRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function adapterWarning(
  diagnostics: Diagnostic[],
  code:
    | 'legacy_unresolved_reference'
    | 'legacy_inferred_value'
    | 'legacy_unmapped_value'
    | 'legacy_ambiguous_reference',
  path: Path,
  message: string,
): void {
  diagnostics.push(makeDiagnostic(code, path, message, 'warning'));
}

function contextError(
  diagnostics: Diagnostic[],
  code: 'invalid_type' | 'blank_string' | 'invalid_integer' | 'invalid_enum' | 'unknown_key',
  path: Path,
  message: string,
): void {
  diagnostics.push(makeDiagnostic(code, path, message));
}

function optionalString(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  path: Path,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    contextError(diagnostics, 'invalid_type', path, 'Value must be a string.');
    return undefined;
  }
  if (!value.trim()) {
    contextError(diagnostics, 'blank_string', path, 'Value must not be blank.');
    return undefined;
  }
  return value;
}

function requiredString(
  value: JsonValue | undefined,
  diagnostics: Diagnostic[],
  path: Path,
): string | undefined {
  if (value === undefined) {
    contextError(diagnostics, 'invalid_type', path, 'Required value must be a string.');
    return undefined;
  }
  return optionalString(value, diagnostics, path);
}

function decodeAdapterContext(raw: unknown): LegacyAdapterResult<DecodedAdapterContext> {
  const captured = decodeInertLegacyRecord(raw, 'context');
  if (!captured.ok) return captured;
  const diagnostics = [...captured.diagnostics];
  const context = captured.value;
  const allowed = new Set([
    'revision', 'createdAt', 'updatedAt', 'importedAt', 'rulesetRef', 'profileBinding',
    'platform', 'sourceId', 'sourceHash', 'originKind', 'resolutions',
  ]);
  for (const key of Object.keys(context)) {
    if (!allowed.has(key)) contextError(diagnostics, 'unknown_key', ['context', key], 'Unknown adapter context field.');
  }

  const createdAt = requiredString(context.createdAt, diagnostics, ['context', 'createdAt']);
  const updatedAt = requiredString(context.updatedAt, diagnostics, ['context', 'updatedAt']);
  const importedAt = requiredString(context.importedAt, diagnostics, ['context', 'importedAt']);
  const platform = requiredString(context.platform, diagnostics, ['context', 'platform']);
  const sourceId = requiredString(context.sourceId, diagnostics, ['context', 'sourceId']);
  const sourceHash = optionalString(context.sourceHash, diagnostics, ['context', 'sourceHash']);
  const rulesetRef = ownRecord(context.rulesetRef);
  const profileBinding = ownRecord(context.profileBinding);
  if (!rulesetRef) contextError(diagnostics, 'invalid_type', ['context', 'rulesetRef'], 'rulesetRef must be an object.');
  if (!profileBinding) {
    contextError(diagnostics, 'invalid_type', ['context', 'profileBinding'], 'profileBinding must be an object.');
  }

  let revision = 1;
  if (context.revision !== undefined) {
    if (typeof context.revision !== 'number' || !Number.isSafeInteger(context.revision) || context.revision < 1) {
      contextError(diagnostics, 'invalid_integer', ['context', 'revision'], 'revision must be a safe integer >= 1.');
    } else revision = context.revision;
  }
  let originKind: CharacterOrigin['kind'] = 'imported';
  if (context.originKind !== undefined) {
    if (
      typeof context.originKind !== 'string'
      || !['created', 'template', 'imported'].includes(context.originKind)
    ) {
      contextError(
        diagnostics,
        'invalid_enum',
        ['context', 'originKind'],
        'originKind must be created, template, or imported.',
      );
    } else originKind = context.originKind as CharacterOrigin['kind'];
  }

  const resolutions: LegacyReferenceResolution[] = [];
  if (context.resolutions !== undefined) {
    if (!Array.isArray(context.resolutions)) {
      contextError(diagnostics, 'invalid_type', ['context', 'resolutions'], 'resolutions must be an array.');
    } else {
      context.resolutions.forEach((rawResolution, index) => {
        const resolutionPath = ['context', 'resolutions', index] as const;
        const resolution = ownRecord(rawResolution);
        if (!resolution) {
          contextError(diagnostics, 'invalid_type', resolutionPath, 'Resolution must be an object.');
          return;
        }
        for (const key of Object.keys(resolution)) {
          if (!['kind', 'legacyId', 'legacyName', 'specialization', 'ref', 'displayName'].includes(key)) {
            contextError(diagnostics, 'unknown_key', [...resolutionPath, key], 'Unknown resolution field.');
          }
        }
        const kind = requiredString(resolution.kind, diagnostics, [...resolutionPath, 'kind']);
        if (kind && !REFERENCE_KINDS.has(kind as LegacyReferenceKind)) {
          contextError(diagnostics, 'invalid_enum', [...resolutionPath, 'kind'], 'Unknown reference kind.');
        }
        const legacyId = optionalString(resolution.legacyId, diagnostics, [...resolutionPath, 'legacyId']);
        const legacyName = optionalString(resolution.legacyName, diagnostics, [...resolutionPath, 'legacyName']);
        const specialization = optionalString(
          resolution.specialization,
          diagnostics,
          [...resolutionPath, 'specialization'],
        );
        const displayName = optionalString(
          resolution.displayName,
          diagnostics,
          [...resolutionPath, 'displayName'],
        );
        const ref = ownRecord(resolution.ref);
        if (!ref) {
          contextError(diagnostics, 'invalid_type', [...resolutionPath, 'ref'], 'ref must be an object.');
          return;
        }
        for (const key of Object.keys(ref)) {
          if (!['id', 'name', 'packId', 'specialization', 'extensions'].includes(key)) {
            contextError(diagnostics, 'unknown_key', [...resolutionPath, 'ref', key], 'Unknown definition ref field.');
          }
        }
        const refId = requiredString(ref.id, diagnostics, [...resolutionPath, 'ref', 'id']);
        optionalString(ref.name, diagnostics, [...resolutionPath, 'ref', 'name']);
        optionalString(ref.packId, diagnostics, [...resolutionPath, 'ref', 'packId']);
        const refSpecialization = optionalString(
          ref.specialization,
          diagnostics,
          [...resolutionPath, 'ref', 'specialization'],
        );
        if (ref.extensions !== undefined && !ownRecord(ref.extensions)) {
          contextError(
            diagnostics,
            'invalid_type',
            [...resolutionPath, 'ref', 'extensions'],
            'DefinitionRef extensions must be an object.',
          );
        }
        if (specialization && refSpecialization && specialization !== refSpecialization) {
          contextError(
            diagnostics,
            'invalid_enum',
            [...resolutionPath, 'specialization'],
            'Resolution and DefinitionRef specialization must agree exactly.',
          );
        }
        if (kind && REFERENCE_KINDS.has(kind as LegacyReferenceKind) && refId) {
          resolutions.push({
            kind: kind as LegacyReferenceKind,
            ...(legacyId ? { legacyId } : {}),
            ...(legacyName ? { legacyName } : {}),
            ...(specialization ? { specialization } : {}),
            ref: ref as unknown as DefinitionRef,
            ...(displayName ? { displayName } : {}),
          });
        }
      });
    }
  }
  if (hasErrorDiagnostics(diagnostics)
    || !createdAt || !updatedAt || !importedAt || !platform || !sourceId
    || !rulesetRef || !profileBinding) {
    return decodeFailure(diagnostics);
  }
  return decodeSuccess({
    revision,
    createdAt,
    updatedAt,
    importedAt,
    rulesetRef: rulesetRef as unknown as DecodedAdapterContext['rulesetRef'],
    profileBinding: profileBinding as unknown as DecodedAdapterContext['profileBinding'],
    platform,
    sourceId,
    ...(sourceHash ? { sourceHash: sourceHash as DecodedAdapterContext['sourceHash'] } : {}),
    originKind,
    resolutions,
  }, diagnostics);
}

function unresolvedEntry(
  subject: ReferenceSubject,
  reason: string,
  code: string,
  ref?: DefinitionRef,
): UnresolvedRef {
  const legacyKey = subject.legacyId ?? subject.legacyName;
  return {
    code,
    path: subject.outputPath,
    reason,
    ...(legacyKey ? { legacyKey } : {}),
    ...(ref ? { ref } : subject.legacyId ? { ref: { id: subject.legacyId } } : {}),
  };
}

function resolutionSpecialization(resolution: LegacyReferenceResolution): string | undefined {
  return resolution.specialization ?? resolution.ref.specialization;
}

function resolveReference(
  subject: ReferenceSubject,
  resolutions: readonly LegacyReferenceResolution[],
  diagnostics: Diagnostic[],
  unresolvedRefs: UnresolvedRef[],
): ReferenceMatch | undefined {
  const candidates = resolutions.filter((resolution) => {
    if (resolution.kind !== subject.kind) return false;
    const identityMatches = subject.legacyId
      ? resolution.legacyId === subject.legacyId
        || (
          resolution.legacyId === undefined
          && resolution.legacyName === undefined
          && resolution.ref.id === subject.legacyId
        )
      : !!subject.legacyName && resolution.legacyName === subject.legacyName;
    if (!identityMatches) return false;
    return resolutionSpecialization(resolution) === subject.specialization;
  });
  if (candidates.length === 1) {
    return { ref: candidates[0].ref, ...(candidates[0].displayName ? { displayName: candidates[0].displayName } : {}) };
  }
  const display = subject.legacyId ?? subject.legacyName ?? '(missing legacy identity)';
  const quotedDisplay = quoteDiagnosticValue(display);
  if (candidates.length > 1) {
    const reason = `Multiple caller-supplied exact ${subject.kind} resolutions match ${quotedDisplay}.`;
    adapterWarning(diagnostics, 'legacy_ambiguous_reference', subject.sourcePath, reason);
    unresolvedRefs.push(unresolvedEntry(subject, reason, 'legacy.ambiguous'));
  } else {
    const reason = `No caller-supplied exact ${subject.kind} resolution matches ${quotedDisplay}.`;
    adapterWarning(diagnostics, 'legacy_unresolved_reference', subject.sourcePath, reason);
    unresolvedRefs.push(unresolvedEntry(subject, reason, 'legacy.unresolved'));
  }
  return undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function deterministicKey(prefix: string, index: number): string {
  return `${prefix}.${String(index).padStart(4, '0')}`;
}

/** Preserve encodeURIComponent's existing wire identity for well-formed text,
    while encoding isolated UTF-16 surrogates without letting URIError escape. */
function encodeIdentityComponent(value: string): string {
  let encoded = '';
  let chunkStart = 0;
  const flush = (end: number): void => {
    if (end > chunkStart) encoded += encodeURIComponent(value.slice(chunkStart, end));
  };

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
    } else if (codeUnit < 0xdc00 || codeUnit > 0xdfff) {
      continue;
    }

    flush(index);
    encoded += `%u${codeUnit.toString(16).toUpperCase().padStart(4, '0')}`;
    chunkStart = index + 1;
  }
  flush(value.length);
  return encoded;
}

function talentIdentity(talent: LegacyTalentSnapshot): string {
  if (talent.definitionId?.trim()) {
    return `definition:${encodeIdentityComponent(talent.definitionId.trim())}`
      + `|specialization:${encodeIdentityComponent((talent.specialization ?? '').trim().toLowerCase())}`;
  }
  return `name:${encodeIdentityComponent(talent.name.trim().toLowerCase())}`;
}

function indexedByName<T extends { readonly name: string }>(entries: readonly T[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const indices = result.get(entry.name) ?? [];
    indices.push(index);
    result.set(entry.name, indices);
  });
  return result;
}

function applySkillAdvances(
  skills: readonly LegacySkillSnapshot[],
  advances: Readonly<Record<string, number>> | undefined,
  diagnostics: Diagnostic[],
): number[] {
  const result = skills.map(skill => skill.adv);
  if (!advances) return result;
  const byName = indexedByName(skills);
  for (const key of Object.keys(advances)) {
    const owners = byName.get(key) ?? [];
    const advancePath = ['source', 'overlays', 'skills.adv', key] as const;
    if (owners.length === 1) result[owners[0]] = advances[key];
    else if (owners.length > 1) {
      adapterWarning(
        diagnostics,
        'legacy_ambiguous_reference',
        advancePath,
        'Name-keyed skill advance matches multiple skills and was not projected.',
      );
    } else {
      adapterWarning(
        diagnostics,
        'legacy_unmapped_value',
        advancePath,
        'Skill advance has no exact legacy skill owner and is preserved only in legacyExtensions.',
      );
    }
  }
  return result;
}

function applyTalentRanks(
  talents: readonly LegacyTalentSnapshot[],
  times: Readonly<Record<string, number>> | undefined,
  diagnostics: Diagnostic[],
): number[] {
  const ranks = talents.map(talent => talent.times ?? 1);
  if (!times) return ranks;
  const identityOwners = new Map<string, number[]>();
  const nameOwners = new Map<string, number[]>();
  talents.forEach((talent, index) => {
    const identity = talentIdentity(talent);
    identityOwners.set(identity, [...(identityOwners.get(identity) ?? []), index]);
    const name = talent.name.trim().toLowerCase();
    nameOwners.set(name, [...(nameOwners.get(name) ?? []), index]);
  });
  const canonicalOwners = new Set<number>();
  for (const key of Object.keys(times)) {
    const owners = identityOwners.get(key) ?? [];
    if (owners.length === 1) {
      ranks[owners[0]] = times[key];
      canonicalOwners.add(owners[0]);
    }
  }
  for (const key of Object.keys(times)) {
    const at = ['source', 'overlays', 'talents.times', key] as const;
    const identityMatches = identityOwners.get(key) ?? [];
    if (identityMatches.length === 1) continue;
    if (identityMatches.length > 1) {
      adapterWarning(
        diagnostics,
        'legacy_ambiguous_reference',
        at,
        'Canonical talent rank key has multiple owners and was not projected.',
      );
      continue;
    }
    const nameMatches = nameOwners.get(key.trim().toLowerCase()) ?? [];
    if (nameMatches.length === 1 && !canonicalOwners.has(nameMatches[0])) {
      ranks[nameMatches[0]] = times[key];
    } else if (nameMatches.length > 1) {
      adapterWarning(
        diagnostics,
        'legacy_ambiguous_reference',
        at,
        'Name-keyed talent rank matches multiple talents and was not projected.',
      );
    } else {
      adapterWarning(
        diagnostics,
        'legacy_unmapped_value',
        at,
        canonicalOwners.has(nameMatches[0] ?? -1)
          ? 'Legacy talent rank is shadowed by its canonical key and remains preserved in legacyExtensions.'
          : 'Talent rank has no exact owner and is preserved only in legacyExtensions.',
      );
    }
  }
  return ranks;
}

function asExtensionRecord(value: JsonRecord): ExtensionRecord {
  return value as ExtensionRecord;
}

function buildInventory(
  source: DecodedLegacyCharacterSource,
  context: DecodedAdapterContext,
  diagnostics: Diagnostic[],
  unresolvedRefs: UnresolvedRef[],
): InventoryItem[] {
  const collections = [
    {
      kind: 'weapon' as const,
      entries: source.overlays.weapons ?? source.character.weapons,
      sourceRoot: source.overlays.weapons ? 'source.overlays.weapons' : 'source.character.weapons',
    },
    {
      kind: 'armour' as const,
      entries: source.overlays.armour ?? source.character.armour,
      sourceRoot: source.overlays.armour ? 'source.overlays.armour' : 'source.character.armour',
    },
    {
      kind: 'trapping' as const,
      entries: source.overlays.trappings ?? source.character.trappings,
      sourceRoot: source.overlays.trappings ? 'source.overlays.trappings' : 'source.character.trappings',
    },
  ];
  const inventory: InventoryItem[] = [];
  for (const collection of collections) {
    collection.entries.forEach((entry, localIndex) => {
      const outputIndex = inventory.length;
      const name = entry.name as string;
      const sourcePath = collection.sourceRoot.split('.') as Path;
      const match = resolveReference({
        kind: collection.kind,
        legacyName: name,
        sourcePath: [...sourcePath, localIndex, 'name'],
        outputPath: `inventory.${outputIndex}.definitionRef`,
      }, context.resolutions, diagnostics, unresolvedRefs);
      const id = deterministicKey(`legacy.${collection.kind}`, localIndex);
      adapterWarning(
        diagnostics,
        'legacy_inferred_value',
        [...sourcePath, localIndex],
        `Inventory id ${quoteDiagnosticValue(id)} and quantity 1 were deterministically inferred.`,
      );
      const state = safeRecord<JsonValue>();
      state.legacyKind = collection.kind;
      state.legacy = asExtensionRecord(entry);
      inventory.push({
        id,
        name,
        ...(match ? { definitionRef: match.ref } : {}),
        quantity: 1,
        state,
      });
    });
  }
  return inventory;
}

function buildNamedAbilities(
  kind: 'spell' | 'prayer',
  ids: readonly string[],
  context: DecodedAdapterContext,
  diagnostics: Diagnostic[],
  unresolvedRefs: UnresolvedRef[],
): NamedAbility[] {
  const abilities: NamedAbility[] = [];
  ids.forEach((id, index) => {
    const collection = kind === 'spell' ? 'spells' : 'prayers';
    const sourceField = kind === 'spell' ? 'knownSpells' : 'knownPrayers';
    const subject: ReferenceSubject = {
      kind,
      legacyId: id,
      sourcePath: ['source', 'character', sourceField, index],
      outputPath: `abilities.${collection}.${index}.definitionRef`,
    };
    const match = resolveReference(subject, context.resolutions, diagnostics, unresolvedRefs);
    if (!match) return;
    const name = nonBlank(match.displayName) ?? nonBlank(match.ref.name);
    if (!name) {
      const reason = `Resolved ${kind} ${quoteDiagnosticValue(id)} has no caller-supplied display name.`;
      adapterWarning(diagnostics, 'legacy_unresolved_reference', subject.sourcePath, reason);
      unresolvedRefs.push(unresolvedEntry(subject, reason, 'legacy.missing-display-name', match.ref));
      return;
    }
    abilities.push({ name, definitionRef: match.ref, source: 'legacy-v1' });
  });
  return abilities;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function effectiveSpellIds(source: DecodedLegacyCharacterSource): string[] {
  const defaults = source.character.knownSpells ?? [];
  const added = source.overlays.spellbook?.added ?? [];
  const removed = new Set(source.overlays.spellbook?.removed ?? []);
  return uniqueStrings([...defaults, ...added]).filter(id => !removed.has(id));
}

function buildCandidate(
  source: DecodedLegacyCharacterSource,
  context: DecodedAdapterContext,
  diagnostics: Diagnostic[],
): CharacterDocumentV2 | undefined {
  const character = source.character;
  const overlays = source.overlays;
  const unresolvedRefs: UnresolvedRef[] = [];

  const species = resolveReference({
    kind: 'species',
    ...(character.raceId ? { legacyId: character.raceId } : { legacyName: character.species }),
    sourcePath: ['source', 'character', character.raceId ? 'raceId' : 'species'],
    outputPath: 'identity.speciesRef',
  }, context.resolutions, diagnostics, unresolvedRefs);
  const career = resolveReference({
    kind: 'career',
    ...(character.careerId ? { legacyId: character.careerId } : { legacyName: character.career }),
    sourcePath: ['source', 'character', character.careerId ? 'careerId' : 'career'],
    outputPath: 'identity.careerRef',
  }, context.resolutions, diagnostics, unresolvedRefs);

  const storedCareerRank = character.careerRanks.find(rank => rank.level === character.careerLevel);
  if (!storedCareerRank) {
    diagnostics.push(makeDiagnostic(
      'snapshot_mismatch',
      ['source', 'character', 'careerLevel'],
      'Stored current careerLevel must have an exact careerRanks entry.',
    ));
    return undefined;
  }
  if (character.careerLevelName !== storedCareerRank.name) {
    diagnostics.push(makeDiagnostic(
      'snapshot_mismatch',
      ['source', 'character', 'careerLevelName'],
      'Stored careerLevelName must exactly match the current careerRanks entry.',
    ));
  }
  if (character.status !== storedCareerRank.status) {
    diagnostics.push(makeDiagnostic(
      'snapshot_mismatch',
      ['source', 'character', 'status'],
      'Stored status must exactly match the current careerRanks entry.',
    ));
  }
  if (hasErrorDiagnostics(diagnostics)) return undefined;

  const careerLevel = overlays.careerLevel ?? character.careerLevel;
  const careerRank = character.careerRanks.find(rank => rank.level === careerLevel);
  if (!careerRank) {
    diagnostics.push(makeDiagnostic(
      'legacy_unmapped_value',
      overlays.careerLevel === undefined
        ? ['source', 'character', 'careerLevel']
        : ['source', 'overlays', 'career.level'],
      'Current career level has no exact careerRanks entry; a V2 career snapshot cannot be produced.',
    ));
    return undefined;
  }
  adapterWarning(
    diagnostics,
    'legacy_unmapped_value',
    ['source', 'character', 'careerRanks'],
    'Legacy careerRanks describe a path, not dated history; only the exact current rank was projected.',
  );
  adapterWarning(
    diagnostics,
    'legacy_unmapped_value',
    ['source', 'character', 'movement'],
    'Legacy movement has no V2 core field and is preserved only in legacyExtensions.',
  );

  const xp = overlays.xp ?? {
    current: character.xpCurrent,
    spent: character.xpSpent,
    log: source.xpLogSeed ?? [],
  };
  adapterWarning(
    diagnostics,
    'legacy_inferred_value',
    ['progression', 'experience', 'earned'],
    'Experience earned was inferred as current plus spent.',
  );
  const experienceEntries = xp.log.map((entry, index) => {
    const kind = entry.kind ?? 'legacy';
    if (!entry.kind) {
      adapterWarning(
        diagnostics,
        'legacy_inferred_value',
        ['source', overlays.xp ? 'overlays' : 'xpLogSeed', ...(overlays.xp ? ['xp', 'log'] : []), index, 'kind'],
        'Missing legacy XP kind was inferred as "legacy".',
      );
    }
    return {
      ...(entry.date ? { dateLabel: entry.date } : {}),
      reason: entry.reason,
      delta: entry.amount,
      kind,
      ...(entry.entityKey ? { entityKey: entry.entityKey } : {}),
    };
  });

  const characteristics = safeRecord<CharacterDocumentV2['stats']['characteristics'][string]>();
  const characteristicKeys = new Set(character.characteristics.map(entry => entry.key));
  for (const key of Object.keys(overlays.characteristicAdvances ?? {})) {
    if (!characteristicKeys.has(key)) {
      adapterWarning(
        diagnostics,
        'legacy_unmapped_value',
        ['source', 'overlays', 'chars.adv', key],
        'Characteristic advance has no exact owner and is preserved only in legacyExtensions.',
      );
    }
  }
  character.characteristics.forEach((entry) => {
    characteristics[entry.key] = {
      label: entry.name,
      short: entry.short,
      base: entry.init,
      advances: overlays.characteristicAdvances?.[entry.key] ?? entry.adv,
      source: 'legacy-v1',
    };
  });

  const allSkills = [...character.skills, ...(overlays.extraSkills ?? [])];
  const skillAdvances = applySkillAdvances(allSkills, overlays.skillAdvances, diagnostics);
  const skills = safeRecord<SkillStat>();
  allSkills.forEach((entry, index) => {
    const fromExtra = index >= character.skills.length;
    const localIndex = fromExtra ? index - character.skills.length : index;
    const sourcePath: Path = fromExtra
      ? ['source', 'overlays', 'skills.extra', localIndex]
      : ['source', 'character', 'skills', localIndex];
    const outputKey = deterministicKey('legacy.skill', index);
    const match = resolveReference({
      kind: 'skill',
      ...(entry.definitionId ? { legacyId: entry.definitionId } : { legacyName: entry.name }),
      sourcePath: [...sourcePath, entry.definitionId ? 'definitionId' : 'name'],
      outputPath: `stats.skills.${outputKey}.definitionRef`,
    }, context.resolutions, diagnostics, unresolvedRefs);
    skills[outputKey] = {
      name: entry.name,
      characteristicKey: entry.char,
      advances: skillAdvances[index],
      career: entry.career,
      advanced: entry.advanced ?? false,
      ...(nonBlank(entry.grouped) ? { grouped: entry.grouped } : {}),
      ...(match ? { definitionRef: match.ref } : {}),
      source: 'legacy-v1',
    };
  });

  const allTalents = [...character.talents, ...(overlays.addedTalents ?? [])];
  const talentRanks = applyTalentRanks(allTalents, overlays.talentTimes, diagnostics);
  const talents: TalentAbility[] = allTalents.map((entry, index) => {
    const fromAdded = index >= character.talents.length;
    const localIndex = fromAdded ? index - character.talents.length : index;
    const sourcePath: Path = fromAdded
      ? ['source', 'overlays', 'talents.added', localIndex]
      : ['source', 'character', 'talents', localIndex];
    const match = resolveReference({
      kind: 'talent',
      ...(entry.definitionId ? { legacyId: entry.definitionId } : { legacyName: entry.name }),
      ...(entry.specialization ? { specialization: entry.specialization } : {}),
      sourcePath: [...sourcePath, entry.definitionId ? 'definitionId' : 'name'],
      outputPath: `abilities.talents.${index}.definitionRef`,
    }, context.resolutions, diagnostics, unresolvedRefs);
    return {
      name: entry.name,
      rank: talentRanks[index],
      ...(entry.specialization ? { specialization: entry.specialization } : {}),
      ...(match ? { definitionRef: match.ref } : {}),
      source: 'legacy-v1',
    };
  });
  const spells = buildNamedAbilities(
    'spell', effectiveSpellIds(source), context, diagnostics, unresolvedRefs,
  );
  const prayers = buildNamedAbilities(
    'prayer', character.knownPrayers ?? [], context, diagnostics, unresolvedRefs,
  );

  const resources = safeRecord<CharacterDocumentV2['resources'][string]>();
  const vitalSeeds: Record<string, number> = {
    fate: character.fate,
    fortune: character.fortune,
    resilience: character.resilience,
    resolve: character.resolve,
    corruption: character.corruption,
  };
  for (const key of Object.keys({ ...vitalSeeds, ...(overlays.vitals ?? {}) }).sort()) {
    resources[key] = { current: overlays.vitals?.[key] ?? vitalSeeds[key], source: 'legacy-v1' };
  }
  resources.wounds = {
    current: overlays.wounds ?? character.wounds.current,
    maxOverride: character.wounds.max,
    source: 'legacy-v1',
  };
  resources.sin = { current: overlays.sin ?? character.sin, source: 'legacy-v1' };
  if (overlays.advantage !== undefined) {
    resources.advantage = { current: overlays.advantage, source: 'legacy-v1' };
  }
  if (overlays.magicPool !== undefined) {
    resources['magic.pool'] = { current: overlays.magicPool, source: 'legacy-v1' };
  }

  const inventory = buildInventory(source, context, diagnostics, unresolvedRefs);

  const conditionSource = overlays.conditions ?? character.conditions;
  const conditionEntries = Array.isArray(conditionSource)
    ? conditionSource.map(entry => ({ name: entry.type as string, stacks: entry.stacks as number }))
    : Object.keys(conditionSource).map(name => ({
      name,
      stacks: (conditionSource as Readonly<Record<string, number>>)[name],
    }));
  const conditions = conditionEntries.map((entry, index) => {
    const fromOverlayMap = !Array.isArray(conditionSource);
    const match = resolveReference({
      kind: 'condition',
      legacyName: entry.name,
      sourcePath: fromOverlayMap
        ? ['source', 'overlays', 'conditions', entry.name]
        : ['source', overlays.conditions ? 'overlays' : 'character', 'conditions', index, 'type'],
      outputPath: `state.conditions.${index}.definitionRef`,
    }, context.resolutions, diagnostics, unresolvedRefs);
    return { name: entry.name, stacks: entry.stacks, ...(match ? { definitionRef: match.ref } : {}) };
  });

  const criticalSource = overlays.criticals ?? character.criticals;
  const criticals = criticalSource.map((entry, index) => {
    const match = resolveReference({
      kind: 'critical',
      legacyName: entry.name as string,
      sourcePath: ['source', overlays.criticals ? 'overlays' : 'character', 'criticals', index, 'name'],
      outputPath: `state.criticals.${index}.definitionRef`,
    }, context.resolutions, diagnostics, unresolvedRefs);
    return {
      name: entry.name as string,
      loc: entry.loc as string,
      roll: entry.roll as number,
      effect: entry.effect as string,
      days: entry.days as number,
      ...(match ? { definitionRef: match.ref } : {}),
    };
  });

  const mutationSource = overlays.mutations ?? character.mutations;
  const mutations = mutationSource.map((entry, index) => {
    const match = resolveReference({
      kind: 'mutation',
      legacyName: entry.name as string,
      sourcePath: ['source', overlays.mutations ? 'overlays' : 'character', 'mutations', index, 'name'],
      outputPath: `state.mutations.${index}.definitionRef`,
    }, context.resolutions, diagnostics, unresolvedRefs);
    return { name: entry.name as string, ...(match ? { definitionRef: match.ref } : {}) };
  });

  const equipmentState = safeRecord<JsonValue>();
  equipmentState.ap = (overlays.ap ?? character.ap) as unknown as JsonValue;
  equipmentState.wealth = (overlays.wealth ?? character.wealth) as unknown as JsonValue;

  const identityOverlay = overlays.identity;
  const identityName = nonBlank(identityOverlay?.name) ?? character.name;
  const userContent = safeRecord<JsonValue>();
  userContent.party = character.party as unknown as JsonValue;
  userContent.initials = character.initials;
  userContent.avatarAccent = character.accent;
  if (character.isCaster !== undefined) userContent.isCaster = character.isCaster;
  if (character.isAnointed !== undefined) userContent.isAnointed = character.isAnointed;
  if (character.deity) userContent.deity = character.deity;
  if (character.spellLore) userContent.spellLore = character.spellLore;

  const legacyV1 = safeRecord<JsonValue>();
  legacyV1.character = source.rawCharacter;
  legacyV1.overlays = source.rawOverlays;
  if (source.rawXpLogSeed !== undefined) legacyV1.xpLogSeed = source.rawXpLogSeed;
  const legacyExtensions = safeRecord<JsonValue>();
  legacyExtensions.legacyV1 = legacyV1;

  adapterWarning(
    diagnostics,
    'legacy_inferred_value',
    ['origin', 'timestampsInferred'],
    'Legacy data had no trustworthy lifecycle timestamps; caller-supplied timestamps were used.',
  );

  const origin: CharacterOrigin = {
    kind: context.originKind,
    sourceId: context.sourceId,
    importerId: ADAPTER_ID,
    importedAt: context.importedAt,
    platform: context.platform,
    adapterVersion: ADAPTER_VERSION,
    timestampsInferred: true,
    ...(context.sourceHash ? { sourceHash: context.sourceHash } : {}),
  };

  return {
    $schema: 'grimcomp.character.v2',
    id: character.id,
    revision: context.revision,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
    rulesetRef: context.rulesetRef,
    profileBinding: context.profileBinding,
    identity: {
      name: identityName,
      ...(species ? { speciesRef: species.ref } : {}),
      ...(career ? { careerRef: career.ref } : {}),
      speciesName: character.species,
      className: character.class,
      age: identityOverlay?.age ?? character.age,
      ...(nonBlank(identityOverlay?.height ?? character.height) ? { height: identityOverlay?.height ?? character.height } : {}),
      ...(nonBlank(identityOverlay?.hair ?? character.hair) ? { hair: identityOverlay?.hair ?? character.hair } : {}),
      ...(nonBlank(identityOverlay?.eyes ?? character.eyes) ? { eyes: identityOverlay?.eyes ?? character.eyes } : {}),
    },
    progression: {
      experience: {
        earned: xp.current + xp.spent,
        spent: xp.spent,
        entries: experienceEntries,
        extensions: { legacyCurrent: xp.current },
      },
      careerHistory: [{
        ...(career ? { careerRef: career.ref } : {}),
        careerName: character.career,
        className: character.class,
        level: careerLevel,
        levelName: careerRank.name,
        status: careerRank.status,
      }],
      advances: [],
    },
    stats: { characteristics, skills },
    resources,
    abilities: {
      talents,
      spells,
      prayers,
      traits: [],
    },
    inventory,
    state: {
      conditions,
      criticals,
      mutations,
      psychology: [...(overlays.psychology ?? character.psychology)],
      equipmentState,
    },
    narrative: {
      ...(nonBlank(identityOverlay?.ambitionsShort ?? character.ambitionsShort)
        ? { ambitionsShort: identityOverlay?.ambitionsShort ?? character.ambitionsShort } : {}),
      ...(nonBlank(identityOverlay?.ambitionsLong ?? character.ambitionsLong)
        ? { ambitionsLong: identityOverlay?.ambitionsLong ?? character.ambitionsLong } : {}),
      ...(nonBlank(identityOverlay?.motivation ?? character.motivation)
        ? { motivation: identityOverlay?.motivation ?? character.motivation } : {}),
    },
    notes: [],
    userContent,
    origin,
    unresolvedRefs,
    legacyExtensions,
  };
}

export function adaptLegacyCharacterV1(
  rawSource: LegacyCharacterSourceV1,
  rawContext: LegacyCharacterAdapterContext,
): LegacyAdapterResult<CharacterDocumentV2> {
  const source = decodeLegacyCharacterSourceV1(rawSource);
  const context = decodeAdapterContext(rawContext);
  const diagnostics = [
    ...source.diagnostics,
    ...context.diagnostics,
  ];
  if (!source.ok || !context.ok) return decodeFailure(diagnostics);
  const candidate = buildCandidate(source.value, context.value, diagnostics);
  if (!candidate || hasErrorDiagnostics(diagnostics)) return decodeFailure(diagnostics);
  const strict = decodeCharacterDocumentV2(candidate);
  const combined = [...diagnostics, ...strict.diagnostics];
  return strict.ok && !hasErrorDiagnostics(combined)
    ? decodeSuccess(strict.value, combined)
    : decodeFailure(combined);
}

function prefixedDiagnostics(prefix: Path, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map(diagnostic => ({ ...diagnostic, path: [...prefix, ...diagnostic.path] }));
}

export function adaptLegacyRosterV1(
  rawEntries: readonly LegacyRosterEntry[],
  rawContext: LegacyEnvelopeContext,
): LegacyAdapterResult<ExchangeEnvelopeV1> {
  // Snapshot the complete request before indexing it. This rejects hostile
  // arrays/proxies and applies one global safety bound to a roster conversion.
  const request = decodeInertLegacyRecord({ entries: rawEntries, context: rawContext }, 'roster');
  if (!request.ok) return request;
  const diagnostics = [...request.diagnostics];
  const entries = request.value.entries;
  const envelopeContext = ownRecord(request.value.context);
  if (!Array.isArray(entries)) {
    diagnostics.push(makeDiagnostic('invalid_type', ['roster', 'entries'], 'entries must be an array.'));
  }
  if (!envelopeContext) {
    diagnostics.push(makeDiagnostic('invalid_type', ['roster', 'context'], 'context must be an object.'));
  }
  if (!Array.isArray(entries) || !envelopeContext) return decodeFailure(diagnostics);

  const allowedEnvelopeContextKeys = new Set([
    'producer', 'producedAt', 'sourceProfiles', 'campaignProfiles',
    'contentPackMetadata', 'extensions',
  ]);
  for (const key of Object.keys(envelopeContext)) {
    if (!allowedEnvelopeContextKeys.has(key)) {
      diagnostics.push(makeDiagnostic(
        'unknown_key',
        ['roster', 'context', key],
        'Unknown envelope context field.',
      ));
    }
  }

  const characters: CharacterDocumentV2[] = [];
  entries.forEach((rawEntry, index) => {
    const entry = ownRecord(rawEntry);
    if (!entry) {
      diagnostics.push(makeDiagnostic('invalid_type', ['roster', 'entries', index], 'Roster entry must be an object.'));
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!['source', 'context'].includes(key)) {
        diagnostics.push(makeDiagnostic(
          'unknown_key',
          ['roster', 'entries', index, key],
          'Unknown roster entry field.',
        ));
      }
    }
    const adapted = adaptLegacyCharacterV1(
      entry.source as unknown as LegacyCharacterSourceV1,
      entry.context as unknown as LegacyCharacterAdapterContext,
    );
    diagnostics.push(...prefixedDiagnostics(['roster', 'entries', index], adapted.diagnostics));
    if (adapted.ok) characters.push(adapted.value);
  });
  if (hasErrorDiagnostics(diagnostics) || characters.length !== entries.length) {
    return decodeFailure(diagnostics);
  }

  const candidate: ExchangeEnvelopeV1 = {
    $schema: 'grimcomp.exchange.v1',
    producer: envelopeContext.producer as unknown as ExchangeEnvelopeV1['producer'],
    producedAt: envelopeContext.producedAt as string,
    characters,
    sourceProfiles: envelopeContext.sourceProfiles as unknown as ExchangeEnvelopeV1['sourceProfiles'],
    campaignProfiles: envelopeContext.campaignProfiles as unknown as ExchangeEnvelopeV1['campaignProfiles'],
    contentPackMetadata:
      envelopeContext.contentPackMetadata as unknown as ExchangeEnvelopeV1['contentPackMetadata'],
    ...(envelopeContext.extensions
      ? { extensions: envelopeContext.extensions as ExtensionRecord }
      : {}),
  };
  const strict = decodeExchangeEnvelopeV1(candidate);
  const combined = [...diagnostics, ...strict.diagnostics];
  return strict.ok && !hasErrorDiagnostics(combined)
    ? decodeSuccess(strict.value, combined)
    : decodeFailure(combined);
}
