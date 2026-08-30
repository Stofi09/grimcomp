import { describe, expect, it } from 'vitest';
import {
  MAX_NATIVE_IMPORT_FILE_BYTES,
  knownNativeImportSizeError,
  nativeImportTextSizeError,
  parseNativeImportContentLength,
} from '../../../src/storage/nativeImportLimits';

describe('native Settings import memory bounds', () => {
  it('rejects a known oversized picker asset before reading it', () => {
    expect(knownNativeImportSizeError(
      'oversized.json',
      MAX_NATIVE_IMPORT_FILE_BYTES + 1,
    )).toMatch(/4 MiB import limit/u);
    expect(knownNativeImportSizeError('boundary.json', MAX_NATIVE_IMPORT_FILE_BYTES)).toBeNull();
    expect(knownNativeImportSizeError('unknown.json', undefined)).toBeNull();
  });

  it('uses only unambiguous safe Content-Length headers for the pre-read check', () => {
    expect(parseNativeImportContentLength(String(MAX_NATIVE_IMPORT_FILE_BYTES + 1)))
      .toBe(MAX_NATIVE_IMPORT_FILE_BYTES + 1);
    expect(parseNativeImportContentLength(' 42')).toBeUndefined();
    expect(parseNativeImportContentLength('-1')).toBeUndefined();
    expect(parseNativeImportContentLength('not-a-number')).toBeUndefined();
    expect(parseNativeImportContentLength(null)).toBeUndefined();
  });

  it('rechecks actual UTF-8 size after reading, including multibyte text', () => {
    expect(nativeImportTextSizeError(
      'boundary.json',
      'a'.repeat(MAX_NATIVE_IMPORT_FILE_BYTES),
    )).toBeNull();
    expect(nativeImportTextSizeError(
      'oversized.json',
      'a'.repeat(MAX_NATIVE_IMPORT_FILE_BYTES + 1),
    )).toMatch(/4 MiB import limit/u);
    expect(nativeImportTextSizeError(
      'multibyte.json',
      'é'.repeat(Math.floor(MAX_NATIVE_IMPORT_FILE_BYTES / 2) + 1),
    )).toMatch(/4 MiB import limit/u);
  });
});
