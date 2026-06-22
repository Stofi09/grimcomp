// Pure WFRP 4e combat-resolution helpers: hit location from the to-hit roll,
// armour points by location, and damage soak (Toughness Bonus + Armour Points).
//
// These implement the parts of the WFRP 4e damage sequence the engine had been
// skipping — the displayed Armour Points and the target's Toughness never
// actually reduced incoming damage, and hit location was never derived from the
// attack roll. Kept dependency-free so they unit-test in isolation and both the
// Combat and Wounds screens share one source of truth.

import type { HitLocationKey, HitLocationRow } from '@/content/types';

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
