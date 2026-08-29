import {
  decodeFailure,
  decodeSuccess,
  hasErrorDiagnostics,
  makeDiagnostic,
  quoteDiagnosticValue,
  type DecodeResult,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticPathSegment,
} from './diagnostics';
import type { ExtensionRecord, JsonValue } from './types';

export type UnknownRecord = Record<string, unknown>;
export type DecodePath = readonly DiagnosticPathSegment[];
export const MAX_DECODE_NODES = 10_000;
export const MAX_STRUCTURAL_ARRAY_LENGTH = 5_000;
export const MAX_EXTENSION_DEPTH = 64;

type SnapshotFailureReason =
  | 'invalid_type'
  | 'unreadable'
  | 'accessor'
  | 'symbol_key'
  | 'node_limit';

type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SnapshotFailureReason };

const ownProperty = Object.prototype.hasOwnProperty;

export function safeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return ownProperty.call(object, key);
}

function safeArrayCheck(value: unknown): { ok: true; value: boolean } | { ok: false } {
  try {
    return { ok: true, value: Array.isArray(value) };
  } catch {
    return { ok: false };
  }
}

function acceptReflectedKeyCount(
  count: number,
  context: DecodeContext,
  path: DecodePath,
): boolean {
  if (count <= MAX_DECODE_NODES) return true;
  context.consumeNodes(count, path);
  return false;
}

/**
 * Capture only own enumerable data properties. Reading descriptors avoids
 * invoking getters and the null prototype prevents inherited data from being
 * mistaken for wire fields later in a decoder.
 */
function snapshotOwnEnumerableRecord(
  value: unknown,
  context: DecodeContext,
  path: DecodePath,
): SnapshotResult<UnknownRecord> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'invalid_type' };
  }

  const arrayCheck = safeArrayCheck(value);
  if (!arrayCheck.ok) return { ok: false, reason: 'unreadable' };
  if (arrayCheck.value) return { ok: false, reason: 'invalid_type' };

  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, reason: 'invalid_type' };
    }

    const keys = Reflect.ownKeys(value);
    if (!acceptReflectedKeyCount(keys.length, context, path)) {
      return { ok: false, reason: 'node_limit' };
    }
    const snapshot = safeRecord<unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return { ok: false, reason: 'unreadable' };
      if (!hasOwn(descriptor, 'value')) return { ok: false, reason: 'accessor' };
      if (!descriptor.enumerable) continue;
      if (typeof key !== 'string') return { ok: false, reason: 'symbol_key' };
      snapshot[key] = descriptor.value;
    }
    return { ok: true, value: snapshot };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

