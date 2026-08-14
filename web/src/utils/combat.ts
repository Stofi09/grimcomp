// Pure WFRP 4e combat-resolution helpers: hit location from the to-hit roll,
// armour points by location, and damage soak (Toughness Bonus + Armour Points).
//
// These implement the parts of the WFRP 4e damage sequence the engine had been
// skipping — the displayed Armour Points and the target's Toughness never
// actually reduced incoming damage, and hit location was never derived from the
// attack roll. Kept dependency-free so they unit-test in isolation and both the
// Combat and Wounds screens share one source of truth.

import type { HitLocationKey, HitLocationRow } from '@/content/types';
import { isDouble } from './roll';

// --- Weapon reach/range shape ----------------------------------------------

export interface WeaponDistance {
  reach?: string;
  range?: string;
}

/**
 * Weapons use exactly one distance field. Normalising at editor boundaries
 * prevents a hidden melee `reach` from masking a ranged weapon's `range` (and
 * vice versa) after its group changes.
 */
export function normalizeWeaponDistance<T extends WeaponDistance>(weapon: T, ranged: boolean): T {
  const normalized = { ...weapon };
  if (ranged) delete normalized.reach;
  else delete normalized.range;
  return normalized;
}

/** Read the distance field appropriate to the weapon's current group. */
export function weaponDistance(weapon: WeaponDistance, ranged: boolean): string | undefined {
  return ranged ? weapon.range : weapon.reach;
}

/**
 * WFRP 4e hit location (CRB p.159): reverse the digits of the successful to-hit
 * roll. 27 → 72, 6 → 60, a double like 33 → 33. A roll reading 00 (i.e. 100)
 * reverses to 00, which on the location die reads as 100.
 */
export function reverseDigits(roll: number): number {
  const r = Math.max(1, Math.min(100, Math.round(roll)));
  const tens = Math.floor((r % 100) / 10); // 100 → 0
  const units = r % 10;
  const reversed = units * 10 + tens; // 0..99
  return reversed === 0 ? 100 : reversed;
}

export interface HitLocation {
  key: HitLocationKey;
  label: string;
  /** The reversed-digit location roll (1..100). */
  locRoll: number;
}

/** Map a to-hit roll to a hit location via the pack's location table. */
export function hitLocationFromRoll(toHitRoll: number, rows: HitLocationRow[]): HitLocation {
  const locRoll = reverseDigits(toHitRoll);
  const band = rows.find((r) => locRoll >= r.min && locRoll <= r.max);
  return { key: band?.key ?? 'body', label: band?.label ?? 'Body', locRoll };
}

/** The six WFRP armour locations AP accumulates onto. */
export const AP_LOCATIONS = ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'] as const;
export type ApLocation = (typeof AP_LOCATIONS)[number];
export type ApMap = Record<ApLocation, number>;

const emptyAp = (): ApMap => ({ head: 0, body: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 });

/**
 * Sum armour points per location from a worn-armour list. A piece's `locs`
 * uses the editor's coarse buckets (Head/Body/Arms/Legs); Arms and Legs each
 * cover both sides.
 */
export function apByLocation(armour: Array<{ locs: string[]; ap: number }>): ApMap {
  const sums = emptyAp();
  for (const a of armour) {
    for (const loc of a.locs) {
      if (loc === 'Head') sums.head += a.ap;
      else if (loc === 'Body') sums.body += a.ap;
      else if (loc === 'Arms') {
        sums.arm_l += a.ap;
        sums.arm_r += a.ap;
      } else if (loc === 'Legs') {
        sums.leg_l += a.ap;
        sums.leg_r += a.ap;
      }
    }
  }
  return sums;
}

/** AP at a specific hit-location key, falling back to Body for an unmapped key. */
export function apAt(ap: ApMap, key: string): number {
  return (ap as Record<string, number>)[key] ?? ap.body ?? 0;
}

export interface SoakInput {
  /** Incoming Damage (weapon Damage + SL of the hit), before mitigation. */
  damage: number;
  toughnessBonus: number;
  ap: number;
}

export interface SoakResult extends SoakInput {
  /** Net Wounds lost = max(0, Damage − Toughness Bonus − Armour Points). */
  woundsLost: number;
}

