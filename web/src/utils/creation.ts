// Pure character-creation rules (WFRP 4e Chapter 1). The randomisation-reward
// XP, the starting-money-by-Status roll, and the career→capability inference
// live here so the New Character wizard stays declarative and these rules are
// unit-tested in isolation.

/** How the player settled on their career (WFRP 4e p.36–37). */
export type CareerMode = 'first' | 'three' | 'choose';

/**
 * XP banked from letting fate decide at creation (WFRP 4e p.36–37):
 *  - random Species: +20 XP
 *  - accept the first career roll: +50 XP
 *  - roll three careers and pick one: +25 XP
 *  - choose a career freely: +0 XP
 * The total is the character's starting (spendable) XP.
 */
export function startingXp(speciesRandom: boolean, mode: CareerMode): number {
  const species = speciesRandom ? 20 : 0;
  const career = mode === 'first' ? 50 : mode === 'three' ? 25 : 0;
  return species + career;
}

export type StatusTier = 'Brass' | 'Silver' | 'Gold';

/** The tier word from a Status string ("Silver 3" → "Silver"); defaults Brass. */
export function statusTier(status: string): StatusTier {
  const w = status.trim().split(/\s+/)[0]?.toLowerCase();
  if (w === 'gold') return 'Gold';
  if (w === 'silver') return 'Silver';
  return 'Brass';
}

/**
 * Starting money by Status tier (WFRP 4e p.50): Brass → 2d10 brass pennies,
 * Silver → 1d10 silver shillings, Gold → 1d10 gold crowns. `rolls` supplies the
 * d10 results (injected so this stays pure/testable). Keyed to the WFRP currency
 * units gc / ss / d.
 */
export function startingMoney(tier: StatusTier, rolls: number[]): { gc: number; ss: number; d: number } {
  if (tier === 'Gold') return { gc: rolls[0] ?? 0, ss: 0, d: 0 };
  if (tier === 'Silver') return { gc: 0, ss: rolls[0] ?? 0, d: 0 };
  return { gc: 0, ss: 0, d: (rolls[0] ?? 0) + (rolls[1] ?? 0) };
}

/** Number of d10s the starting-money roll needs for a tier (Brass rolls 2d10). */
export function startingMoneyDice(tier: StatusTier): number {
  return tier === 'Brass' ? 2 : 1;
}

export interface CareerCapabilities {
  isCaster: boolean;
  isAnointed: boolean;
}

// Careers whose starting characters wield magic or divine power. Kept as id sets
// so the inference is explicit; anything else is a mundane career.
const CASTER_CAREERS = new Set(['car.wizard', 'car.hedge-witch', 'car.witch']);
const ANOINTED_CAREERS = new Set(['car.priest', 'car.warrior-priest', 'car.nun']);

/** Whether a career grants the Magic / Faith screens at creation. */
export function inferCareerCapabilities(careerId: string): CareerCapabilities {
  return {
    isCaster: CASTER_CAREERS.has(careerId),
    isAnointed: ANOINTED_CAREERS.has(careerId),
  };
}

/** Pick `count` distinct items from `pool` using injected picks in [0,1). Falls
    back to fewer if the pool is small. Used for the "roll three careers" option. */
export function pickDistinct<T>(pool: T[], count: number, randoms: number[]): T[] {
  const remaining = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const r = randoms[i] ?? 0;
    const idx = Math.min(remaining.length - 1, Math.floor(r * remaining.length));
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}
