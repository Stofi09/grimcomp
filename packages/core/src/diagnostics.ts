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
  | 'missing_profile_binding'
  | 'legacy_unresolved_reference'
  | 'legacy_inferred_value'
  | 'legacy_unmapped_value'
  | 'legacy_ambiguous_reference';

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

export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 512;
export const MAX_DIAGNOSTIC_PATH_SEGMENT_LENGTH = 96;
export const MAX_DIAGNOSTIC_PATH_SEGMENTS = 96;
export const MAX_FORMATTED_DIAGNOSTIC_PATH_LENGTH = 4_096;
export const MAX_DIAGNOSTIC_VALUE_LENGTH = 96;

function truncateDiagnosticText(value: string, maximumLength: number): string {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, maximumLength - 3)}...`;
}

function boundDiagnosticMessage(value: string): string {
  return truncateDiagnosticText(value, MAX_DIAGNOSTIC_MESSAGE_LENGTH)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, '\ufffd');
}

function boundDiagnosticPath(
  path: readonly DiagnosticPathSegment[],
): DiagnosticPathSegment[] {
  const segments = path.length <= MAX_DIAGNOSTIC_PATH_SEGMENTS
    ? path
    : [
        ...path.slice(0, MAX_DIAGNOSTIC_PATH_SEGMENTS - 2),
        '...',
        path[path.length - 1],
      ];
  return segments.map(segment => (
    typeof segment === 'string'
      ? truncateDiagnosticText(segment, MAX_DIAGNOSTIC_PATH_SEGMENT_LENGTH)
      : segment
  ));
}

export function makeDiagnostic(
  code: DiagnosticCode,
  path: readonly DiagnosticPathSegment[],
  message: string,
  severity: DiagnosticSeverity = 'error',
): Diagnostic {
  return {
    severity,
    code,
    path: boundDiagnosticPath(path),
    message: boundDiagnosticMessage(message),
  };
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

/** Quote untrusted data for diagnostics without allowing log/control-character
    injection or messages proportional to attacker-controlled input size. */
export function quoteDiagnosticValue(value: string | number): string {
  const raw = String(value);
  const bounded = truncateDiagnosticText(raw, MAX_DIAGNOSTIC_VALUE_LENGTH);
  return JSON.stringify(bounded);
}

export function formatDiagnosticPath(path: readonly DiagnosticPathSegment[]): string {
  const formatted = boundDiagnosticPath(path).reduce<string>((result, segment) => (
    typeof segment === 'number'
      ? `${result}[${segment}]`
      : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
        ? `${result}.${segment}`
        : `${result}[${JSON.stringify(segment)}]`
  ), '$');
  return truncateDiagnosticText(formatted, MAX_FORMATTED_DIAGNOSTIC_PATH_LENGTH);
}
