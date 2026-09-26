import { describe, it, expect } from 'vitest';
import {
  reverseDigits,
  hitLocationFromRoll,
  apByLocation,
  apAt,
  soakDamage,
  applyDamage,
  advantageBonus,
  resolveOpposed,
  resolveAttackOutcome,
  computeHitDamage,
  weaponQualityNotes,
  hasQuality,
  normalizeWeaponDistance,
  weaponDistance,
  skillAdvancesFor,
  skillNameKey,
} from './combat';
import type { HitLocationRow } from '@/content/types';

// The canonical WFRP 4e core hit-location table (reversed-digit roll → location,
// CRB p.159). Mirrors public/content/core-rules.json so this also locks it in.
const LOCATIONS: HitLocationRow[] = [
  { min: 1, max: 9, key: 'head', label: 'Head' },
  { min: 10, max: 24, key: 'arm_l', label: 'Left Arm' },
  { min: 25, max: 44, key: 'arm_r', label: 'Right Arm' },
  { min: 45, max: 79, key: 'body', label: 'Body' },
  { min: 80, max: 89, key: 'leg_l', label: 'Left Leg' },
  { min: 90, max: 100, key: 'leg_r', label: 'Right Leg' },
];

describe('weapon reach/range shape', () => {
  it('drops a stale melee reach when a weapon becomes ranged', () => {
    const weapon = normalizeWeaponDistance(
      { name: 'Longbow', reach: 'Average', range: '50' },
      true,
    );
    expect(weapon).toEqual({ name: 'Longbow', range: '50' });
    expect(weaponDistance(weapon, true)).toBe('50');
  });

  it('drops a stale ranged range when a weapon becomes melee', () => {
    const weapon = normalizeWeaponDistance(
      { name: 'Sword', reach: 'Average', range: '50' },
      false,
    );
    expect(weapon).toEqual({ name: 'Sword', reach: 'Average' });
    expect(weaponDistance(weapon, false)).toBe('Average');
  });
});

describe('skillAdvancesFor — weapon group ↔ skill specialisation', () => {
  it('credits a career skill spelled with different case or spacing', () => {
    const advances = { 'Melee (Two-handed)': 10, 'Ranged (Bow)': 5 };
    expect(skillAdvancesFor(advances, 'Melee (Two-Handed)')).toBe(10);
    expect(skillAdvancesFor(advances, 'ranged  (bow)')).toBe(5);
    expect(skillNameKey(' Melee (Two-Handed) ')).toBe('melee (two-handed)');
  });

  it('prefers an exact key and treats an untrained specialisation as 0 advances', () => {
    expect(skillAdvancesFor({ 'Melee (Basic)': 5, 'melee (basic)': 15 }, 'Melee (Basic)')).toBe(5);
    expect(skillAdvancesFor({ 'Melee (Basic)': 5 }, 'Melee (Fencing)')).toBe(0);
    expect(skillAdvancesFor({}, 'Ranged (Blackpowder)')).toBe(0);
  });
});

describe('reverseDigits — WFRP 4e hit-location roll', () => {
  it('swaps tens and units', () => {
    expect(reverseDigits(27)).toBe(72);
    expect(reverseDigits(94)).toBe(49);
  });

  it('treats a one-digit roll as 0N → N0', () => {
    expect(reverseDigits(6)).toBe(60);
    expect(reverseDigits(1)).toBe(10);
  });

  it('keeps doubles unchanged', () => {
    expect(reverseDigits(33)).toBe(33);
    expect(reverseDigits(55)).toBe(55);
  });

  it('reads 100 (00) as 100', () => {
    expect(reverseDigits(100)).toBe(100);
  });

  it('clamps out-of-range rolls into 1..100', () => {
    expect(reverseDigits(0)).toBe(10); // clamped to 1 → 10
    expect(reverseDigits(150)).toBe(100); // clamped to 100 → 100
  });
});

describe('hitLocationFromRoll', () => {
  it('reverses the to-hit roll then looks up the band', () => {
    // roll 47 → loc 74 → Body (45–79)
    expect(hitLocationFromRoll(47, LOCATIONS)).toMatchObject({ key: 'body', label: 'Body', locRoll: 74 });
    // roll 9 → loc 90 → Right Leg (90–100)
    expect(hitLocationFromRoll(9, LOCATIONS)).toMatchObject({ key: 'leg_r', label: 'Right Leg', locRoll: 90 });
    // roll 5 → loc 50 → Body (45–79)
    expect(hitLocationFromRoll(5, LOCATIONS)).toMatchObject({ key: 'body', locRoll: 50 });
    // roll 1 → loc 10 → Left Arm (10–24)
    expect(hitLocationFromRoll(1, LOCATIONS)).toMatchObject({ key: 'arm_l', label: 'Left Arm', locRoll: 10 });
    // roll 8 → loc 80 → Left Leg (80–89)
    expect(hitLocationFromRoll(8, LOCATIONS)).toMatchObject({ key: 'leg_l', label: 'Left Leg', locRoll: 80 });
  });

  it('falls back to Body when no band matches', () => {
    expect(hitLocationFromRoll(50, [])).toMatchObject({ key: 'body', label: 'Body' });
  });
});

