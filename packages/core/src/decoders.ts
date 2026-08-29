import {
  decodeFailure,
  decodeSuccess,
  hasErrorDiagnostics,
  makeDiagnostic,
  quoteDiagnosticValue,
  type DecodeResult,
  type Diagnostic,
} from './diagnostics';
import {
  DecodeContext,
  child,
  readArray,
  readBoolean,
  readEnum,
  readExtensionRecord,
  readFiniteNumber,
  readInteger,
  readObject,
  readOptionalBoolean,
  readOptionalFiniteNumber,
  readOptionalId,
  readOptionalInteger,
  readOptionalString,
  rejectUnknownKeys,
  readSchema,
  readString,
  readStringArray,
  safeRecord,
  type DecodePath,
  type UnknownRecord,
} from './decodeSupport';
import { evaluateVersionRange } from './versionRange';
import type {
  CampaignProfileV1,
  CareerHistorySnapshot,
  CharacterAbilities,
  CharacterAdvance,
  CharacterCondition,
  CharacterCritical,
  CharacterDocumentV2,
  CharacterIdentity,
  CharacterMutation,
  CharacterNarrative,
  CharacterNote,
  CharacterOrigin,
  CharacterProfileBinding,
  CharacterProgression,
  CharacterResourceValue,
  CharacterState,
  CharacterStats,
  CharacteristicStat,
  ContentClass,
  ContentOrigin,
  ContentPackMetadataV1,
  ContentRightsDeclaration,
  DefinitionRef,
  ExchangeEnvelopeV1,
  ExchangeProducer,
  ExperienceEntry,
  ExperienceLedger,
  ExtensionRecord,
  InventoryItem,
  MissingPackPolicy,
  NamedAbility,
  PackConflict,
  PackDependency,
  PackLockEntry,
  RightsBasis,
  RightsDistribution,
  RightsReviewStatus,
  RightsSharing,
  RuleOptionValue,
  RulesetRef,
  Sha256Hash,
  SkillStat,
  SourcePackSelection,
  SourceProfilePolicy,
  SourceProfileV1,
  TalentAbility,
  UnresolvedRef,
} from './types';

const CONTENT_ORIGINS = ['bundled', 'user-authored', 'user-imported', 'external-import'] as const;
const RIGHTS_BASES = [
  'licensed', 'open-license', 'public-domain', 'user-authored', 'metadata-only', 'unknown',
] as const;
const RIGHTS_REVIEW_STATUSES = ['unreviewed', 'pending', 'approved', 'rejected', 'expired'] as const;
const RIGHTS_DISTRIBUTIONS = ['bundled', 'private-import', 'metadata-only', 'prohibited'] as const;
const RIGHTS_SHARING = ['none', 'references-only', 'full'] as const;
const CONTENT_CLASSES = ['mechanics', 'facts', 'prose', 'tables', 'art'] as const;
const MISSING_PACK_POLICIES = ['block', 'warn'] as const;
const PROFILE_BINDING_KINDS = ['source', 'campaign', 'detached'] as const;
const ORIGIN_KINDS = ['created', 'template', 'imported'] as const;
const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function everyDefined(values: readonly unknown[]): boolean {
  return values.every(value => value !== undefined);
}

function validateVersionText(
  version: string,
  context: DecodeContext,
  path: DecodePath,
  label: string,
): boolean {
  const evaluated = evaluateVersionRange(version, '*');
  if (evaluated.ok) return true;
  context.error('invalid_version', path, `${label} must be a Semantic Versioning 2.0.0 version.`);
  return false;
}

function validateVersionRangeText(
  range: string,
  context: DecodeContext,
  path: DecodePath,
  label: string,
): boolean {
  const evaluated = evaluateVersionRange('0.0.0', range);
  if (evaluated.ok) return true;
  context.error(
    'invalid_version_range',
    path,
    `${label} must use the supported Semantic Versioning range grammar: ${evaluated.message}`,
  );
  return false;
}

function validatePinnedVersionRange(
  pinnedVersion: string | undefined,
  versionRange: string | undefined,
  context: DecodeContext,
  path: DecodePath,
): void {
  if (pinnedVersion === undefined || versionRange === undefined) return;
  const evaluated = evaluateVersionRange(pinnedVersion, versionRange);
  if (!evaluated.ok) return;
  if (!evaluated.matches) {
    context.error(
      'version_mismatch',
      child(path, 'pinnedVersion'),
      'pinnedVersion must satisfy versionRange.',
    );
  }
}

function readStringAllowBlank(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): string | undefined {
  const value = object[key];
  if (typeof value !== 'string') {
    context.error('invalid_type', child(path, key), key + ' must be a string.');
    return undefined;
  }
  return value;
}

function readNonnegativeFiniteNumber(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): number | undefined {
  const value = readFiniteNumber(object, key, context, path);
  if (value !== undefined && value < 0) {
    context.error('out_of_range', child(path, key), key + ' must be >= 0.');
    return undefined;
  }
  return value;
}

function optionalExtensions(
  object: UnknownRecord,
  context: DecodeContext,
  path: DecodePath,
): ExtensionRecord | undefined {
  return readExtensionRecord(object, 'extensions', context, path);
}

function parseObjectArray<T>(
  values: unknown[] | undefined,
  context: DecodeContext,
  path: DecodePath,
  parser: (value: unknown, context: DecodeContext, path: DecodePath) => T | undefined,
): T[] | undefined {
  if (!values) return undefined;
  const decoded: T[] = [];
  let valid = true;
  values.forEach((value, index) => {
    const result = parser(value, context, child(path, index));
    if (result === undefined) valid = false;
    else decoded.push(result);
  });
  return valid ? decoded : undefined;
}

function validateUniqueBy<T>(
  entries: readonly T[],
  valueOf: (entry: T) => string | number,
  context: DecodeContext,
  path: DecodePath,
  field: string | undefined,
  label: string,
  code: 'duplicate_id' | 'duplicate_value' = 'duplicate_id',
): void {
  const seen = new Set<string | number>();
  entries.forEach((entry, index) => {
    const value = valueOf(entry);
    if (seen.has(value)) {
      context.error(
        code,
        field ? child(child(path, index), field) : child(path, index),
        label + ' must be unique; duplicate ' + quoteDiagnosticValue(value) + '.',
      );
    } else seen.add(value);
  });
}

function parseEnumArray<const T extends readonly string[]>(
  object: UnknownRecord,
  key: string,
  allowed: T,
  context: DecodeContext,
  path: DecodePath,
): T[number][] | undefined {
  const values = readArray(object, key, context, path);
  if (!values) return undefined;
  const decoded: T[number][] = [];
  let valid = true;
  values.forEach((value, index) => {
    const valuePath = child(child(path, key), index);
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      context.error('invalid_enum', valuePath, key + ' entries must be one of: ' + allowed.join(', ') + '.');
      valid = false;
    } else {
      decoded.push(value as T[number]);
    }
  });
  return valid ? decoded : undefined;
}

function parseKeyedRecord<T>(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
  label: string,
  parser: (value: unknown, context: DecodeContext, path: DecodePath) => T | undefined,
): Record<string, T> | undefined {
  const object = readObject(raw, context, path, label);
  if (!object) return undefined;
  const decoded = safeRecord<T>();
  let valid = true;
  for (const key in object) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const value = object[key];
    if (!context.consumeNode(child(path, key))) return undefined;
    if (key.trim().length === 0) {
      context.error('blank_id', child(path, key), label + ' keys must not be blank.');
      valid = false;
      continue;
    }
    const entry = parser(value, context, child(path, key));
    if (entry === undefined) valid = false;
    else decoded[key] = entry;
  }
  return valid ? decoded : undefined;
}

function parseTimestampText(
  value: string,
  context: DecodeContext,
  path: DecodePath,
  label: string,
): string | undefined {
  const match = RFC3339.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day <= daysInMonth[month - 1]) return value;
  }
  context.error('invalid_timestamp', path, label + ' must be an RFC 3339 timestamp.');
  return undefined;
}

function readTimestamp(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): string | undefined {
  const value = readString(object, key, context, path);
  return value === undefined ? undefined : parseTimestampText(value, context, child(path, key), key);
}

function readOptionalTimestamp(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return readTimestamp(object, key, context, path);
}

function validateTimestampOrder(
  earlier: string | undefined,
  later: string | undefined,
  context: DecodeContext,
  laterPath: DecodePath,
): void {
  if (earlier !== undefined && later !== undefined && compareTimestampInstants(later, earlier) < 0) {
    context.error('timestamp_order', laterPath, 'updated/end timestamp must not precede created/start timestamp.');
  }
}

function compareTimestampInstants(left: string, right: string): number {
  const fractionPattern = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/;
  const withoutFraction = (value: string) => value.replace(fractionPattern, '');
  const leftSecond = Date.parse(withoutFraction(left));
  const rightSecond = Date.parse(withoutFraction(right));
  if (leftSecond !== rightSecond) return leftSecond < rightSecond ? -1 : 1;

  const leftFraction = fractionPattern.exec(left)?.[1] ?? '';
  const rightFraction = fractionPattern.exec(right)?.[1] ?? '';
  const width = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(width, '0');
  const normalizedRight = rightFraction.padEnd(width, '0');
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
}

function parseHashText(
  value: string,
  context: DecodeContext,
  path: DecodePath,
  label: string,
): Sha256Hash | undefined {
  if (!SHA256.test(value)) {
    context.error('invalid_hash', path, label + ' must use sha256: followed by 64 lowercase hexadecimal characters.');
    return undefined;
  }
  return value as Sha256Hash;
}

function readHash(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): Sha256Hash | undefined {
  const value = readString(object, key, context, path);
  return value === undefined ? undefined : parseHashText(value, context, child(path, key), key);
}

function readOptionalHash(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): Sha256Hash | undefined {
  if (object[key] === undefined) return undefined;
  return readHash(object, key, context, path);
}

