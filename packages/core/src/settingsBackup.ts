import { MAX_JOURNAL_RAW_LENGTH } from './storage/journal';

export const SETTINGS_BACKUP_SCHEMA = 'grimcomp.v1' as const;

const SETTINGS_BACKUP_JOURNAL_RESERVE_BYTES = 256 * 1024;

/**
 * A portable import is journaled with both its before- and after-images. Each
 * raw JSON value can nearly double when escaped inside that journal, so keep
 * the file cap below one quarter of the journal budget and reserve space for
 * operation keys and metadata.
 */
export const MAX_SETTINGS_BACKUP_FILE_BYTES = Math.floor(
  (MAX_JOURNAL_RAW_LENGTH - SETTINGS_BACKUP_JOURNAL_RESERVE_BYTES) / 4,
);
export const SETTINGS_BACKUP_FILE_LIMIT_LABEL = `${MAX_SETTINGS_BACKUP_FILE_BYTES / 1024} KiB`;

const PLATFORM_LOCAL_SETTINGS_KEYS = new Set([
  'gc.newchar.draft',
  'gc.newchar.step',
]);

/** Creation progress has different runtime shapes on web and native. */
export function isPlatformPortableSettingsKey(key: string): boolean {
  return !PLATFORM_LOCAL_SETTINGS_KEYS.has(key);
}

/**
 * Counts UTF-8 bytes without allocating a second encoded copy of the backup.
 * Stops as soon as the shared file cap is crossed.
 */
export function settingsBackupExceedsFileLimit(text: string): boolean {
  if (text.length > MAX_SETTINGS_BACKUP_FILE_BYTES) return true;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > MAX_SETTINGS_BACKUP_FILE_BYTES) return true;
  }
  return false;
}