describe('apByLocation', () => {
  it('sums AP per location and spreads Arms/Legs to both sides', () => {
    const ap = apByLocation([
      { locs: ['Body', 'Arms'], ap: 2 }, // mail shirt
      { locs: ['Head'], ap: 1 }, // helm
      { locs: ['Body'], ap: 5 }, // breastplate
    ]);
    expect(ap).toEqual({ head: 1, body: 7, arm_l: 2, arm_r: 2, leg_l: 0, leg_r: 0 });
  });

  it('returns all-zero for no armour', () => {
    expect(apByLocation([])).toEqual({ head: 0, body: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 });
  });
});

describe('apAt', () => {
  const ap = { head: 1, body: 7, arm_l: 2, arm_r: 2, leg_l: 0, leg_r: 0 };
  it('reads AP at a known location key', () => {
    expect(apAt(ap, 'body')).toBe(7);
    expect(apAt(ap, 'arm_l')).toBe(2);
  });
  it('falls back to body AP for an unmapped key', () => {
    expect(apAt(ap, 'tail')).toBe(7);
  });
});

describe('soakDamage — TB + AP mitigation', () => {
  it('subtracts Toughness Bonus and Armour Points', () => {
    // Greatsword SB+5 with S 40 (SB 4) → 9 damage, +2 SL = 11; target TB 4, AP 2 → 5 lost
    expect(soakDamage({ damage: 11, toughnessBonus: 4, ap: 2 }).woundsLost).toBe(5);
  });

  it('still costs 1 Wound when Toughness and armour absorb the whole hit', () => {
    const r = soakDamage({ damage: 3, toughnessBonus: 4, ap: 2 });
    expect(r.woundsLost).toBe(1);
    expect(r.minimumApplied).toBe(true);
  });

  it('deals no Wounds when there is no Damage', () => {
    const r = soakDamage({ damage: 0, toughnessBonus: 4, ap: 2 });
    expect(r.woundsLost).toBe(0);
    expect(r.minimumApplied).toBe(false);
  });

  it('treats negative TB/AP as zero', () => {
    expect(soakDamage({ damage: 10, toughnessBonus: -3, ap: -1 }).woundsLost).toBe(10);
  });
});

describe('applyDamage — Wounds + Critical trigger', () => {
  it('reduces Wounds by the net damage', () => {
    const r = applyDamage({ damage: 11, toughnessBonus: 4, ap: 2, currentWounds: 12 });
    expect(r.woundsLost).toBe(5);
    expect(r.newWounds).toBe(7);
    expect(r.critical).toBe(false);
  });

  it('flags a Critical when a hit reduces the target to 0 Wounds', () => {
    const r = applyDamage({ damage: 11, toughnessBonus: 0, ap: 0, currentWounds: 8 });
    expect(r.newWounds).toBe(0);
    expect(r.critical).toBe(true);
  });

  it('flags a Critical when a damaging hit lands while already at 0 Wounds', () => {
    const r = applyDamage({ damage: 5, toughnessBonus: 0, ap: 0, currentWounds: 0 });
    expect(r.newWounds).toBe(0);
    expect(r.critical).toBe(true);
  });

  it('flags a Critical for any hit at 0 Wounds, even one Toughness and armour absorb', () => {
    // The minimum of 1 Wound means every hit on a character at 0 Wounds crits.
    const r = applyDamage({ damage: 4, toughnessBonus: 4, ap: 2, currentWounds: 0 });
    expect(r.woundsLost).toBe(1);
    expect(r.critical).toBe(true);
  });

  it('does NOT flag a Critical for a non-lethal hit', () => {
    const r = applyDamage({ damage: 6, toughnessBonus: 0, ap: 0, currentWounds: 12 });
    expect(r.newWounds).toBe(6);
    expect(r.critical).toBe(false);
  });
});

describe('advantageBonus — +10 per Advantage (CRB p.164)', () => {
  it('scales by 10 and clamps at zero', () => {
    expect(advantageBonus(0)).toBe(0);
    expect(advantageBonus(3)).toBe(30);
    expect(advantageBonus(-2)).toBe(0);
  });
});

describe('resolveOpposed — melee as an Opposed Test', () => {
  it('the higher SL wins; net SL is the gap, widened by a losing SL', () => {
    // attacker +2 vs defender +1 (both pass) → attacker wins, net 1
    expect(resolveOpposed(2, 1)).toEqual({ attackerWins: true, winner: 'attacker', netSL: 1 });
    // attacker +2 vs defender −1 (defender failed) → attacker wins, net 3
    expect(resolveOpposed(2, -1)).toEqual({ attackerWins: true, winner: 'attacker', netSL: 3 });
    // defender out-rolls the attacker → attack fails
    expect(resolveOpposed(0, 3)).toEqual({ attackerWins: false, winner: 'defender', netSL: 3 });
  });

  it('equal SLs are a draw — the melee attack does not land', () => {
    expect(resolveOpposed(2, 2)).toEqual({ attackerWins: false, winner: 'draw', netSL: 0 });
  });
});

