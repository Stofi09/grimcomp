import { describe, expect, it } from 'vitest';
import { loadBundledCatalogue } from '../../../src/content/bundled';
import { compareContentVersions, latestContentVersion } from '../../../src/content/contentVersion';

describe('native content version summary', () => {
  it('compares date-like versions numerically, segment by segment', () => {
    expect(compareContentVersions('2026.09.07', '2026.06.17')).toBeGreaterThan(0);
    expect(compareContentVersions('2026.10.01', '2026.9.30')).toBeGreaterThan(0);
    expect(compareContentVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareContentVersions('1.0', '1.0.1')).toBeLessThan(0);
    expect(compareContentVersions('2026.04.01', '2026.04.01')).toBe(0);
  });

  it('reports the newest loaded pack version, ignoring blank versions', () => {
    expect(latestContentVersion([{ version: '2026.04.01' }, { version: '2026.09.07' }, { version: ' ' }]))
      .toBe('2026.09.07');
    expect(latestContentVersion([])).toBeNull();
  });

  it('reflects the shipped catalogue rather than a hardcoded date', () => {
    const packs = loadBundledCatalogue().packs;
    const newest = latestContentVersion(packs);
    expect(newest).not.toBeNull();
    expect(newest).not.toBe('2026.04.01');
    expect(packs.every(pack => compareContentVersions(newest!, pack.version) >= 0)).toBe(true);
  });
});