function canonicalArrayIndex(key: string): number | undefined {
  if (key === '0') return 0;
  if (!/^[1-9]\d*$/.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < 0xffff_ffff && String(index) === key
    ? index
    : undefined;
}

function reportSnapshotFailure(
  reason: SnapshotFailureReason,
  context: DecodeContext,
  path: DecodePath,
  label: string,
): void {
  if (reason === 'node_limit') return;
  if (reason === 'invalid_type') {
    context.error('invalid_type', path, `${label} must be a plain object.`);
    return;
  }
  const detail = reason === 'accessor'
    ? 'Accessors are not allowed in wire data.'
    : reason === 'symbol_key'
      ? 'Enumerable symbol keys are not allowed in wire data.'
      : 'The value could not be safely reflected.';
  context.error('unreadable_input', path, `${label} must contain readable inert own data. ${detail}`);
}

function snapshotArray(
  value: unknown,
  context: DecodeContext,
  path: DecodePath,
  label: string,
  consumeStructuralEntries: boolean,
): unknown[] | undefined {
  const arrayCheck = safeArrayCheck(value);
  if (!arrayCheck.ok) {
    context.error('unreadable_input', path, `${label} could not be safely inspected.`);
    return undefined;
  }
  if (!arrayCheck.value) {
    context.error('invalid_type', path, `${label} must be an array.`);
    return undefined;
  }

  try {
    const array = value as object;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(array, 'length');
    if (
      !lengthDescriptor
      || !hasOwn(lengthDescriptor, 'value')
      || typeof lengthDescriptor.value !== 'number'
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      context.error('unreadable_input', path, `${label} must have an inert array length.`);
      return undefined;
    }
    const length = lengthDescriptor.value;
    if (!context.acceptArrayLength(length, path, label)) return undefined;
    if (consumeStructuralEntries && !context.consumeNodes(length, path)) return undefined;

    const keys = Reflect.ownKeys(array);
    if (!acceptReflectedKeyCount(keys.length, context, path)) return undefined;
    const snapshot = new Array<unknown>(length);
    const present = safeRecord<boolean>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(array, key);
      if (!descriptor) {
        context.error('unreadable_input', path, `${label} changed while it was inspected.`);
        return undefined;
      }
      if (!hasOwn(descriptor, 'value')) {
        const accessorPath = typeof key === 'string'
          ? child(path, canonicalArrayIndex(key) ?? key)
          : path;
        context.error('unreadable_input', accessorPath, 'Array accessors are not allowed in wire data.');
        return undefined;
      }
      if (!descriptor.enumerable) continue;
      if (typeof key !== 'string') {
        context.error('unreadable_input', path, `${label} must not have enumerable symbol keys.`);
        return undefined;
      }
      const index = canonicalArrayIndex(key);
      if (index === undefined || index >= length) {
        context.error('unreadable_input', path, `${label} must contain only indexed entries.`);
        return undefined;
      }
      Object.defineProperty(snapshot, index, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
      present[index] = true;
    }
    for (let index = 0; index < length; index += 1) {
      if (!present[index]) {
        context.error('unreadable_input', path, `${label} must not contain sparse or inherited entries.`);
        return undefined;
      }
    }
    return snapshot;
  } catch {
    context.error('unreadable_input', path, `${label} could not be safely reflected.`);
    return undefined;
  }
}

export class DecodeContext {
  readonly diagnostics: Diagnostic[] = [];
  private decodedNodes = 0;
  private nodeLimitReported = false;

  error(code: DiagnosticCode, path: DecodePath, message: string): void {
    this.diagnostics.push(makeDiagnostic(code, path, message));
  }

  consumeNode(path: DecodePath): boolean {
    return this.consumeNodes(1, path);
  }

  consumeNodes(count: number, path: DecodePath): boolean {
    if (this.decodedNodes + count > MAX_DECODE_NODES) {
      if (!this.nodeLimitReported) {
        this.error(
          'decode_node_limit',
          path,
          `Decode exceeds the ${MAX_DECODE_NODES}-node safety limit.`,
        );
        this.nodeLimitReported = true;
      }
      this.decodedNodes = MAX_DECODE_NODES;
      return false;
    }
    this.decodedNodes += count;
    return true;
  }

  acceptArrayLength(length: number, path: DecodePath, label: string): boolean {
    if (length <= MAX_STRUCTURAL_ARRAY_LENGTH) return true;
    this.error(
      'array_too_large',
      path,
      `${label} exceeds the ${MAX_STRUCTURAL_ARRAY_LENGTH}-entry safety limit.`,
    );
    return false;
  }

  finish<T>(value: T | undefined): DecodeResult<T> {
    return value === undefined || hasErrorDiagnostics(this.diagnostics)
      ? decodeFailure(this.diagnostics)
      : decodeSuccess(value, this.diagnostics);
  }
}

export function child(path: DecodePath, segment: DiagnosticPathSegment): DecodePath {
  return [...path, segment];
}

export function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null) return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function readObject(
  value: unknown,
  context: DecodeContext,
  path: DecodePath,
  label = 'value',
): UnknownRecord | undefined {
  if (!context.consumeNode(path)) return undefined;
  const snapshot = snapshotOwnEnumerableRecord(value, context, path);
  if (!snapshot.ok) {
    reportSnapshotFailure(snapshot.reason, context, path, label);
    return undefined;
  }
  return snapshot.value;
}