describe('resolveAttackOutcome', () => {
  it('lands when the attacker wins the opposed test even if both tests failed', () => {
    const result = resolveAttackOutcome(false, -1, -3);
    expect(result).toEqual({
      landed: true,
      damageSl: 2,
      opposed: { attackerWins: true, winner: 'attacker', netSL: 2 },
    });
  });

  it('uses net opposed SL for damage', () => {
    const result = resolveAttackOutcome(true, 2, -1);
    expect(result.landed).toBe(true);
    expect(result.damageSl).toBe(3);
  });

  it('still requires success and uses raw SL for an unopposed attack', () => {
    expect(resolveAttackOutcome(false, -1)).toEqual({ landed: false, damageSl: 0 });
    expect(resolveAttackOutcome(true, 2)).toEqual({ landed: true, damageSl: 2 });
  });
});

describe('hasQuality — case-insensitive, word-boundary match', () => {
  it('matches exact and compound quality strings, case-insensitively', () => {
    expect(hasQuality(['Impale'], 'Impale')).toBe(true);
    expect(hasQuality(['impale'], 'Impale')).toBe(true);
    expect(hasQuality(['Impale, Ranged'], 'Impale')).toBe(true);
    expect(hasQuality(['Damaging (special)'], 'Damaging')).toBe(true);
  });

  it('does not match on a partial word', () => {
    expect(hasQuality(['Impaled'], 'Impale')).toBe(false);
    expect(hasQuality(['Defensive'], 'Fence')).toBe(false);
    expect(hasQuality([], 'Impale')).toBe(false);
  });
});

describe('computeHitDamage — Weapon Damage + SL with quality tweaks', () => {
  it('applies Impale/Damaging even when authored as a compound quality string', () => {
    // "Impale, Ranged" must still add the extra die on a double, and
    // "Damaging (…)" must still swap in the higher units die.
    const impaled = computeHitDamage({ baseDamage: 4, sl: 1, toHitRoll: 33, qualities: ['Impale, Ranged'], impaleRoll: 6 });
    expect(impaled.impaleExtra).toBe(6);
    const damaging = computeHitDamage({ baseDamage: 4, sl: 1, toHitRoll: 8, qualities: ['Damaging (test)'] });
    expect(damaging.damagingApplied).toBe(true);
    expect(damaging.slBonus).toBe(8);
  });

  it('adds the hit SL to base damage by default', () => {
    const r = computeHitDamage({ baseDamage: 9, sl: 2, toHitRoll: 34, qualities: [] });
    expect(r.total).toBe(11);
    expect(r.slBonus).toBe(2);
    expect(r.damagingApplied).toBe(false);
  });

  it('Damaging uses the units die of the to-hit roll when higher than SL', () => {
    // roll 47 → units 7 > SL 2 → bonus 7
    const r = computeHitDamage({ baseDamage: 9, sl: 2, toHitRoll: 47, qualities: ['Damaging'] });
    expect(r.slBonus).toBe(7);
    expect(r.damagingApplied).toBe(true);
    expect(r.total).toBe(16);
  });

  it('Damaging keeps SL when SL is the higher of the two', () => {
    // roll 41 → units 1 < SL 4 → keeps SL 4
    const r = computeHitDamage({ baseDamage: 9, sl: 4, toHitRoll: 41, qualities: ['Damaging'] });
    expect(r.slBonus).toBe(4);
    expect(r.damagingApplied).toBe(false);
  });

  it('Impale adds an extra die only on a double to-hit roll', () => {
    const dbl = computeHitDamage({ baseDamage: 6, sl: 1, toHitRoll: 33, qualities: ['Impale'], impaleRoll: 8 });
    expect(dbl.impaleExtra).toBe(8);
    expect(dbl.total).toBe(6 + 1 + 8);
    const notDbl = computeHitDamage({ baseDamage: 6, sl: 1, toHitRoll: 34, qualities: ['Impale'], impaleRoll: 8 });
    expect(notDbl.impaleExtra).toBe(0);
  });

  it('a units digit of 0 reads as 10', () => {
    const r = computeHitDamage({ baseDamage: 4, sl: 1, toHitRoll: 40, qualities: ['Damaging'] });
    expect(r.unitsDie).toBe(10);
    expect(r.slBonus).toBe(10);
  });

  it('never returns negative damage', () => {
    const r = computeHitDamage({ baseDamage: 0, sl: -5, toHitRoll: 96, qualities: [] });
    expect(r.total).toBe(0);
  });
});

describe('weaponQualityNotes', () => {
  it('returns a note for the non-damage qualities, de-duplicated', () => {
    const notes = weaponQualityNotes(['Penetrating', 'Reload', 'Penetrating']);
    expect(notes.some(n => n.startsWith('Penetrating'))).toBe(true);
    expect(notes.some(n => n.startsWith('Reload'))).toBe(true);
    expect(notes.filter(n => n.startsWith('Penetrating'))).toHaveLength(1);
  });

  it('ignores qualities folded into the damage number, and unknown ones', () => {
    expect(weaponQualityNotes(['Damaging', 'Impale', 'Whatever'])).toEqual([]);
  });
});