function parseRulesetRefValue(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): RulesetRef | undefined {
  const object = readObject(raw, context, path, 'rulesetRef');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['id', 'edition', 'rulesVersion', 'engineApiVersion', 'extensions'], context, path,
  );
  const id = readString(object, 'id', context, path, { id: true, rulesetIdentity: true });
  const edition = readString(object, 'edition', context, path, { rulesetIdentity: true });
  const rulesVersion = readString(object, 'rulesVersion', context, path, { rulesetIdentity: true });
  const engineApiVersion = readString(object, 'engineApiVersion', context, path, { rulesetIdentity: true });
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([id, edition, rulesVersion, engineApiVersion])) return undefined;
  return {
    id: id!, edition: edition!, rulesVersion: rulesVersion!, engineApiVersion: engineApiVersion!,
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeRulesetRef(raw: unknown): DecodeResult<RulesetRef> {
  const context = new DecodeContext();
  return context.finish(parseRulesetRefValue(raw, context, []));
}

function parseDependency(raw: unknown, context: DecodeContext, path: DecodePath): PackDependency | undefined {
  const object = readObject(raw, context, path, 'dependency');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['id', 'versionRange', 'optional', 'reason', 'extensions'], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const versionRange = readString(object, 'versionRange', context, path);
  const optional = readOptionalBoolean(object, 'optional', context, path);
  const reason = readOptionalString(object, 'reason', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (versionRange !== undefined) {
    validateVersionRangeText(versionRange, context, child(path, 'versionRange'), 'versionRange');
  }
  if (!everyDefined([id, versionRange])) return undefined;
  return {
    id: id!, versionRange: versionRange!,
    ...(optional !== undefined ? { optional } : {}),
    ...(reason ? { reason } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseConflict(raw: unknown, context: DecodeContext, path: DecodePath): PackConflict | undefined {
  const object = readObject(raw, context, path, 'conflict');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['id', 'versionRange', 'reason', 'extensions'], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const versionRange = readOptionalString(object, 'versionRange', context, path);
  const reason = readOptionalString(object, 'reason', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (versionRange !== undefined) {
    validateVersionRangeText(versionRange, context, child(path, 'versionRange'), 'versionRange');
  }
  if (id === undefined) return undefined;
  return {
    id,
    ...(versionRange ? { versionRange } : {}),
    ...(reason ? { reason } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseRights(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ContentRightsDeclaration | undefined {
  const object = readObject(raw, context, path, 'rights');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'basis', 'reviewStatus', 'distribution', 'sharing', 'contentClasses', 'rightsHolder',
    'licenseId', 'licenseUrl', 'permissionRef', 'attribution', 'reviewedAt', 'extensions',
  ], context, path);
  const basis = readEnum(object, 'basis', RIGHTS_BASES, context, path) as RightsBasis | undefined;
  const reviewStatus = readEnum(
    object, 'reviewStatus', RIGHTS_REVIEW_STATUSES, context, path,
  ) as RightsReviewStatus | undefined;
  const distribution = readEnum(
    object, 'distribution', RIGHTS_DISTRIBUTIONS, context, path,
  ) as RightsDistribution | undefined;
  const sharing = readEnum(object, 'sharing', RIGHTS_SHARING, context, path) as RightsSharing | undefined;
  const contentClasses = parseEnumArray(
    object, 'contentClasses', CONTENT_CLASSES, context, path,
  ) as ContentClass[] | undefined;
  const rightsHolder = readOptionalString(object, 'rightsHolder', context, path);
  const licenseId = readOptionalString(object, 'licenseId', context, path);
  const licenseUrl = readOptionalString(object, 'licenseUrl', context, path);
  const permissionRef = readOptionalString(object, 'permissionRef', context, path);
  const attribution = readOptionalString(object, 'attribution', context, path);
  const reviewedAt = readOptionalTimestamp(object, 'reviewedAt', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (contentClasses) {
    validateUniqueBy(
      contentClasses,
      value => value,
      context,
      child(path, 'contentClasses'),
      undefined,
      'Content classes',
      'duplicate_value',
    );
  }
  if (!everyDefined([basis, reviewStatus, distribution, sharing, contentClasses])) return undefined;
  return {
    basis: basis!, reviewStatus: reviewStatus!, distribution: distribution!,
    sharing: sharing!, contentClasses: contentClasses!,
    ...(rightsHolder ? { rightsHolder } : {}),
    ...(licenseId ? { licenseId } : {}),
    ...(licenseUrl ? { licenseUrl } : {}),
    ...(permissionRef ? { permissionRef } : {}),
    ...(attribution ? { attribution } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseContentPackMetadata(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ContentPackMetadataV1 | undefined {
  const object = readObject(raw, context, path, 'content pack metadata');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    '$schema', 'id', 'name', 'version', 'rulesetRef', 'origin', 'dependencies',
    'conflicts', 'rights', 'extensions',
  ], context, path);
  const schema = readSchema(object, 'grimcomp.content-metadata.v1', context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const name = readString(object, 'name', context, path);
  const version = readString(object, 'version', context, path);
  const rulesetRef = parseRulesetRefValue(object.rulesetRef, context, child(path, 'rulesetRef'));
  const origin = readEnum(object, 'origin', CONTENT_ORIGINS, context, path) as ContentOrigin | undefined;
  const dependencies = parseObjectArray(
    readArray(object, 'dependencies', context, path), context, child(path, 'dependencies'), parseDependency,
  );
  const conflicts = parseObjectArray(
    readArray(object, 'conflicts', context, path), context, child(path, 'conflicts'), parseConflict,
  );
  const rights = parseRights(object.rights, context, child(path, 'rights'));
  const extensions = optionalExtensions(object, context, path);
  if (version !== undefined) {
    validateVersionText(version, context, child(path, 'version'), 'version');
  }
  if (dependencies) {
    validateUniqueBy(
      dependencies, entry => entry.id, context, child(path, 'dependencies'), 'id', 'Dependency IDs',
    );
  }
  if (conflicts) {
    validateUniqueBy(
      conflicts, entry => entry.id, context, child(path, 'conflicts'), 'id', 'Conflict IDs',
    );
  }
  if (!everyDefined([schema, id, name, version, rulesetRef, origin, dependencies, conflicts, rights])) {
    return undefined;
  }
  return {
    $schema: 'grimcomp.content-metadata.v1',
    id: id!, name: name!, version: version!, rulesetRef: rulesetRef!, origin: origin!,
    dependencies: dependencies!, conflicts: conflicts!, rights: rights!,
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeContentPackMetadataV1(raw: unknown): DecodeResult<ContentPackMetadataV1> {
  const context = new DecodeContext();
  return context.finish(parseContentPackMetadata(raw, context, []));
}

function parseSourcePackSelection(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): SourcePackSelection | undefined {
  const object = readObject(raw, context, path, 'pack selection');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'id', 'versionRange', 'enabled', 'order', 'required', 'pinnedVersion', 'pinnedHash', 'extensions',
  ], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const versionRange = readString(object, 'versionRange', context, path);
  const enabled = readBoolean(object, 'enabled', context, path);
  const order = readInteger(object, 'order', context, path);
  const required = readOptionalBoolean(object, 'required', context, path);
  const pinnedVersion = readOptionalString(object, 'pinnedVersion', context, path);
  const pinnedHash = readOptionalHash(object, 'pinnedHash', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (versionRange !== undefined) {
    validateVersionRangeText(versionRange, context, child(path, 'versionRange'), 'versionRange');
  }
  if (pinnedVersion !== undefined) {
    validateVersionText(pinnedVersion, context, child(path, 'pinnedVersion'), 'pinnedVersion');
  }
  validatePinnedVersionRange(pinnedVersion, versionRange, context, path);
  if (!everyDefined([id, versionRange, enabled, order])) return undefined;
  return {
    id: id!, versionRange: versionRange!, enabled: enabled!, order: order!,
    ...(required !== undefined ? { required } : {}),
    ...(pinnedVersion ? { pinnedVersion } : {}),
    ...(pinnedHash ? { pinnedHash } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseSourceProfilePolicy(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): SourceProfilePolicy | undefined {
  const object = readObject(raw, context, path, 'source profile policy');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['missingPack', 'allowHomebrew', 'allowedRightsStatuses', 'extensions'], context, path,
  );
  const missingPack = readEnum(
    object, 'missingPack', MISSING_PACK_POLICIES, context, path,
  ) as MissingPackPolicy | undefined;
  const allowHomebrew = readBoolean(object, 'allowHomebrew', context, path);
  const allowedRightsStatuses = parseEnumArray(
    object, 'allowedRightsStatuses', RIGHTS_REVIEW_STATUSES, context, path,
  ) as RightsReviewStatus[] | undefined;
  const extensions = optionalExtensions(object, context, path);
  if (allowedRightsStatuses) {
    validateUniqueBy(
      allowedRightsStatuses,
      value => value,
      context,
      child(path, 'allowedRightsStatuses'),
      undefined,
      'Allowed rights statuses',
      'duplicate_value',
    );
  }
  if (!everyDefined([missingPack, allowHomebrew, allowedRightsStatuses])) return undefined;
  return {
    missingPack: missingPack!, allowHomebrew: allowHomebrew!,
    allowedRightsStatuses: allowedRightsStatuses!,
    ...(extensions ? { extensions } : {}),
  };
}

function parseSourceProfile(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): SourceProfileV1 | undefined {
  const object = readObject(raw, context, path, 'source profile');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    '$schema', 'id', 'name', 'rulesetRef', 'packs', 'policy', 'revision',
    'createdAt', 'updatedAt', 'extensions',
  ], context, path);
  const schema = readSchema(object, 'grimcomp.source-profile.v1', context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const name = readString(object, 'name', context, path);
  const rulesetRef = parseRulesetRefValue(object.rulesetRef, context, child(path, 'rulesetRef'));
  const packs = parseObjectArray(
    readArray(object, 'packs', context, path), context, child(path, 'packs'), parseSourcePackSelection,
  );
  const policy = parseSourceProfilePolicy(object.policy, context, child(path, 'policy'));
  const revision = readInteger(object, 'revision', context, path, 1);
  const createdAt = readOptionalTimestamp(object, 'createdAt', context, path);
  const updatedAt = readOptionalTimestamp(object, 'updatedAt', context, path);
  validateTimestampOrder(createdAt, updatedAt, context, child(path, 'updatedAt'));
  const extensions = optionalExtensions(object, context, path);
  if (packs) {
    validateUniqueBy(packs, pack => pack.id, context, child(path, 'packs'), 'id', 'Pack IDs');
    validateUniqueBy(
      packs, pack => pack.order, context, child(path, 'packs'), 'order', 'Pack orders', 'duplicate_value',
    );
  }
  if (!everyDefined([schema, id, name, rulesetRef, packs, policy, revision])) return undefined;
  return {
    $schema: 'grimcomp.source-profile.v1',
    id: id!, name: name!, rulesetRef: rulesetRef!, packs: packs!, policy: policy!, revision: revision!,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeSourceProfileV1(raw: unknown): DecodeResult<SourceProfileV1> {
  const context = new DecodeContext();
  return context.finish(parseSourceProfile(raw, context, []));
}

function parsePackLockEntry(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): PackLockEntry | undefined {
  const object = readObject(raw, context, path, 'pack lock entry');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['id', 'version', 'hash', 'extensions'], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const version = readString(object, 'version', context, path);
  const hash = readHash(object, 'hash', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (version !== undefined) {
    validateVersionText(version, context, child(path, 'version'), 'version');
  }
  if (!everyDefined([id, version, hash])) return undefined;
  return { id: id!, version: version!, hash: hash!, ...(extensions ? { extensions } : {}) };
}

function parsePackLock(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  optional = false,
): PackLockEntry[] | undefined {
  if (optional && object[key] === undefined) return undefined;
  const entries = parseObjectArray(
    readArray(object, key, context, path), context, child(path, key), parsePackLockEntry,
  );
  if (entries) {
    validateUniqueBy(entries, entry => entry.id, context, child(path, key), 'id', 'Pack lock IDs');
  }
  return entries;
}

function parseRuleOptions(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): Record<string, RuleOptionValue> | undefined {
  const object = readObject(raw, context, path, 'ruleOptions');
  if (!object) return undefined;
  const decoded = safeRecord<RuleOptionValue>();
  let valid = true;
  for (const key in object) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const value = object[key];
    if (!context.consumeNode(child(path, key))) return undefined;
    if (key.trim().length === 0) {
      context.error('blank_id', child(path, key), 'ruleOptions keys must not be blank.');
      valid = false;
      continue;
    }
    if (
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      || (typeof value === 'number' && !Number.isFinite(value))
    ) {
      context.error('invalid_type', child(path, key), 'ruleOptions values must be finite primitive values.');
      valid = false;
    } else {
      decoded[key] = value;
    }
  }
  return valid ? decoded : undefined;
}

function parseCampaignProfile(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CampaignProfileV1 | undefined {
  const object = readObject(raw, context, path, 'campaign profile');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    '$schema', 'id', 'name', 'rulesetRef', 'sourceProfileId', 'pinnedResolutionHash',
    'packLock', 'houseRulePackIds', 'ruleOptions', 'revision', 'createdAt', 'updatedAt', 'extensions',
  ], context, path);
  const schema = readSchema(object, 'grimcomp.campaign-profile.v1', context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const name = readString(object, 'name', context, path);
  const rulesetRef = parseRulesetRefValue(object.rulesetRef, context, child(path, 'rulesetRef'));
  const sourceProfileId = readString(object, 'sourceProfileId', context, path, { id: true });
  const pinnedResolutionHash = readHash(object, 'pinnedResolutionHash', context, path);
  const packLock = parsePackLock(object, 'packLock', context, path);
  const houseRulePackIds = readStringArray(object, 'houseRulePackIds', context, path, true);
  const ruleOptions = parseRuleOptions(object.ruleOptions, context, child(path, 'ruleOptions'));
  const revision = readInteger(object, 'revision', context, path, 1);
  const createdAt = readOptionalTimestamp(object, 'createdAt', context, path);
  const updatedAt = readOptionalTimestamp(object, 'updatedAt', context, path);
  validateTimestampOrder(createdAt, updatedAt, context, child(path, 'updatedAt'));
  const extensions = optionalExtensions(object, context, path);
  if (houseRulePackIds) {
    validateUniqueBy(
      houseRulePackIds,
      id => id,
      context,
      child(path, 'houseRulePackIds'),
      undefined,
      'House-rule pack IDs',
    );
  }
  if (!everyDefined([
    schema, id, name, rulesetRef, sourceProfileId, pinnedResolutionHash,
    packLock, houseRulePackIds, ruleOptions, revision,
  ])) return undefined;
  return {
    $schema: 'grimcomp.campaign-profile.v1',
    id: id!, name: name!, rulesetRef: rulesetRef!, sourceProfileId: sourceProfileId!,
    pinnedResolutionHash: pinnedResolutionHash!, packLock: packLock!,
    houseRulePackIds: houseRulePackIds!, ruleOptions: ruleOptions!, revision: revision!,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeCampaignProfileV1(raw: unknown): DecodeResult<CampaignProfileV1> {
  const context = new DecodeContext();
  return context.finish(parseCampaignProfile(raw, context, []));
}

function parseDefinitionRef(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): DefinitionRef | undefined {
  const object = readObject(raw, context, path, 'definition reference');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['id', 'name', 'packId', 'specialization', 'extensions'], context, path,
  );
  const id = readString(object, 'id', context, path, { id: true });
  const name = readOptionalString(object, 'name', context, path);
  const packId = readOptionalId(object, 'packId', context, path);
  const specialization = readOptionalString(object, 'specialization', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (id === undefined) return undefined;
  return {
    id,
    ...(name ? { name } : {}),
    ...(packId ? { packId } : {}),
    ...(specialization ? { specialization } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseOptionalDefinitionRef(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): DefinitionRef | undefined {
  if (object[key] === undefined) return undefined;
  return parseDefinitionRef(object[key], context, child(path, key));
}

function rejectBindingKey(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): void {
  if (object[key] !== undefined) {
    context.error('missing_profile_binding', child(path, key), key + ' is not valid for this binding kind.');
  }
}

function parseProfileBinding(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterProfileBinding | undefined {
  const object = readObject(raw, context, path, 'profileBinding');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'kind', 'sourceProfileId', 'campaignProfileId', 'resolutionHash', 'packLock', 'extensions',
  ], context, path);
  const kind = readEnum(object, 'kind', PROFILE_BINDING_KINDS, context, path);
  const resolutionHash = readHash(object, 'resolutionHash', context, path);
  const packLock = parsePackLock(object, 'packLock', context, path, true);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([kind, resolutionHash])) return undefined;
  const shared = {
    resolutionHash: resolutionHash!,
    ...(packLock ? { packLock } : {}),
    ...(extensions ? { extensions } : {}),
  };
  if (kind === 'source') {
    const sourceProfileId = readString(object, 'sourceProfileId', context, path, { id: true });
    rejectBindingKey(object, 'campaignProfileId', context, path);
    return sourceProfileId === undefined ? undefined : { kind, sourceProfileId, ...shared };
  }
  if (kind === 'campaign') {
    const campaignProfileId = readString(object, 'campaignProfileId', context, path, { id: true });
    rejectBindingKey(object, 'sourceProfileId', context, path);
    return campaignProfileId === undefined ? undefined : { kind, campaignProfileId, ...shared };
  }
  rejectBindingKey(object, 'sourceProfileId', context, path);
  rejectBindingKey(object, 'campaignProfileId', context, path);
  return { kind: 'detached', ...shared };
}

function parseIdentity(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterIdentity | undefined {
  const object = readObject(raw, context, path, 'identity');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'name', 'playerName', 'speciesRef', 'careerRef', 'speciesName', 'className',
    'age', 'height', 'hair', 'eyes', 'accent', 'extensions',
  ], context, path);
  const name = readString(object, 'name', context, path);
  const playerName = readOptionalString(object, 'playerName', context, path);
  const speciesRef = parseOptionalDefinitionRef(object, 'speciesRef', context, path);
  const careerRef = parseOptionalDefinitionRef(object, 'careerRef', context, path);
  const speciesName = readOptionalString(object, 'speciesName', context, path);
  const className = readOptionalString(object, 'className', context, path);
  const age = readOptionalFiniteNumber(object, 'age', context, path);
  const height = readOptionalString(object, 'height', context, path);
  const hair = readOptionalString(object, 'hair', context, path);
  const eyes = readOptionalString(object, 'eyes', context, path);
  const accent = readOptionalString(object, 'accent', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (name === undefined) return undefined;
  return {
    name,
    ...(playerName ? { playerName } : {}),
    ...(speciesRef ? { speciesRef } : {}),
    ...(careerRef ? { careerRef } : {}),
    ...(speciesName ? { speciesName } : {}),
    ...(className ? { className } : {}),
    ...(age !== undefined ? { age } : {}),
    ...(height ? { height } : {}),
    ...(hair ? { hair } : {}),
    ...(eyes ? { eyes } : {}),
    ...(accent ? { accent } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseExperienceEntry(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ExperienceEntry | undefined {
  const object = readObject(raw, context, path, 'experience entry');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'dateLabel', 'occurredAt', 'reason', 'delta', 'kind', 'entityKey', 'extensions',
  ], context, path);
  const dateLabel = readOptionalString(object, 'dateLabel', context, path);
  const occurredAt = readOptionalTimestamp(object, 'occurredAt', context, path);
  const reason = readString(object, 'reason', context, path);
  const delta = readFiniteNumber(object, 'delta', context, path);
  const kind = readString(object, 'kind', context, path);
  const entityKey = readOptionalString(object, 'entityKey', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([reason, delta, kind])) return undefined;
  return {
    reason: reason!, delta: delta!, kind: kind!,
    ...(dateLabel ? { dateLabel } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(entityKey ? { entityKey } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseExperienceLedger(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ExperienceLedger | undefined {
  const object = readObject(raw, context, path, 'experience');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['earned', 'spent', 'entries', 'extensions'], context, path);
  const earned = readFiniteNumber(object, 'earned', context, path);
  const spent = readFiniteNumber(object, 'spent', context, path);
  const entries = parseObjectArray(
    readArray(object, 'entries', context, path), context, child(path, 'entries'), parseExperienceEntry,
  );
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([earned, spent, entries])) return undefined;
  return { earned: earned!, spent: spent!, entries: entries!, ...(extensions ? { extensions } : {}) };
}

function parseCareerHistory(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CareerHistorySnapshot | undefined {
  const object = readObject(raw, context, path, 'career history');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'careerRef', 'careerName', 'className', 'level', 'levelName', 'status',
    'startedAt', 'endedAt', 'extensions',
  ], context, path);
  const careerRef = parseOptionalDefinitionRef(object, 'careerRef', context, path);
  const careerName = readString(object, 'careerName', context, path);
  const className = readOptionalString(object, 'className', context, path);
  const level = readInteger(object, 'level', context, path, 1);
  const levelName = readString(object, 'levelName', context, path);
  const status = readString(object, 'status', context, path);
  const startedAt = readOptionalTimestamp(object, 'startedAt', context, path);
  const endedAt = readOptionalTimestamp(object, 'endedAt', context, path);
  validateTimestampOrder(startedAt, endedAt, context, child(path, 'endedAt'));
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([careerName, level, levelName, status])) return undefined;
  return {
    careerName: careerName!, level: level!, levelName: levelName!, status: status!,
    ...(careerRef ? { careerRef } : {}),
    ...(className ? { className } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseAdvance(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterAdvance | undefined {
  const object = readObject(raw, context, path, 'advance');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'kind', 'entityKey', 'amount', 'cost', 'dateLabel', 'occurredAt', 'reason', 'extensions',
  ], context, path);
  const kind = readString(object, 'kind', context, path);
  const entityKey = readOptionalString(object, 'entityKey', context, path);
  const amount = readFiniteNumber(object, 'amount', context, path);
  const cost = readOptionalFiniteNumber(object, 'cost', context, path);
  const dateLabel = readOptionalString(object, 'dateLabel', context, path);
  const occurredAt = readOptionalTimestamp(object, 'occurredAt', context, path);
  const reason = readOptionalString(object, 'reason', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([kind, amount])) return undefined;
  return {
    kind: kind!, amount: amount!,
    ...(entityKey ? { entityKey } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(dateLabel ? { dateLabel } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(reason ? { reason } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseProgression(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterProgression | undefined {
  const object = readObject(raw, context, path, 'progression');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['experience', 'careerHistory', 'advances', 'extensions'], context, path);
  const experience = parseExperienceLedger(object.experience, context, child(path, 'experience'));
  const careerHistory = parseObjectArray(
    readArray(object, 'careerHistory', context, path), context, child(path, 'careerHistory'), parseCareerHistory,
  );
  const advances = parseObjectArray(
    readArray(object, 'advances', context, path), context, child(path, 'advances'), parseAdvance,
  );
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([experience, careerHistory, advances])) return undefined;
  return {
    experience: experience!, careerHistory: careerHistory!, advances: advances!,
    ...(extensions ? { extensions } : {}),
  };
}

function parseCharacteristic(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacteristicStat | undefined {
  const object = readObject(raw, context, path, 'characteristic');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'label', 'short', 'base', 'advances', 'temporary', 'override', 'source', 'extensions',
  ], context, path);
  const label = readString(object, 'label', context, path);
  const short = readString(object, 'short', context, path);
  const base = readFiniteNumber(object, 'base', context, path);
  const advances = readFiniteNumber(object, 'advances', context, path);
  const temporary = readOptionalFiniteNumber(object, 'temporary', context, path);
  const override = readOptionalFiniteNumber(object, 'override', context, path);
  const source = readOptionalString(object, 'source', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([label, short, base, advances])) return undefined;
  return {
    label: label!, short: short!, base: base!, advances: advances!,
    ...(temporary !== undefined ? { temporary } : {}),
    ...(override !== undefined ? { override } : {}),
    ...(source ? { source } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseSkill(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): SkillStat | undefined {
  const object = readObject(raw, context, path, 'skill');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'definitionRef', 'name', 'characteristicKey', 'advances', 'career', 'advanced',
    'grouped', 'specialization', 'source', 'extensions',
  ], context, path);
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const name = readString(object, 'name', context, path);
  const characteristicKey = readString(object, 'characteristicKey', context, path, { id: true });
  const advances = readFiniteNumber(object, 'advances', context, path);
  const career = readBoolean(object, 'career', context, path);
  const advanced = readBoolean(object, 'advanced', context, path);
  const grouped = readOptionalString(object, 'grouped', context, path);
  const specialization = readOptionalString(object, 'specialization', context, path);
  const source = readOptionalString(object, 'source', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([name, characteristicKey, advances, career, advanced])) return undefined;
  return {
    name: name!, characteristicKey: characteristicKey!, advances: advances!,
    career: career!, advanced: advanced!,
    ...(definitionRef ? { definitionRef } : {}),
    ...(grouped !== undefined ? { grouped } : {}),
    ...(specialization ? { specialization } : {}),
    ...(source ? { source } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseStats(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterStats | undefined {
  const object = readObject(raw, context, path, 'stats');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['characteristics', 'skills', 'extensions'], context, path);
  const characteristics = parseKeyedRecord(
    object.characteristics, context, child(path, 'characteristics'), 'characteristics', parseCharacteristic,
  );
  const skills = parseKeyedRecord(
    object.skills, context, child(path, 'skills'), 'skills', parseSkill,
  );
  const extensions = optionalExtensions(object, context, path);
  if (characteristics && skills) {
    for (const key in skills) {
      if (!Object.prototype.hasOwnProperty.call(skills, key)) continue;
      const characteristicKey = skills[key].characteristicKey;
      if (!Object.prototype.hasOwnProperty.call(characteristics, characteristicKey)) {
        context.error(
          'missing_reference',
          child(child(child(path, 'skills'), key), 'characteristicKey'),
          'Skill characteristicKey must reference a decoded characteristic.',
        );
      }
    }
  }
  if (!everyDefined([characteristics, skills])) return undefined;
  const decoded = safeRecord<unknown>();
  decoded.characteristics = characteristics!;
  decoded.skills = skills!;
  if (extensions) decoded.extensions = extensions;
  return decoded as unknown as CharacterStats;
}

function parseResource(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterResourceValue | undefined {
  const object = readObject(raw, context, path, 'resource');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['current', 'maxOverride', 'source', 'extensions'], context, path);
  const current = readFiniteNumber(object, 'current', context, path);
  const maxOverride = readOptionalFiniteNumber(object, 'maxOverride', context, path);
  const source = readOptionalString(object, 'source', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (current === undefined) return undefined;
  return {
    current,
    ...(maxOverride !== undefined ? { maxOverride } : {}),
    ...(source ? { source } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseNamedAbility(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
  extraAllowedKeys: readonly string[] = [],
): NamedAbility | undefined {
  const object = readObject(raw, context, path, 'ability');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['definitionRef', 'name', 'source', 'extensions', ...extraAllowedKeys], context, path,
  );
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const name = readString(object, 'name', context, path);
  const source = readOptionalString(object, 'source', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (name === undefined) return undefined;
  return {
    name,
    ...(definitionRef ? { definitionRef } : {}),
    ...(source ? { source } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseTalent(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): TalentAbility | undefined {
  const base = parseNamedAbility(raw, context, path, ['rank', 'specialization']);
  const object = readObject(raw, context, path, 'talent');
  if (!object) return undefined;
  const rank = readInteger(object, 'rank', context, path, 1);
  const specialization = readOptionalString(object, 'specialization', context, path);
  if (!base || rank === undefined) return undefined;
  return { ...base, rank, ...(specialization ? { specialization } : {}) };
}

function parseAbilities(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterAbilities | undefined {
  const object = readObject(raw, context, path, 'abilities');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['talents', 'spells', 'prayers', 'traits', 'extensions'], context, path);
  const talents = parseObjectArray(
    readArray(object, 'talents', context, path), context, child(path, 'talents'), parseTalent,
  );
  const spells = parseObjectArray(
    readArray(object, 'spells', context, path), context, child(path, 'spells'), parseNamedAbility,
  );
  const prayers = parseObjectArray(
    readArray(object, 'prayers', context, path), context, child(path, 'prayers'), parseNamedAbility,
  );
  const traits = parseObjectArray(
    readArray(object, 'traits', context, path), context, child(path, 'traits'), parseNamedAbility,
  );
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([talents, spells, prayers, traits])) return undefined;
  const decoded = safeRecord<unknown>();
  decoded.talents = talents!;
  decoded.spells = spells!;
  decoded.prayers = prayers!;
  decoded.traits = traits!;
  if (extensions) decoded.extensions = extensions;
  return decoded as unknown as CharacterAbilities;
}

function parseInventoryItem(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): InventoryItem | undefined {
  const object = readObject(raw, context, path, 'inventory item');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['id', 'name', 'definitionRef', 'quantity', 'equipped', 'state', 'extensions'], context, path,
  );
  const id = readString(object, 'id', context, path, { id: true });
  const name = readString(object, 'name', context, path);
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const quantity = readNonnegativeFiniteNumber(object, 'quantity', context, path);
  const equipped = readOptionalBoolean(object, 'equipped', context, path);
  const state = readExtensionRecord(object, 'state', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([id, name, quantity])) return undefined;
  return {
    id: id!, name: name!, quantity: quantity!,
    ...(definitionRef ? { definitionRef } : {}),
    ...(equipped !== undefined ? { equipped } : {}),
    ...(state ? { state } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseCondition(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterCondition | undefined {
  const object = readObject(raw, context, path, 'condition');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['definitionRef', 'name', 'stacks', 'extensions'], context, path);
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const name = readString(object, 'name', context, path);
  const stacks = readInteger(object, 'stacks', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([name, stacks])) return undefined;
  return {
    name: name!, stacks: stacks!,
    ...(definitionRef ? { definitionRef } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseCritical(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterCritical | undefined {
  const object = readObject(raw, context, path, 'critical');
  if (!object) return undefined;
  rejectUnknownKeys(
    object, ['definitionRef', 'name', 'loc', 'roll', 'effect', 'days', 'extensions'], context, path,
  );
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const name = readString(object, 'name', context, path);
  const loc = readStringAllowBlank(object, 'loc', context, path);
  const roll = readInteger(object, 'roll', context, path);
  const effect = readString(object, 'effect', context, path);
  const days = readInteger(object, 'days', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([name, loc, roll, effect, days])) return undefined;
  return {
    name: name!, loc: loc!, roll: roll!, effect: effect!, days: days!,
    ...(definitionRef ? { definitionRef } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseMutation(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterMutation | undefined {
  const object = readObject(raw, context, path, 'mutation');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['definitionRef', 'name', 'extensions'], context, path);
  const definitionRef = parseOptionalDefinitionRef(object, 'definitionRef', context, path);
  const name = readString(object, 'name', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (name === undefined) return undefined;
  return { name, ...(definitionRef ? { definitionRef } : {}), ...(extensions ? { extensions } : {}) };
}

function parseState(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterState | undefined {
  const object = readObject(raw, context, path, 'state');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'conditions', 'criticals', 'mutations', 'psychology', 'equipmentState', 'extensions',
  ], context, path);
  const conditions = parseObjectArray(
    readArray(object, 'conditions', context, path), context, child(path, 'conditions'), parseCondition,
  );
  const criticals = parseObjectArray(
    readArray(object, 'criticals', context, path), context, child(path, 'criticals'), parseCritical,
  );
  const mutations = parseObjectArray(
    readArray(object, 'mutations', context, path), context, child(path, 'mutations'), parseMutation,
  );
  const psychology = readStringArray(object, 'psychology', context, path);
  const equipmentState = readExtensionRecord(object, 'equipmentState', context, path, true);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([conditions, criticals, mutations, psychology, equipmentState])) return undefined;
  return {
    conditions: conditions!, criticals: criticals!, mutations: mutations!,
    psychology: psychology!, equipmentState: equipmentState!,
    ...(extensions ? { extensions } : {}),
  };
}

function parseNarrative(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterNarrative | undefined {
  const object = readObject(raw, context, path, 'narrative');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'ambitionsShort', 'ambitionsLong', 'motivation', 'biography', 'extensions',
  ], context, path);
  const ambitionsShort = readOptionalString(object, 'ambitionsShort', context, path);
  const ambitionsLong = readOptionalString(object, 'ambitionsLong', context, path);
  const motivation = readOptionalString(object, 'motivation', context, path);
  const biography = readOptionalString(object, 'biography', context, path);
  const extensions = optionalExtensions(object, context, path);
  return {
    ...(ambitionsShort ? { ambitionsShort } : {}),
    ...(ambitionsLong ? { ambitionsLong } : {}),
    ...(motivation ? { motivation } : {}),
    ...(biography ? { biography } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseNote(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterNote | undefined {
  const object = readObject(raw, context, path, 'note');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['id', 'body', 'createdAt', 'updatedAt', 'extensions'], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const body = readString(object, 'body', context, path);
  const createdAt = readTimestamp(object, 'createdAt', context, path);
  const updatedAt = readTimestamp(object, 'updatedAt', context, path);
  validateTimestampOrder(createdAt, updatedAt, context, child(path, 'updatedAt'));
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([id, body, createdAt, updatedAt])) return undefined;
  return {
    id: id!, body: body!, createdAt: createdAt!, updatedAt: updatedAt!,
    ...(extensions ? { extensions } : {}),
  };
}

function parseOrigin(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterOrigin | undefined {
  const object = readObject(raw, context, path, 'origin');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'kind', 'sourceId', 'importerId', 'importedAt', 'platform', 'adapterVersion',
    'timestampsInferred', 'sourceHash', 'extensions',
  ], context, path);
  const kind = readEnum(object, 'kind', ORIGIN_KINDS, context, path);
  const sourceId = readOptionalId(object, 'sourceId', context, path);
  const importerId = readOptionalId(object, 'importerId', context, path);
  const importedAt = readOptionalTimestamp(object, 'importedAt', context, path);
  const platform = readOptionalString(object, 'platform', context, path);
  const adapterVersion = readOptionalString(object, 'adapterVersion', context, path);
  const timestampsInferred = readOptionalBoolean(object, 'timestampsInferred', context, path);
  const sourceHash = readOptionalHash(object, 'sourceHash', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (kind === undefined) return undefined;
  return {
    kind,
    ...(sourceId ? { sourceId } : {}),
    ...(importerId ? { importerId } : {}),
    ...(importedAt ? { importedAt } : {}),
    ...(platform ? { platform } : {}),
    ...(adapterVersion ? { adapterVersion } : {}),
    ...(timestampsInferred !== undefined ? { timestampsInferred } : {}),
    ...(sourceHash ? { sourceHash } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseUnresolvedRef(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): UnresolvedRef | undefined {
  const object = readObject(raw, context, path, 'unresolved reference');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    'code', 'path', 'reason', 'legacyKey', 'rawHash', 'ref', 'extensions',
  ], context, path);
  const code = readString(object, 'code', context, path);
  const refPath = readString(object, 'path', context, path);
  const reason = readString(object, 'reason', context, path);
  const legacyKey = readOptionalString(object, 'legacyKey', context, path);
  const rawHash = readOptionalHash(object, 'rawHash', context, path);
  const ref = parseOptionalDefinitionRef(object, 'ref', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([code, refPath, reason])) return undefined;
  return {
    code: code!, path: refPath!, reason: reason!,
    ...(legacyKey ? { legacyKey } : {}),
    ...(rawHash ? { rawHash } : {}),
    ...(ref ? { ref } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseCharacter(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): CharacterDocumentV2 | undefined {
  const object = readObject(raw, context, path, 'character');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    '$schema', 'id', 'revision', 'createdAt', 'updatedAt', 'rulesetRef', 'profileBinding',
    'identity', 'progression', 'stats', 'resources', 'abilities', 'inventory', 'state',
    'narrative', 'notes', 'userContent', 'origin', 'unresolvedRefs', 'legacyExtensions', 'extensions',
  ], context, path);
  const schema = readSchema(object, 'grimcomp.character.v2', context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const revision = readInteger(object, 'revision', context, path, 1);
  const createdAt = readTimestamp(object, 'createdAt', context, path);
  const updatedAt = readTimestamp(object, 'updatedAt', context, path);
  validateTimestampOrder(createdAt, updatedAt, context, child(path, 'updatedAt'));
  const rulesetRef = parseRulesetRefValue(object.rulesetRef, context, child(path, 'rulesetRef'));
  const profileBinding = parseProfileBinding(
    object.profileBinding, context, child(path, 'profileBinding'),
  );
  const identity = parseIdentity(object.identity, context, child(path, 'identity'));
  const progression = parseProgression(object.progression, context, child(path, 'progression'));
  const stats = parseStats(object.stats, context, child(path, 'stats'));
  const resources = parseKeyedRecord(
    object.resources, context, child(path, 'resources'), 'resources', parseResource,
  );
  const abilities = parseAbilities(object.abilities, context, child(path, 'abilities'));
  const inventory = parseObjectArray(
    readArray(object, 'inventory', context, path), context, child(path, 'inventory'), parseInventoryItem,
  );
  const state = parseState(object.state, context, child(path, 'state'));
  const narrative = parseNarrative(object.narrative, context, child(path, 'narrative'));
  const notes = parseObjectArray(
    readArray(object, 'notes', context, path), context, child(path, 'notes'), parseNote,
  );
  const userContent = readExtensionRecord(object, 'userContent', context, path, true);
  const origin = parseOrigin(object.origin, context, child(path, 'origin'));
  const unresolvedRefs = parseObjectArray(
    readArray(object, 'unresolvedRefs', context, path),
    context,
    child(path, 'unresolvedRefs'),
    parseUnresolvedRef,
  );
  const legacyExtensions = readExtensionRecord(object, 'legacyExtensions', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (inventory) {
    validateUniqueBy(inventory, item => item.id, context, child(path, 'inventory'), 'id', 'Inventory IDs');
  }
  if (notes) {
    validateUniqueBy(notes, note => note.id, context, child(path, 'notes'), 'id', 'Note IDs');
  }
  if (!everyDefined([
    schema, id, revision, createdAt, updatedAt, rulesetRef, profileBinding, identity,
    progression, stats, resources, abilities, inventory, state, narrative, notes,
    userContent, origin, unresolvedRefs,
  ])) return undefined;
  return {
    $schema: 'grimcomp.character.v2',
    id: id!, revision: revision!, createdAt: createdAt!, updatedAt: updatedAt!,
    rulesetRef: rulesetRef!, profileBinding: profileBinding!, identity: identity!,
    progression: progression!, stats: stats!, resources: resources!, abilities: abilities!,
    inventory: inventory!, state: state!, narrative: narrative!, notes: notes!,
    userContent: userContent!, origin: origin!, unresolvedRefs: unresolvedRefs!,
    ...(legacyExtensions ? { legacyExtensions } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeCharacterDocumentV2(raw: unknown): DecodeResult<CharacterDocumentV2> {
  const context = new DecodeContext();
  return context.finish(parseCharacter(raw, context, []));
}

function parseProducer(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ExchangeProducer | undefined {
  const object = readObject(raw, context, path, 'producer');
  if (!object) return undefined;
  rejectUnknownKeys(object, ['id', 'version', 'extensions'], context, path);
  const id = readString(object, 'id', context, path, { id: true });
  const version = readString(object, 'version', context, path);
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([id, version])) return undefined;
  return { id: id!, version: version!, ...(extensions ? { extensions } : {}) };
}

function rulesetsEqual(left: RulesetRef, right: RulesetRef): boolean {
  return left.id === right.id
    && left.edition === right.edition
    && left.rulesVersion === right.rulesVersion
    && left.engineApiVersion === right.engineApiVersion;
}

function indexUnique<T extends { id: string }>(
  entries: readonly T[],
  collection: string,
  diagnostics: Diagnostic[],
): Map<string, T> {
  const indexed = new Map<string, T>();
  entries.forEach((entry, index) => {
    if (indexed.has(entry.id)) {
      diagnostics.push(makeDiagnostic(
        'duplicate_id',
        [collection, index, 'id'],
        collection + ' IDs must be unique; duplicate ' + quoteDiagnosticValue(entry.id) + '.',
      ));
    } else {
      indexed.set(entry.id, entry);
    }
  });
  return indexed;
}

function indexContentMetadata(
  entries: readonly ContentPackMetadataV1[],
  diagnostics: Diagnostic[],
): Map<string, Map<string, ContentPackMetadataV1>> {
  const byId = new Map<string, Map<string, ContentPackMetadataV1>>();
  entries.forEach((entry, index) => {
    let versions = byId.get(entry.id);
    if (!versions) {
      versions = new Map<string, ContentPackMetadataV1>();
      byId.set(entry.id, versions);
    }
    if (versions.has(entry.version)) {
      diagnostics.push(makeDiagnostic(
        'duplicate_id',
        ['contentPackMetadata', index, 'version'],
        'Content metadata identities must be unique; duplicate ID '
          + quoteDiagnosticValue(entry.id) + ' at version '
          + quoteDiagnosticValue(entry.version) + '.',
      ));
    } else versions.set(entry.version, entry);
  });
  return byId;
}

function packLocksMatch(
  actual: readonly PackLockEntry[],
  expected: readonly PackLockEntry[],
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): void {
  if (actual.length !== expected.length) {
    diagnostics.push(makeDiagnostic(
      'snapshot_mismatch',
      path,
      'Character binding packLock must have the same ordered entries as its campaign.',
    ));
    return;
  }
  actual.forEach((entry, index) => {
    const expectedEntry = expected[index];
    for (const field of ['id', 'version', 'hash'] as const) {
      if (entry[field] !== expectedEntry[field]) {
        diagnostics.push(makeDiagnostic(
          'snapshot_mismatch',
          [...path, index, field],
          'Character binding packLock must match its campaign snapshot exactly.',
        ));
      }
    }
  });
}

function selectionIsActive(selection: SourcePackSelection): boolean {
  return selection.enabled || selection.required === true;
}

function missingPackSeverity(
  source: SourceProfileV1,
  selection: SourcePackSelection,
): 'error' | 'warning' {
  return selection.required === true || source.policy.missingPack === 'block' ? 'error' : 'warning';
}

function versionMatchesRange(version: string, range: string): boolean {
  const evaluated = evaluateVersionRange(version, range);
  return evaluated.ok && evaluated.matches;
}

function metadataPassesSourcePolicy(
  metadata: ContentPackMetadataV1,
  source: SourceProfileV1,
): boolean {
  const homebrew = metadata.origin === 'user-authored' || metadata.rights.basis === 'user-authored';
  return source.policy.allowedRightsStatuses.includes(metadata.rights.reviewStatus)
    && (source.policy.allowHomebrew || !homebrew);
}

function reportMetadataPolicyViolation(
  metadata: ContentPackMetadataV1,
  source: SourceProfileV1,
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): void {
  if (!source.policy.allowedRightsStatuses.includes(metadata.rights.reviewStatus)) {
    diagnostics.push(makeDiagnostic(
      'rights_policy_violation',
      path,
      'Resolved pack reviewStatus "' + metadata.rights.reviewStatus
        + '" is not allowed by the source profile.',
    ));
  }
  const homebrew = metadata.origin === 'user-authored' || metadata.rights.basis === 'user-authored';
  if (!source.policy.allowHomebrew && homebrew) {
    diagnostics.push(makeDiagnostic(
      'rights_policy_violation',
      path,
      'Resolved user-authored content is blocked by the source profile.',
    ));
  }
}

function validateResolvedPackRelations(
  resolvedPacks: readonly ContentPackMetadataV1[],
  metadataIndices: ReadonlyMap<ContentPackMetadataV1, number>,
  diagnostics: Diagnostic[],
  resolutionCandidates?: ReadonlyMap<string, readonly ContentPackMetadataV1[]>,
): void {
  const resolvedById = new Map(resolvedPacks.map(pack => [pack.id, pack]));
  const candidatesFor = (id: string): readonly ContentPackMetadataV1[] => {
    const candidates = resolutionCandidates?.get(id);
    if (candidates) return candidates;
    const exact = resolvedById.get(id);
    return exact ? [exact] : [];
  };
  const dependencyConstraints = new Map<string, Array<{
    individuallySatisfied: boolean;
    path: readonly (string | number)[];
    versionRange: string;
  }>>();
  const conflictConstraints = new Map<string, Array<{
    path: readonly (string | number)[];
    versionRange?: string;
  }>>();

  resolvedPacks.forEach(pack => {
    const metadataIndex = metadataIndices.get(pack);
    if (metadataIndex === undefined) return;

    pack.dependencies.forEach((dependency, dependencyIndex) => {
      const targets = candidatesFor(dependency.id);
      const path = ['contentPackMetadata', metadataIndex, 'dependencies', dependencyIndex] as const;
      if (targets.length === 0) {
        if (dependency.optional !== true) {
          diagnostics.push(makeDiagnostic(
            'missing_reference',
            [...path, 'id'],
            'Required dependency is not present in the resolved pack set.',
          ));
        }
        return;
      }
      const individuallySatisfied = targets.some(target => (
        versionMatchesRange(target.version, dependency.versionRange)
      ));
      if (!individuallySatisfied) {
        diagnostics.push(makeDiagnostic(
          'version_mismatch',
          [...path, 'versionRange'],
          'Resolved dependency version does not satisfy versionRange.',
        ));
      }
      const constraints = dependencyConstraints.get(dependency.id) ?? [];
      constraints.push({ individuallySatisfied, path, versionRange: dependency.versionRange });
      dependencyConstraints.set(dependency.id, constraints);
    });
    pack.conflicts.forEach((conflict, conflictIndex) => {
      const constraints = conflictConstraints.get(conflict.id) ?? [];
      constraints.push({
        path: ['contentPackMetadata', metadataIndex, 'conflicts', conflictIndex, 'id'],
        ...(conflict.versionRange ? { versionRange: conflict.versionRange } : {}),
      });
      conflictConstraints.set(conflict.id, constraints);
    });
  });

  const viableCandidates = new Map<string, readonly ContentPackMetadataV1[]>();
  dependencyConstraints.forEach((constraints, id) => {
    const viable = candidatesFor(id).filter(candidate => constraints.every(constraint => (
      versionMatchesRange(candidate.version, constraint.versionRange)
    )));
    viableCandidates.set(id, viable);
    if (viable.length === 0 && constraints.every(constraint => constraint.individuallySatisfied)) {
      diagnostics.push(makeDiagnostic(
        'version_mismatch',
        [...constraints[0].path, 'versionRange'],
        'No single resolved dependency version satisfies every declared range.',
      ));
    }
  });

  conflictConstraints.forEach((constraints, id) => {
    const targets = viableCandidates.get(id) ?? candidatesFor(id);
    if (targets.length === 0) return;
    const hasSafeCandidate = targets.some(target => constraints.every(constraint => (
      constraint.versionRange
        ? !versionMatchesRange(target.version, constraint.versionRange)
        : false
    )));
    if (!hasSafeCandidate) {
      diagnostics.push(makeDiagnostic(
        'pack_conflict',
        constraints[0].path,
        'No viable pack version avoids the declared conflicts.',
      ));
    }
  });
}

const MAX_AMBIGUOUS_RESOLUTION_PACKS = 128;
const MAX_RESOLUTION_CANDIDATE_ATTEMPTS = 20_000;
const MAX_RESOLUTION_WORK_UNITS = 50_000;

type ResolutionFeasibility =
  | { ok: true }
  | { ok: false; limited: boolean };

function evaluateSourceResolutionFeasibility(
  domains: ReadonlyMap<string, readonly ContentPackMetadataV1[]>,
): ResolutionFeasibility {
  let consumedWork = 0;
  let workLimitExceeded = false;
  const consumeWork = (units = 1): boolean => {
    if (workLimitExceeded) return false;
    if (consumedWork + units > MAX_RESOLUTION_WORK_UNITS) {
      workLimitExceeded = true;
      return false;
    }
    consumedWork += units;
    return true;
  };

  const relatedIds = new Map<string, Set<string>>();
  const constrainedIds = new Set<string>();
  const addRelation = (left: string, right: string): void => {
    constrainedIds.add(left);
    if (!domains.has(right)) return;
    constrainedIds.add(right);
    const leftRelations = relatedIds.get(left) ?? new Set<string>();
    const rightRelations = relatedIds.get(right) ?? new Set<string>();
    leftRelations.add(right);
    rightRelations.add(left);
    relatedIds.set(left, leftRelations);
    relatedIds.set(right, rightRelations);
  };

  type CandidateRelations = {
    dependencies: Map<string, PackDependency[]>;
    conflicts: Map<string, PackConflict[]>;
  };
  const candidateRelations = new WeakMap<ContentPackMetadataV1, CandidateRelations>();
  const addIndexedRelation = <T extends PackDependency | PackConflict>(
    index: Map<string, T[]>,
    relation: T,
  ): void => {
    const matches = index.get(relation.id) ?? [];
    matches.push(relation);
    index.set(relation.id, matches);
  };
  for (const [id, candidates] of domains) {
    for (const candidate of candidates) {
      const relations: CandidateRelations = {
        dependencies: new Map<string, PackDependency[]>(),
        conflicts: new Map<string, PackConflict[]>(),
      };
      candidateRelations.set(candidate, relations);
      for (const dependency of candidate.dependencies) {
        if (!consumeWork()) return { ok: false, limited: true };
        addRelation(id, dependency.id);
        addIndexedRelation(relations.dependencies, dependency);
      }
      for (const conflict of candidate.conflicts) {
        if (!consumeWork()) return { ok: false, limited: true };
        addRelation(id, conflict.id);
        addIndexedRelation(relations.conflicts, conflict);
      }
    }
  }

  const rangeMatchCache = new Map<string, Map<string, boolean>>();
  const rangeMatchesWithBudget = (version: string, range: string): boolean => {
    const byVersion = rangeMatchCache.get(range);
    const cached = byVersion?.get(version);
    if (cached !== undefined) return cached;
    // Charge uncached parsing proportionally to bounded input size. The range
    // evaluator has its own syntax/atom limits, while this prevents long valid
    // ranges from being treated as constant-cost solver work.
    const parseUnits = 1 + Math.ceil((version.length + range.length) / 64);
    if (!consumeWork(parseUnits)) return false;
    const matches = versionMatchesRange(version, range);
    const cache = byVersion ?? new Map<string, boolean>();
    cache.set(version, matches);
    rangeMatchCache.set(range, cache);
    return matches;
  };

  const localPossibilityCache = new WeakMap<ContentPackMetadataV1, boolean>();
  const candidateIsLocallyPossible = (candidate: ContentPackMetadataV1): boolean => {
    const cached = localPossibilityCache.get(candidate);
    if (cached !== undefined) return cached;
    for (const dependency of candidate.dependencies) {
      if (!consumeWork()) return false;
      if (dependency.id === candidate.id) {
        if (!rangeMatchesWithBudget(candidate.version, dependency.versionRange)) {
          if (workLimitExceeded) return false;
          localPossibilityCache.set(candidate, false);
          return false;
        }
      } else if (!domains.has(dependency.id) && dependency.optional !== true) {
        localPossibilityCache.set(candidate, false);
        return false;
      }
    }
    for (const conflict of candidate.conflicts) {
      if (!consumeWork()) return false;
      if (conflict.id !== candidate.id) continue;
      const conflictsWithSelf = !conflict.versionRange
        || rangeMatchesWithBudget(candidate.version, conflict.versionRange);
      if (workLimitExceeded) return false;
      if (conflictsWithSelf) {
        localPossibilityCache.set(candidate, false);
        return false;
      }
    }
    localPossibilityCache.set(candidate, true);
    return true;
  };

  const directedRelationsAllow = (
    source: ContentPackMetadataV1,
    target: ContentPackMetadataV1,
  ): boolean => {
    const relations = candidateRelations.get(source);
    if (!relations) return false;
    for (const dependency of relations.dependencies.get(target.id) ?? []) {
      if (!consumeWork()) return false;
      if (!rangeMatchesWithBudget(target.version, dependency.versionRange)) {
        if (workLimitExceeded) return false;
        return false;
      }
    }
    for (const conflict of relations.conflicts.get(target.id) ?? []) {
      if (!consumeWork()) return false;
      if (
        !conflict.versionRange
        || rangeMatchesWithBudget(target.version, conflict.versionRange)
      ) {
        return false;
      }
      if (workLimitExceeded) return false;
    }
    return true;
  };

  const pairCompatibilityCache = new WeakMap<
    ContentPackMetadataV1,
    WeakMap<ContentPackMetadataV1, boolean>
  >();
  const pairIsCompatible = (
    left: ContentPackMetadataV1,
    right: ContentPackMetadataV1,
  ): boolean => {
    const cached = pairCompatibilityCache.get(left)?.get(right);
    if (cached !== undefined) return cached;
    const compatible = directedRelationsAllow(left, right) && directedRelationsAllow(right, left);
    if (workLimitExceeded) return false;
    const leftCache = pairCompatibilityCache.get(left) ?? new WeakMap<ContentPackMetadataV1, boolean>();
    const rightCache = pairCompatibilityCache.get(right) ?? new WeakMap<ContentPackMetadataV1, boolean>();
    leftCache.set(right, compatible);
    rightCache.set(left, compatible);
    pairCompatibilityCache.set(left, leftCache);
    pairCompatibilityCache.set(right, rightCache);
    return compatible;
  };

  const assignment = new Map<string, ContentPackMetadataV1>();
  const ambiguous: Array<readonly [string, readonly ContentPackMetadataV1[]]> = [];
  domains.forEach((candidates, id) => {
    if (candidates.length === 1 || !constrainedIds.has(id)) {
      assignment.set(id, candidates[0]);
    } else {
      ambiguous.push([id, candidates]);
    }
  });
  ambiguous.sort((left, right) => (
    left[1].length - right[1].length
    || (relatedIds.get(right[0])?.size ?? 0) - (relatedIds.get(left[0])?.size ?? 0)
  ));
  if (ambiguous.length > MAX_AMBIGUOUS_RESOLUTION_PACKS) {
    return { ok: false, limited: true };
  }

  const candidateFitsAssignment = (id: string, candidate: ContentPackMetadataV1): boolean => {
    if (!candidateIsLocallyPossible(candidate)) return false;
    for (const relatedId of relatedIds.get(id) ?? []) {
      if (!consumeWork()) return false;
      if (relatedId === id) continue;
      const related = assignment.get(relatedId);
      if (related && !pairIsCompatible(candidate, related)) return false;
    }
    return true;
  };
  for (const [id, candidate] of assignment) {
    if (!candidateFitsAssignment(id, candidate)) {
      return { ok: false, limited: workLimitExceeded };
    }
  }

  let candidateAttempts = 0;
  let candidateAttemptLimitExceeded = false;
  const search = (index: number): boolean => {
    if (index === ambiguous.length) return true;
    const [id, candidates] = ambiguous[index];
    for (const candidate of candidates) {
      candidateAttempts += 1;
      if (candidateAttempts > MAX_RESOLUTION_CANDIDATE_ATTEMPTS) {
        candidateAttemptLimitExceeded = true;
        return false;
      }
      if (!consumeWork()) {
        return false;
      }
      if (!candidateFitsAssignment(id, candidate)) {
        if (workLimitExceeded) return false;
        continue;
      }
      assignment.set(id, candidate);
      if (search(index + 1)) return true;
      assignment.delete(id);
      if (candidateAttemptLimitExceeded || workLimitExceeded) return false;
    }
    return false;
  };

  return search(0)
    ? { ok: true }
    : { ok: false, limited: candidateAttemptLimitExceeded || workLimitExceeded };
}

function validateExpectedLockOrder(
  actual: readonly PackLockEntry[],
  expected: readonly SourcePackSelection[],
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
  label: string,
): void {
  const expectedIds = expected.map(selection => selection.id);
  const actualIds = actual.map(entry => entry.id);
  if (
    actualIds.length !== expectedIds.length
    || actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    diagnostics.push(makeDiagnostic(
      'snapshot_mismatch',
      path,
      label + ' must follow source pack order and contain exactly the active selections.',
    ));
  }
}

function validateDefinitionRefPack(
  ref: DefinitionRef | undefined,
  allowedPackIds: ReadonlySet<string>,
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): void {
  if (ref === undefined) return;
  if (ref.packId !== undefined && allowedPackIds.has(ref.packId)) return;
  diagnostics.push(makeDiagnostic(
    'missing_reference',
    [...path, 'packId'],
    ref.packId === undefined
      ? 'Resolved character definitions must identify their source pack when profile-bound.'
      : 'Resolved character definition pack must be present in the bound profile snapshot.',
  ));
}

function validateCharacterDefinitionRefPacks(
  character: CharacterDocumentV2,
  characterIndex: number,
  allowedPackIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  const root = ['characters', characterIndex] as const;
  validateDefinitionRefPack(
    character.identity.speciesRef,
    allowedPackIds,
    [...root, 'identity', 'speciesRef'],
    diagnostics,
  );
  validateDefinitionRefPack(
    character.identity.careerRef,
    allowedPackIds,
    [...root, 'identity', 'careerRef'],
    diagnostics,
  );
  character.progression.careerHistory.forEach((entry, entryIndex) => {
    validateDefinitionRefPack(
      entry.careerRef,
      allowedPackIds,
      [...root, 'progression', 'careerHistory', entryIndex, 'careerRef'],
      diagnostics,
    );
  });
  for (const key in character.stats.skills) {
    if (!Object.prototype.hasOwnProperty.call(character.stats.skills, key)) continue;
    validateDefinitionRefPack(
      character.stats.skills[key].definitionRef,
      allowedPackIds,
      [...root, 'stats', 'skills', key, 'definitionRef'],
      diagnostics,
    );
  }
  (['talents', 'spells', 'prayers', 'traits'] as const).forEach(collection => {
    character.abilities[collection].forEach((ability, abilityIndex) => {
      validateDefinitionRefPack(
        ability.definitionRef,
        allowedPackIds,
        [...root, 'abilities', collection, abilityIndex, 'definitionRef'],
        diagnostics,
      );
    });
  });
  character.inventory.forEach((item, itemIndex) => {
    validateDefinitionRefPack(
      item.definitionRef,
      allowedPackIds,
      [...root, 'inventory', itemIndex, 'definitionRef'],
      diagnostics,
    );
  });
  (['conditions', 'criticals', 'mutations'] as const).forEach(collection => {
    character.state[collection].forEach((entry, entryIndex) => {
      validateDefinitionRefPack(
        entry.definitionRef,
        allowedPackIds,
        [...root, 'state', collection, entryIndex, 'definitionRef'],
        diagnostics,
      );
    });
  });
}

export function validateExchangeEnvelopeSemantics(envelope: ExchangeEnvelopeV1): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sources = indexUnique(envelope.sourceProfiles, 'sourceProfiles', diagnostics);
  const campaigns = indexUnique(envelope.campaignProfiles, 'campaignProfiles', diagnostics);
  indexUnique(envelope.characters, 'characters', diagnostics);
  const metadata = indexContentMetadata(envelope.contentPackMetadata, diagnostics);
  const metadataIndices = new Map(
    envelope.contentPackMetadata.map((entry, index) => [entry, index] as const),
  );
  const validatedPackRelations = new Set<string>();
  const validatePackRelationsOnce = (
    resolvedPacks: readonly ContentPackMetadataV1[],
    resolutionCandidates?: ReadonlyMap<string, readonly ContentPackMetadataV1[]>,
  ): void => {
    const resolvedKey = resolvedPacks
      .map(pack => metadataIndices.get(pack))
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right)
      .join(',');
    const candidatesKey = resolutionCandidates
      ? [...resolutionCandidates.values()]
        .flatMap(entries => entries.map(entry => metadataIndices.get(entry)))
        .filter((index): index is number => index !== undefined)
        .sort((left, right) => left - right)
        .join(',')
      : resolvedKey;
    const resolutionKey = `${resolvedKey}|${candidatesKey}`;
    if (validatedPackRelations.has(resolutionKey)) return;
    validatedPackRelations.add(resolutionKey);
    validateResolvedPackRelations(
      resolvedPacks,
      metadataIndices,
      diagnostics,
      resolutionCandidates,
    );
  };

  envelope.sourceProfiles.forEach((source, sourceIndex) => {
    source.packs.forEach((selection, packIndex) => {
      if (!selectionIsActive(selection)) return;
      const versions = metadata.get(selection.id);
      const path = ['sourceProfiles', sourceIndex, 'packs', packIndex] as const;
      const severity = missingPackSeverity(source, selection);
      if (!versions) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          [...path, 'id'],
          'Selected source pack metadata is not present in the self-contained envelope.',
          severity,
        ));
        return;
      }
      if (selection.pinnedVersion) {
        const exact = versions.get(selection.pinnedVersion);
        if (!exact) {
          diagnostics.push(makeDiagnostic(
            'missing_reference',
            [...path, 'pinnedVersion'],
            'Pinned source pack metadata version is not present in the envelope.',
            severity,
          ));
        } else if (!rulesetsEqual(source.rulesetRef, exact.rulesetRef)) {
          diagnostics.push(makeDiagnostic(
            'ruleset_mismatch',
            [...path, 'id'],
            'Selected source pack metadata must match the source profile ruleset.',
            severity,
          ));
        } else {
          reportMetadataPolicyViolation(exact, source, [...path, 'id'], diagnostics);
        }
      } else {
        const rangeMatches = [...versions.values()].filter(entry => (
          versionMatchesRange(entry.version, selection.versionRange)
        ));
        if (rangeMatches.length === 0) {
          diagnostics.push(makeDiagnostic(
            'version_mismatch',
            [...path, 'versionRange'],
            'No included metadata version satisfies versionRange.',
            severity,
          ));
          return;
        }
        const rulesetMatches = rangeMatches.filter(entry => rulesetsEqual(source.rulesetRef, entry.rulesetRef));
        if (rulesetMatches.length === 0) {
          diagnostics.push(makeDiagnostic(
            'ruleset_mismatch',
            [...path, 'id'],
            'No compatible metadata version matches the source profile ruleset.',
            severity,
          ));
          return;
        }
        if (!rulesetMatches.some(entry => metadataPassesSourcePolicy(entry, source))) {
          reportMetadataPolicyViolation(rulesetMatches[0], source, [...path, 'id'], diagnostics);
        }
      }
    });

    // A fully pinned source profile already represents a concrete resolution,
    // even when no campaign or character lock is included in the envelope.
    const activeSelections = source.packs.filter(selectionIsActive);
    const sourceCandidates = new Map<string, ContentPackMetadataV1[]>();
    activeSelections.forEach(selection => {
      const versions = metadata.get(selection.id);
      if (!versions) return;
      const candidates = [...versions.values()].filter(entry => (
        (!selection.pinnedVersion || entry.version === selection.pinnedVersion)
        && versionMatchesRange(entry.version, selection.versionRange)
        && rulesetsEqual(source.rulesetRef, entry.rulesetRef)
        && metadataPassesSourcePolicy(entry, source)
      ));
      if (candidates.length > 0) sourceCandidates.set(selection.id, candidates);
    });
    const pinnedResolution = activeSelections.flatMap(selection => (
      selection.pinnedVersion ? (sourceCandidates.get(selection.id) ?? []) : []
    ));
    if (pinnedResolution.length > 0) {
      validatePackRelationsOnce(pinnedResolution, sourceCandidates);
    }
    const feasibility = evaluateSourceResolutionFeasibility(sourceCandidates);
    if (!feasibility.ok) {
      diagnostics.push(makeDiagnostic(
        feasibility.limited ? 'resolution_limit' : 'resolution_impossible',
        ['sourceProfiles', sourceIndex, 'packs'],
        feasibility.limited
          ? 'Source resolution exceeds the bounded ambiguity, candidate-attempt, or constraint-work limit.'
          : 'No compatible source-pack resolution satisfies all dependencies and conflicts.',
      ));
    }
  });

  envelope.campaignProfiles.forEach((campaign, index) => {
    const source = sources.get(campaign.sourceProfileId);
    if (!source) {
      diagnostics.push(makeDiagnostic(
        'missing_reference',
        ['campaignProfiles', index, 'sourceProfileId'],
        'Campaign source profile ' + quoteDiagnosticValue(campaign.sourceProfileId)
          + ' is not present in the envelope.',
      ));
    } else if (!rulesetsEqual(campaign.rulesetRef, source.rulesetRef)) {
      diagnostics.push(makeDiagnostic(
        'ruleset_mismatch',
        ['campaignProfiles', index, 'rulesetRef'],
        'Campaign and source profile rulesets must match exactly.',
      ));
    }
    if (!source) return;

    const sourcePacks = new Map(source.packs.map(pack => [pack.id, pack]));
    const lockEntries = new Map(campaign.packLock.map(entry => [entry.id, entry]));
    const houseRuleIds = new Set(campaign.houseRulePackIds);
    campaign.houseRulePackIds.forEach((id, houseRuleIndex) => {
      if (!sourcePacks.has(id)) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          ['campaignProfiles', index, 'houseRulePackIds', houseRuleIndex],
          'House-rule pack must reference a source profile selection.',
        ));
      }
    });
    const expectedSelections = source.packs
      .filter(pack => selectionIsActive(pack) || houseRuleIds.has(pack.id))
      .sort((left, right) => left.order - right.order);
    validateExpectedLockOrder(
      campaign.packLock,
      expectedSelections,
      ['campaignProfiles', index, 'packLock'],
      diagnostics,
      'Campaign packLock',
    );
    expectedSelections.forEach(selection => {
      if (!lockEntries.has(selection.id)) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          ['campaignProfiles', index, 'packLock'],
          'Every enabled source selection must be represented in the campaign lock.',
        ));
      }
    });

    campaign.packLock.forEach((lock, lockIndex) => {
      const selection = sourcePacks.get(lock.id);
      const lockPath = ['campaignProfiles', index, 'packLock', lockIndex] as const;
      if (!selection) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          [...lockPath, 'id'],
          'Campaign lock entry must resolve to a source profile selection.',
        ));
      } else {
        if (!versionMatchesRange(lock.version, selection.versionRange)) {
          diagnostics.push(makeDiagnostic(
            'version_mismatch',
            [...lockPath, 'version'],
            'Campaign lock version must satisfy the source versionRange.',
          ));
        }
        if (selection.pinnedVersion && selection.pinnedVersion !== lock.version) {
          diagnostics.push(makeDiagnostic(
            'snapshot_mismatch',
            [...lockPath, 'version'],
            'Campaign lock version must match the source pinnedVersion.',
          ));
        }
        if (selection.pinnedHash && selection.pinnedHash !== lock.hash) {
          diagnostics.push(makeDiagnostic(
            'snapshot_mismatch',
            [...lockPath, 'hash'],
            'Campaign lock hash must match the source pinnedHash.',
          ));
        }
      }

      const exactMetadata = metadata.get(lock.id)?.get(lock.version);
      if (!exactMetadata) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          [...lockPath, 'version'],
          'Campaign lock metadata identity is not present in the envelope.',
        ));
      } else if (!rulesetsEqual(campaign.rulesetRef, exactMetadata.rulesetRef)) {
        diagnostics.push(makeDiagnostic(
          'ruleset_mismatch',
          [...lockPath, 'id'],
          'Campaign lock metadata must match the campaign ruleset.',
        ));
      } else {
        reportMetadataPolicyViolation(exactMetadata, source, [...lockPath, 'id'], diagnostics);
      }
    });

    const resolvedCampaignPacks = campaign.packLock
      .map(lock => metadata.get(lock.id)?.get(lock.version))
      .filter((entry): entry is ContentPackMetadataV1 => entry !== undefined);
    if (resolvedCampaignPacks.length === campaign.packLock.length) {
      validatePackRelationsOnce(resolvedCampaignPacks);
    }

    campaign.houseRulePackIds.forEach((id, houseRuleIndex) => {
      if (sourcePacks.has(id) && !lockEntries.has(id)) {
        diagnostics.push(makeDiagnostic(
          'missing_reference',
          ['campaignProfiles', index, 'houseRulePackIds', houseRuleIndex],
          'House-rule pack must be present in the campaign lock.',
        ));
      }
    });
  });

  envelope.characters.forEach((character, index) => {
    const binding = character.profileBinding;
    if (binding.kind === 'detached') return;
    const profile = binding.kind === 'source'
      ? sources.get(binding.sourceProfileId)
      : campaigns.get(binding.campaignProfileId);
    const key = binding.kind === 'source' ? 'sourceProfileId' : 'campaignProfileId';
    if (!profile) {
      diagnostics.push(makeDiagnostic(
        'missing_reference',
        ['characters', index, 'profileBinding', key],
        'Bound profile is not present in the envelope.',
      ));
    } else if (!rulesetsEqual(character.rulesetRef, profile.rulesetRef)) {
      diagnostics.push(makeDiagnostic(
        'ruleset_mismatch',
        ['characters', index, 'rulesetRef'],
        'Character and bound profile rulesets must match exactly.',
      ));
    }
    const boundCampaign = binding.kind === 'campaign'
      ? campaigns.get(binding.campaignProfileId)
      : undefined;
    if (binding.kind === 'campaign' && boundCampaign) {
      validateCharacterDefinitionRefPacks(
        character,
        index,
        new Set(boundCampaign.packLock.map(entry => entry.id)),
        diagnostics,
      );
      if (binding.resolutionHash !== boundCampaign.pinnedResolutionHash) {
        diagnostics.push(makeDiagnostic(
          'snapshot_mismatch',
          ['characters', index, 'profileBinding', 'resolutionHash'],
          'Campaign-bound character resolutionHash must match the campaign snapshot.',
        ));
      }
      if (binding.packLock) {
        packLocksMatch(
          binding.packLock,
          boundCampaign.packLock,
          ['characters', index, 'profileBinding', 'packLock'],
          diagnostics,
        );
      }
    }
    const boundSource = binding.kind === 'source'
      ? sources.get(binding.sourceProfileId)
      : undefined;
    if (binding.kind === 'source' && boundSource) {
      validateCharacterDefinitionRefPacks(
        character,
        index,
        new Set(boundSource.packs.filter(selectionIsActive).map(selection => selection.id)),
        diagnostics,
      );
    }
    if (binding.kind === 'source' && boundSource && binding.packLock) {
      const expectedSelections = boundSource.packs
        .filter(selectionIsActive)
        .sort((left, right) => left.order - right.order);
      validateExpectedLockOrder(
        binding.packLock,
        expectedSelections,
        ['characters', index, 'profileBinding', 'packLock'],
        diagnostics,
        'Source-bound character packLock',
      );
      const sourcePacks = new Map(boundSource.packs.map(pack => [pack.id, pack]));
      binding.packLock.forEach((lock, lockIndex) => {
        const lockPath = ['characters', index, 'profileBinding', 'packLock', lockIndex] as const;
        const selection = sourcePacks.get(lock.id);
        if (!selection) {
          diagnostics.push(makeDiagnostic(
            'missing_reference',
            [...lockPath, 'id'],
            'Source-bound character lock entry must resolve to a source selection.',
          ));
          return;
        }
        if (!versionMatchesRange(lock.version, selection.versionRange)) {
          diagnostics.push(makeDiagnostic(
            'version_mismatch',
            [...lockPath, 'version'],
            'Source-bound character lock version must satisfy versionRange.',
          ));
        }
        if (selection.pinnedVersion && selection.pinnedVersion !== lock.version) {
          diagnostics.push(makeDiagnostic(
            'snapshot_mismatch',
            [...lockPath, 'version'],
            'Source-bound character lock version must match pinnedVersion.',
          ));
        }
        if (selection.pinnedHash && selection.pinnedHash !== lock.hash) {
          diagnostics.push(makeDiagnostic(
            'snapshot_mismatch',
            [...lockPath, 'hash'],
            'Source-bound character lock hash must match pinnedHash.',
          ));
        }
        const exactMetadata = metadata.get(lock.id)?.get(lock.version);
        if (!exactMetadata) {
          diagnostics.push(makeDiagnostic(
            'missing_reference',
            [...lockPath, 'version'],
            'Source-bound character lock metadata is not present in the envelope.',
          ));
        } else if (!rulesetsEqual(boundSource.rulesetRef, exactMetadata.rulesetRef)) {
          diagnostics.push(makeDiagnostic(
            'ruleset_mismatch',
            [...lockPath, 'id'],
            'Source-bound character lock metadata must match the source ruleset.',
          ));
        } else {
          reportMetadataPolicyViolation(exactMetadata, boundSource, [...lockPath, 'id'], diagnostics);
        }
      });
      const resolvedCharacterPacks = binding.packLock
        .map(lock => metadata.get(lock.id)?.get(lock.version))
        .filter((entry): entry is ContentPackMetadataV1 => entry !== undefined);
      if (resolvedCharacterPacks.length === binding.packLock.length) {
        validatePackRelationsOnce(resolvedCharacterPacks);
      }
    }
  });
  return diagnostics;
}

function parseExchangeEnvelope(
  raw: unknown,
  context: DecodeContext,
  path: DecodePath,
): ExchangeEnvelopeV1 | undefined {
  const object = readObject(raw, context, path, 'exchange envelope');
  if (!object) return undefined;
  rejectUnknownKeys(object, [
    '$schema', 'producer', 'producedAt', 'characters', 'sourceProfiles',
    'campaignProfiles', 'contentPackMetadata', 'extensions',
  ], context, path);
  const schema = readSchema(object, 'grimcomp.exchange.v1', context, path);
  const producer = parseProducer(object.producer, context, child(path, 'producer'));
  const producedAt = readTimestamp(object, 'producedAt', context, path);
  const characters = parseObjectArray(
    readArray(object, 'characters', context, path), context, child(path, 'characters'), parseCharacter,
  );
  const sourceProfiles = parseObjectArray(
    readArray(object, 'sourceProfiles', context, path),
    context,
    child(path, 'sourceProfiles'),
    parseSourceProfile,
  );
  const campaignProfiles = parseObjectArray(
    readArray(object, 'campaignProfiles', context, path),
    context,
    child(path, 'campaignProfiles'),
    parseCampaignProfile,
  );
  const contentPackMetadata = parseObjectArray(
    readArray(object, 'contentPackMetadata', context, path),
    context,
    child(path, 'contentPackMetadata'),
    parseContentPackMetadata,
  );
  const extensions = optionalExtensions(object, context, path);
  if (!everyDefined([
    schema, producer, producedAt, characters, sourceProfiles, campaignProfiles, contentPackMetadata,
  ])) return undefined;
  return {
    $schema: 'grimcomp.exchange.v1',
    producer: producer!, producedAt: producedAt!, characters: characters!,
    sourceProfiles: sourceProfiles!, campaignProfiles: campaignProfiles!,
    contentPackMetadata: contentPackMetadata!,
    ...(extensions ? { extensions } : {}),
  };
}

export function decodeExchangeEnvelopeV1(raw: unknown): DecodeResult<ExchangeEnvelopeV1> {
  const context = new DecodeContext();
  const envelope = parseExchangeEnvelope(raw, context, []);
  const structural = context.finish(envelope);
  if (!structural.ok) return structural;
  const semanticDiagnostics = validateExchangeEnvelopeSemantics(structural.value);
  const diagnostics = [...structural.diagnostics, ...semanticDiagnostics];
  return hasErrorDiagnostics(diagnostics)
    ? decodeFailure(diagnostics)
    : decodeSuccess(structural.value, diagnostics);
}