export function rejectUnknownKeys(
  object: UnknownRecord,
  allowedKeys: readonly string[],
  context: DecodeContext,
  path: DecodePath,
): void {
  const allowed = new Set(allowedKeys);
  for (const key in object) {
    if (!hasOwn(object, key)) continue;
    if (!context.consumeNode(child(path, key))) return;
    if (!allowed.has(key)) {
      context.error('unknown_key', child(path, key), `Unknown wire key ${quoteDiagnosticValue(key)}.`);
    }
  }
}

export function readSchema(
  object: UnknownRecord,
  expected: string,
  context: DecodeContext,
  path: DecodePath,
): typeof expected | undefined {
  if (object.$schema !== expected) {
    context.error('wrong_schema', child(path, '$schema'), `Expected schema "${expected}".`);
    return undefined;
  }
  return expected;
}

export function readString(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  options: { id?: boolean; rulesetIdentity?: boolean } = {},
): string | undefined {
  const value = object[key];
  const valuePath = child(path, key);
  if (value === undefined && options.rulesetIdentity) {
    context.error('missing_ruleset_identity', valuePath, `Ruleset ${key} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    context.error('invalid_type', valuePath, `${key} must be a string.`);
    return undefined;
  }
  if (value.trim().length === 0) {
    context.error(options.id ? 'blank_id' : 'blank_string', valuePath, `${key} must not be blank.`);
    return undefined;
  }
  return value;
}

export function readOptionalString(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return readString(object, key, context, path);
}

export function readOptionalId(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return readString(object, key, context, path, { id: true });
}

export function readBoolean(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): boolean | undefined {
  const value = object[key];
  if (typeof value !== 'boolean') {
    context.error('invalid_type', child(path, key), `${key} must be a boolean.`);
    return undefined;
  }
  return value;
}

export function readOptionalBoolean(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): boolean | undefined {
  if (object[key] === undefined) return undefined;
  return readBoolean(object, key, context, path);
}

export function readFiniteNumber(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): number | undefined {
  const value = object[key];
  const valuePath = child(path, key);
  if (typeof value !== 'number') {
    context.error('invalid_type', valuePath, `${key} must be a number.`);
    return undefined;
  }
  if (!Number.isFinite(value)) {
    context.error('nonfinite_number', valuePath, `${key} must be finite.`);
    return undefined;
  }
  return value;
}

export function readOptionalFiniteNumber(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): number | undefined {
  if (object[key] === undefined) return undefined;
  return readFiniteNumber(object, key, context, path);
}

export function readInteger(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  minimum = 0,
): number | undefined {
  const value = readFiniteNumber(object, key, context, path);
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum) {
    context.error('invalid_integer', child(path, key), `${key} must be a safe integer >= ${minimum}.`);
    return undefined;
  }
  return value;
}

export function readOptionalInteger(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  minimum = 0,
): number | undefined {
  if (object[key] === undefined) return undefined;
  return readInteger(object, key, context, path, minimum);
}

export function readEnum<const T extends readonly string[]>(
  object: UnknownRecord,
  key: string,
  allowed: T,
  context: DecodeContext,
  path: DecodePath,
  rulesetIdentity = false,
): T[number] | undefined {
  const value = object[key];
  const valuePath = child(path, key);
  if (value === undefined && rulesetIdentity) {
    context.error('missing_ruleset_identity', valuePath, `Ruleset ${key} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    context.error('invalid_enum', valuePath, `${key} must be one of: ${allowed.join(', ')}.`);
    return undefined;
  }
  return value as T[number];
}

export function readArray(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
): unknown[] | undefined {
  const value = object[key];
  if (!context.consumeNode(child(path, key))) return undefined;
  return snapshotArray(value, context, child(path, key), key, true);
}

function decodeJsonValue(
  value: unknown,
  context: DecodeContext,
  path: DecodePath,
  depth = 0,
  active: WeakSet<object> = new WeakSet<object>(),
): JsonValue | undefined {
  if (!context.consumeNode(path)) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      context.error('nonfinite_number', path, 'JSON numbers must be finite.');
      return undefined;
    }
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const arrayCheck = safeArrayCheck(value);
    if (!arrayCheck.ok) {
      context.error('unreadable_input', path, 'Extension value could not be safely inspected.');
      return undefined;
    }
    if (arrayCheck.value) {
      if (depth >= MAX_EXTENSION_DEPTH) {
        context.error(
          'extension_depth_exceeded',
          path,
          `Extension data exceeds the ${MAX_EXTENSION_DEPTH}-level depth limit.`,
        );
        return undefined;
      }
      if (active.has(value)) {
        context.error('cyclic_extension', path, 'Extension data must not contain cycles.');
        return undefined;
      }
      const snapshot = snapshotArray(value, context, path, 'extension array', false);
      if (!snapshot) return undefined;
      active.add(value);
      const decoded: JsonValue[] = [];
      let valid = true;
      try {
        for (let index = 0; index < snapshot.length; index += 1) {
          const result = decodeJsonValue(
            snapshot[index], context, child(path, index), depth + 1, active,
          );
          if (result === undefined) {
            valid = false;
            if (context.diagnostics.some(diagnostic => diagnostic.code === 'decode_node_limit')) break;
          } else decoded.push(result);
        }
      } catch {
        context.error('invalid_json_value', path, 'Extension arrays must be readable inert JSON data.');
        valid = false;
      } finally {
        active.delete(value);
      }
      return valid ? decoded : undefined;
    }

    const snapshot = snapshotOwnEnumerableRecord(value, context, path);
    if (!snapshot.ok) {
      if (snapshot.reason === 'invalid_type') {
        context.error('invalid_json_value', path, 'Extension values must be inert JSON data.');
      } else {
        reportSnapshotFailure(snapshot.reason, context, path, 'Extension object');
      }
      return undefined;
    }
    if (depth >= MAX_EXTENSION_DEPTH) {
      context.error(
        'extension_depth_exceeded',
        path,
        `Extension data exceeds the ${MAX_EXTENSION_DEPTH}-level depth limit.`,
      );
      return undefined;
    }
    if (active.has(value)) {
      context.error('cyclic_extension', path, 'Extension data must not contain cycles.');
      return undefined;
    }
    active.add(value);
    const decoded = safeRecord<JsonValue>();
    let valid = true;
    try {
      for (const key in snapshot.value) {
        const result = decodeJsonValue(snapshot.value[key], context, child(path, key), depth + 1, active);
        if (result === undefined) {
          valid = false;
          if (context.diagnostics.some(diagnostic => diagnostic.code === 'decode_node_limit')) break;
        } else decoded[key] = result;
      }
    } catch {
      context.error('invalid_json_value', path, 'Extension objects must be readable inert JSON data.');
      valid = false;
    } finally {
      active.delete(value);
    }
    return valid ? decoded : undefined;
  }
  context.error('invalid_json_value', path, 'Extension values must be inert JSON data.');
  return undefined;
}

