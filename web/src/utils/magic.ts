// Pure WFRP 4e spellcasting resolution: combine the casting-test SL with any
// SL banked from Channelling, compare to the spell's Casting Number (CN), and
// work out the surplus available for Overcasting.
//
// WFRP 4e (CRB p.238-239): a spell is cast when the SL generated meets or beats
// its CN. Channelling banks SL across rounds toward that CN. SL over the CN may
// be spent on Overcasting — every 2 surplus SL buys one effect (+1 Target,
// +1× Range, or +1× Duration). The casting test itself must pass; stored
// Channelling SL cannot turn a failed test into a successful cast.

export interface CastOutcome {
  /** Signed SL from the casting test (negative on a failed test). */
  testSl: number;
  /** SL contributed by the Channelling pool. */
  pooledSl: number;
  /** testSl + pooledSl. */
  totalSl: number;
  cn: number;
  /** The spell goes off: the casting test passed and total SL ≥ CN. */
  cast: boolean;
  /** SL beyond the CN once cast (0 otherwise). */
  surplus: number;
  /** Overcasting effects affordable from the surplus — one per 2 surplus SL. */
  overcasts: number;
}

/** SL spent per Overcasting effect (CRB p.239). */
export const SL_PER_OVERCAST = 2;

export function resolveCast(testSl: number, pooledSl: number, cn: number, testPassed: boolean): CastOutcome {
  const pool = Math.max(0, Math.round(pooledSl));
  const totalSl = Math.round(testSl) + pool;
  const cast = testPassed && totalSl >= cn;
  const surplus = cast ? Math.max(0, totalSl - cn) : 0;
  return {
    testSl: Math.round(testSl),
    pooledSl: pool,
    totalSl,
    cn,
    cast,
    surplus,
    overcasts: Math.floor(surplus / SL_PER_OVERCAST),
  };
}