/**
 * WFRP 4e damage mitigation (CRB p.160): the target reduces incoming Damage by
 * their Toughness Bonus + the Armour Points covering the struck location. A hit
 * that is fully absorbed deals 0 Wounds.
 */
export function soakDamage({ damage, toughnessBonus, ap }: SoakInput): SoakResult {
  const tb = Math.max(0, Math.round(toughnessBonus));
  const armour = Math.max(0, Math.round(ap));
  const dmg = Math.max(0, Math.round(damage));
  return { damage: dmg, toughnessBonus: tb, ap: armour, woundsLost: Math.max(0, dmg - tb - armour) };
}

export interface ApplyDamageInput extends SoakInput {
  currentWounds: number;
}

export interface ApplyDamageResult extends SoakResult {
  currentWounds: number;
  newWounds: number;
  /**
   * A Critical Wound is suffered (CRB p.180): the hit reduced the target to 0
   * Wounds, or it landed and dealt ≥1 Wound while the target was already at 0.
   */
  critical: boolean;
}

/** Resolve an incoming hit against a target's current Wounds. */
export function applyDamage(input: ApplyDamageInput): ApplyDamageResult {
  const soak = soakDamage(input);
  const current = Math.max(0, Math.round(input.currentWounds));
  const newWounds = Math.max(0, current - soak.woundsLost);
  const reducedToZero = current > 0 && newWounds === 0 && soak.woundsLost > 0;
  const hitWhileDown = current === 0 && soak.woundsLost > 0;
  return {
    ...soak,
    currentWounds: current,
    newWounds,
    critical: reducedToZero || hitWhileDown,
  };
}

// --- Advantage (CRB p.163) ---

/**
 * The test bonus from a pool of Advantage: +10 per point (WFRP 4e p.164).
 * Advantage is clamped at ≥0.
 */
export function advantageBonus(advantage: number): number {
  return Math.max(0, Math.round(advantage)) * 10;
}

// --- Opposed Tests (CRB p.297) — melee is resolved as one ---

export interface OpposedResult {
  /** True when the attacker wins outright. A draw is NOT an attacker win. */
  attackerWins: boolean;
  winner: 'attacker' | 'defender' | 'draw';
  /** Winner's SL minus loser's SL (a losing SL is negative, so this widens the
      gap). This is the SL that feeds the winner's damage. 0 on a draw. */
  netSL: number;
}

/**
 * Resolve an Opposed Test from each side's signed SL. The higher SL wins; the
 * winner's net SL is the difference (subtracting a negative loser SL adds to
 * it). Equal SLs are a draw — in melee, nothing happens (the attack fails).
 */
export function resolveOpposed(attackerSL: number, defenderSL: number): OpposedResult {
  if (attackerSL === defenderSL) return { attackerWins: false, winner: 'draw', netSL: 0 };
  const attackerWins = attackerSL > defenderSL;
  return {
    attackerWins,
    winner: attackerWins ? 'attacker' : 'defender',
    netSL: Math.abs(attackerSL - defenderSL),
  };
}

export interface AttackOutcome {
  landed: boolean;
  /** SL added to damage: own SL unopposed, winner's net SL when opposed. */
  damageSl: number;
  /** Present only for an Opposed Test. */
  opposed?: OpposedResult;
}

/**
 * Turn test results into the hit/damage inputs used by the combat screen.
 * In an Opposed Test, the higher SL wins even when both participants failed;
 * the winner's net SL (not the attacker's raw SL) feeds damage.
 */
export function resolveAttackOutcome(
  attackerSuccess: boolean,
  attackerSL: number,
  defenderSL?: number,
): AttackOutcome {
  if (defenderSL !== undefined) {
    const opposed = resolveOpposed(attackerSL, defenderSL);
    return {
      landed: opposed.attackerWins,
      damageSl: opposed.attackerWins ? opposed.netSL : 0,
      opposed,
    };
  }
  return {
    landed: attackerSuccess,
    damageSl: attackerSuccess ? Math.max(0, attackerSL) : 0,
  };
}

// --- Weapon qualities that touch damage (CRB p.293) ---

