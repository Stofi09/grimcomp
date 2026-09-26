import {
  SETTINGS_BACKUP_FILE_LIMIT_LABEL,
  SETTINGS_BACKUP_SCHEMA,
  settingsBackupExceedsFileLimit,
} from '@grimcomp/core';

/** Check the transport envelope before the existing import validates every key. */
export function parseBackupSnapshot(snapshot: string): Record<string, unknown> {
  if (settingsBackupExceedsFileLimit(snapshot)) {
    throw new Error(`This backup exceeds the ${SETTINGS_BACKUP_FILE_LIMIT_LABEL} limit.`);
  }
  let value: unknown;
  try { value = JSON.parse(snapshot); }
  catch { throw new Error('This backup does not contain valid JSON.'); }
  if (
    typeof value !== 'object' || value === null || Array.isArray(value)
    || !('$schema' in value) || value.$schema !== SETTINGS_BACKUP_SCHEMA
  ) {
    throw new Error('This backup is not a supported Grim Companion export.');
  }
  if (!Object.keys(value).some(key => key.startsWith('gc.'))) {
    throw new Error('There is no saved character or settings data to back up yet. Make a local change first, then save a backup.');
  }
  return value as Record<string, unknown>;
}
