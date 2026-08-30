import {
  MAX_SETTINGS_BACKUP_FILE_BYTES,
  SETTINGS_BACKUP_FILE_LIMIT_LABEL,
  settingsBackupExceedsFileLimit,
} from '@grimcomp/core';

/** Keep one imported document within the shared portable-backup file cap. */
export const MAX_NATIVE_IMPORT_FILE_BYTES = MAX_SETTINGS_BACKUP_FILE_BYTES;

function limitMessage(name: string): string {
  return `${name} is larger than the ${SETTINGS_BACKUP_FILE_LIMIT_LABEL} import limit.`;
}

export function knownNativeImportSizeError(name: string, size: unknown): string | null {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 && size > MAX_NATIVE_IMPORT_FILE_BYTES
    ? limitMessage(name)
    : null;
}

/** Parse only an unambiguous non-negative decimal Content-Length value. */
export function parseNativeImportContentLength(value: string | null): number | undefined {
  if (value === null || !/^(0|[1-9]\d*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function nativeImportTextSizeError(name: string, text: string): string | null {
  return settingsBackupExceedsFileLimit(text) ? limitMessage(name) : null;
}