/**
 * Case-insensitive, word-boundary quality match. A weapon may carry a compound
 * quality string ("Impale, Ranged", "Damaging (…)"); this keeps every call site
 * — the damage calc, the screen's Impale pre-roll, the notes list — agreeing on
 * whether a weapon "has" a given quality, rather than three different tests.
 */
export function hasQuality(qualities: string[], name: string): boolean {
  const re = new RegExp(`\\b${name.toLowerCase()}\\b`);
  return qualities.some(q => re.test(q.toLowerCase()));
}

export interface HitDamageInput {
  /** Weapon Damage before the SL bonus (e.g. SB+4 already evaluated). */
  baseDamage: number;
  /** SL that feeds damage — own SL unopposed, net opposed SL otherwise. */
  sl: number;
  /** The to-hit roll (its units digit feeds Damaging; a double triggers Impale). */
  toHitRoll: number;
  /** Weapon qualities (and flaws), verbatim from the weapon. */
  qualities: string[];
  /** Pre-rolled extra Impale die (1d10). Injected so the calc stays pure/testable. */
  impaleRoll?: number;
}

export interface HitDamageResult {
  total: number;
  /** The SL/units-die bonus actually added to Damage. */
  slBonus: number;
  /** Damaging replaced SL with the (higher) units die of the to-hit roll. */
  damagingApplied: boolean;
  /** Impale added an extra die (only on a double to-hit roll). */
  impaleExtra: number;
  /** Units die of the to-hit roll (0 reads as 10). */
  unitsDie: number;
}

/**
 * WFRP 4e damage from a landed hit: Weapon Damage + SL, with the quality tweaks
 * that change the number:
 *  - **Damaging** — use the units die of the to-hit roll instead of SL if higher.
 *  - **Impale** — a double to-hit roll adds an extra Damage die (1d10).
 * Other qualities (Hack, Penetrating, Pummel, …) don't change this total; they
 * surface as notes via weaponQualityNotes().
 */
export function computeHitDamage(input: HitDamageInput): HitDamageResult {
  const unitsDie = input.toHitRoll % 10 === 0 ? 10 : input.toHitRoll % 10;
  const damaging = hasQuality(input.qualities, 'Damaging');
  const rawBonus = damaging ? Math.max(input.sl, unitsDie) : input.sl;
  const slBonus = Math.max(0, rawBonus);
  const impaleExtra = hasQuality(input.qualities, 'Impale') && isDouble(input.toHitRoll)
    ? Math.max(0, Math.round(input.impaleRoll ?? 0)) : 0;
  return {
    total: Math.max(0, Math.round(input.baseDamage)) + slBonus + impaleExtra,
    slBonus,
    damagingApplied: damaging && unitsDie > input.sl,
    impaleExtra,
    unitsDie,
  };
}

/** Short mechanical reminders for qualities computeHitDamage doesn't fold into
    the number. Returned in weapon order; empty when none apply. */
export function weaponQualityNotes(qualities: string[]): string[] {
  const notes: Record<string, string> = {
    penetrating: 'Penetrating — the target ignores Armour Points equal to this hit\'s SL.',
    hack: 'Hack — on a damaging hit, reduce the struck location\'s armour by 1 AP.',
    pummel: 'Pummel — you may spend Advantage to add the Stunned condition.',
    defensive: 'Defensive — grants +1 SL when used to defend in an Opposed Test.',
    shield: 'Shield — adds AP against attacks from the front; +1 SL to defend.',
    trapblade: 'Trap Blade — may catch and hold a foe\'s weapon on a successful defence.',
    dangerous: 'Dangerous — a fumble may harm the wielder.',
    reload: 'Reload — needs one or more actions to reload before firing again.',
    blackpowder: 'Blackpowder — ignores standard Armour Points (not magical AP).',
    entangle: 'Entangle — a hit may apply the Entangled condition instead of Wounds.',
    impact: 'Impact — roll two dice for the Damage die and take the higher.',
    wrap: 'Wrap — ignores shields when working out the hit.',
  };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of qualities) {
    const key = q.toLowerCase().replace(/[^a-z]/g, '');
    if (notes[key] && !seen.has(key)) {
      out.push(notes[key]);
      seen.add(key);
    }
  }
  return out;
}