export function readExtensionRecord(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  required = false,
): ExtensionRecord | undefined {
  try {
    if (object[key] === undefined && !required) return undefined;
    const record = object[key];
    if (!isPlainObject(record)) {
      context.error('invalid_type', child(path, key), `${key} must be a plain object.`);
      return undefined;
    }
    return decodeJsonValue(record, context, child(path, key)) as ExtensionRecord | undefined;
  } catch {
    context.error('invalid_json_value', child(path, key), `${key} must be readable inert JSON data.`);
    return undefined;
  }
}

export function readStringArray(
  object: UnknownRecord,
  key: string,
  context: DecodeContext,
  path: DecodePath,
  idValues = false,
): string[] | undefined {
  const values = readArray(object, key, context, path);
  if (!values) return undefined;
  const decoded: string[] = [];
  let valid = true;
  values.forEach((value, index) => {
    const valuePath = child(child(path, key), index);
    if (typeof value !== 'string') {
      context.error('invalid_type', valuePath, `${key} entries must be strings.`);
      valid = false;
    } else if (value.trim().length === 0) {
      context.error(idValues ? 'blank_id' : 'blank_string', valuePath, `${key} entries must not be blank.`);
      valid = false;
    } else {
      decoded.push(value);
    }
  });
  return valid ? decoded : undefined;
}
