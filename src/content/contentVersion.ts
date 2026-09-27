// Content packs carry date-like versions ("2026.09.07"). Compare them segment
// by segment, numerically where both segments are numbers, so "2026.10.01"
// sorts after "2026.9.30" and "1.10" after "1.9".

function segments(version: string): string[] {
  return version.trim().split(/[.\-+]/);
}

export function compareContentVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index] ?? '';
    const y = right[index] ?? '';
    if (x === y) continue;
    const numeric = /^\d+$/;
    if (numeric.test(x) && numeric.test(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The newest version among loaded packs, or null when none is loaded. */
export function latestContentVersion(packs: readonly { readonly version: string }[]): string | null {
  let latest: string | null = null;
  for (const { version } of packs) {
    if (!version.trim()) continue;
    if (latest === null || compareContentVersions(version, latest) > 0) latest = version.trim();
  }
  return latest;
}
