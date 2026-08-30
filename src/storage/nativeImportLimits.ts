import { MAX_JOURNAL_RAW_LENGTH } from '@grimcomp/core';

/** Keep one imported document within the storage journal's hard raw-size cap. */
export const MAX_NATIVE_IMPORT_FILE_BYTES = MAX_JOURNAL_RAW_LENGTH;

function limitMessage(name: string): string {
  return `${name} is larger than the ${(MAX_NATIVE_IMPORT_FILE_BYTES / (1024 * 1024)).toFixed(0)} MiB import limit.`;
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

/**
 * Counts UTF-8 bytes without allocating a second encoded copy of the document.
 * Stops as soon as the cap is crossed because callers only need a bound check.
 */
function exceedsUtf8Limit(text: string): boolean {
  if (text.length > MAX_NATIVE_IMPORT_FILE_BYTES) return true;
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
    if (bytes > MAX_NATIVE_IMPORT_FILE_BYTES) return true;
  }
  return false;
}

export function nativeImportTextSizeError(name: string, text: string): string | null {
  return exceedsUtf8Limit(text) ? limitMessage(name) : null;
}
