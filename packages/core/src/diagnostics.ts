export type DiagnosticSeverity = 'error' | 'warning';
export type DiagnosticPathSegment = string | number;

export type DiagnosticCode =
  | 'invalid_type'
  | 'wrong_schema'
  | 'blank_string'
  | 'blank_id'
  | 'nonfinite_number'
  | 'invalid_integer'
  | 'invalid_enum'
  | 'invalid_json_value'
  | 'unreadable_input'
  | 'invalid_hash'
  | 'invalid_timestamp'
  | 'invalid_version'
  | 'invalid_version_range'
  | 'version_mismatch'
  | 'pack_conflict'
  | 'resolution_impossible'
  | 'resolution_limit'
  | 'unknown_key'
  | 'decode_node_limit'
  | 'array_too_large'
  | 'extension_depth_exceeded'
  | 'cyclic_extension'
  | 'out_of_range'
  | 'timestamp_order'
  | 'duplicate_id'
  | 'duplicate_value'
  | 'missing_reference'
  | 'ruleset_mismatch'
  | 'rights_policy_violation'
  | 'snapshot_mismatch'
  | 'missing_ruleset_identity'
  | 'missing_profile_binding';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  path: readonly DiagnosticPathSegment[];
  message: string;
}

export interface DecodeSuccess<T> {
  ok: true;
  value: T;
  diagnostics: readonly Diagnostic[];
}

export interface DecodeFailure {
  ok: false;
  diagnostics: readonly Diagnostic[];
}

export type DecodeResult<T> = DecodeSuccess<T> | DecodeFailure;

export function makeDiagnostic(
  code: DiagnosticCode,
  path: readonly DiagnosticPathSegment[],
  message: string,
  severity: DiagnosticSeverity = 'error',
): Diagnostic {
  return { severity, code, path: [...path], message };
}

export function decodeSuccess<T>(
  value: T,
  diagnostics: readonly Diagnostic[] = [],
): DecodeSuccess<T> {
  return { ok: true, value, diagnostics: [...diagnostics] };
}

export function decodeFailure(diagnostics: readonly Diagnostic[]): DecodeFailure {
  return { ok: false, diagnostics: [...diagnostics] };
}

export function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(diagnostic => diagnostic.severity === 'error');
}

const MAX_DIAGNOSTIC_VALUE_LENGTH = 96;

/** Quote untrusted data for diagnostics without allowing log/control-character
    injection or messages proportional to attacker-controlled input size. */
export function quoteDiagnosticValue(value: string | number): string {
  const raw = String(value);
  const bounded = raw.length <= MAX_DIAGNOSTIC_VALUE_LENGTH
    ? raw
    : `${raw.slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH - 3)}...`;
  return JSON.stringify(bounded);
}

export function formatDiagnosticPath(path: readonly DiagnosticPathSegment[]): string {
  return path.reduce<string>((formatted, segment) => (
    typeof segment === 'number'
      ? `${formatted}[${segment}]`
      : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
        ? `${formatted}.${segment}`
        : `${formatted}[${JSON.stringify(segment)}]`
  ), '$');
}
