// Configurable test resolution. The mechanics — which dice, roll-under vs
// roll-over, auto-success/failure bands, doubles, the SL formula — come from
// a TestRules config (content packs' `system.test` section). DEFAULT_TEST_RULES
// reproduces WFRP 4e exactly:
// - Roll 1d100 against a target; pass when roll ≤ target.
// - Base SL (Success Levels) = (target tens) − (roll tens). A positive delta
//   on an auto-failure is displayed as negative so it cannot contradict FUMBLE.
// - Doubles (11, 22, …, 99): if the roll succeeds → critical success;
//   if it fails → fumble.
// - 01–05 always succeeds; 96–100 always fails (regardless of target).

import type { DiceSpec, TestRules } from '@/content/types';
import { evalFormula } from './formula';

/** WFRP 4e test mechanics — used when no pack overlays `system.test`. */
export const DEFAULT_TEST_RULES: TestRules = {
  dice: { count: 1, sides: 100 },
  direction: 'under',
  autoSuccess: { min: 1, max: 5 },
  autoFailure: { min: 96, max: 100 },
  doubles: true,
  sl: 'floor(target / 10) - floor(roll / 10)',
  targetClamp: { min: 0, max: 100 },
};

export type Outcome =
  | 'crit-success' // critical or auto success (auto band / passing double)
  | 'success'      // ordinary success
  | 'fail'         // ordinary failure
  | 'fumble';      // critical failure (auto band / failing double)

export interface RollInput {
  /** Target characteristic + skill advance */
  target: number;
  /** Optional modifier (positive = boon, negative = condition penalty). */
  modifier?: number;
  /** Force a specific roll — handy for tests. */
  forceRoll?: number;
  /** Human-readable label, shown in the formatted result. */
  label?: string;
}

export interface RollResult {
  label?: string;
  /** The raw dice total. */
  roll: number;
  /** Base target before modifiers. */
  baseTarget: number;
  /** Effective target after modifiers (clamped per rules for the outcome; the
      original modifier value is preserved separately for display). */
  effectiveTarget: number;
  modifier: number;
  success: boolean;
  /** Signed SL. Auto-failure never reports a positive value; 0 also represents systems without an SL formula. */
  sl: number;
  /** Whether this system models success levels (controls SL display). */
  hasSl: boolean;
  outcome: Outcome;
}

/** Sum of `count` rolls of a `sides`-faced die. */
export function rollDice(dice: DiceSpec): number {
  let total = 0;
  for (let i = 0; i < dice.count; i += 1) {
    total += Math.floor(Math.random() * dice.sides) + 1;
  }
  return total;
}

/** Short display form: "d100", "2d10", … */
export function diceLabel(dice: DiceSpec): string {
  return `${dice.count > 1 ? dice.count : ''}d${dice.sides}`;
}

/**
 * Roll one `sides`-faced die that "explodes": a maximum roll is added and
 * rerolled, repeating. WFRP 4e Impale works this way (the extra Damage die keeps
 * going on a 10). Capped at 100 iterations so a degenerate RNG can't loop
 * forever. `rng` is injectable for deterministic tests.
 */
export function rollExploding(sides: number, rng: () => number = Math.random): number {
  let total = 0;
  for (let i = 0; i < 100; i += 1) {
    const roll = Math.floor(rng() * sides) + 1;
    total += roll;
    if (roll < sides) break;
  }
  return total;
}

/** True for d100 doubles (11, 22, … 99). 100 and one-digit rolls are not doubles. */
export const isDouble = (roll: number): boolean =>
  roll >= 11 && roll <= 99 && Math.floor(roll / 10) === roll % 10;

const inBand = (roll: number, band?: { min: number; max: number }): boolean =>
  band !== undefined && roll >= band.min && roll <= band.max;

export function resolveTest(input: RollInput, rules: TestRules = DEFAULT_TEST_RULES): RollResult {
  const baseTarget = input.target;
  const modifier = input.modifier ?? 0;
  // A positive modifier always helps: it raises the target in roll-under
  // systems and lowers it in roll-over systems.
  let effective = rules.direction === 'under' ? baseTarget + modifier : baseTarget - modifier;
  if (rules.targetClamp) {
    effective = Math.max(rules.targetClamp.min, Math.min(rules.targetClamp.max, effective));
  }
  const roll = input.forceRoll ?? rollDice(rules.dice);
  const passes = rules.direction === 'under' ? roll <= effective : roll >= effective;

  // Outcome resolution: auto-success/fail bands first, then doubles, then the
  // plain pass/fail check.
  let outcome: Outcome;
  let success: boolean;
  if (inBand(roll, rules.autoSuccess)) {
    outcome = 'crit-success';
    success = true;
  } else if (inBand(roll, rules.autoFailure)) {
    outcome = 'fumble';
    success = false;
  } else if (rules.doubles && isDouble(roll)) {
    outcome = passes ? 'crit-success' : 'fumble';
    success = passes;
  } else {
    outcome = passes ? 'success' : 'fail';
    success = passes;
  }

  const hasSl = typeof rules.sl === 'string' && rules.sl.length > 0;
  let sl = hasSl ? evalFormula(rules.sl as string, { roll, target: effective }) : 0;
  // SL's sign must agree with the outcome. An auto-failure band (e.g. rolling
  // 96–100 against a high target) can otherwise yield a positive SL on a fumble.
  if (hasSl && !success && sl > 0) sl = -sl;

  return {
    label: input.label,
    roll,
    baseTarget,
    effectiveTarget: effective,
    modifier,
    success,
    sl,
    hasSl,
    outcome,
  };
}

/** Single-line summary for a header in an Alert. */
export function outcomeLabel(o: Outcome): string {
  switch (o) {
    case 'crit-success': return 'CRITICAL SUCCESS';
    case 'success': return 'SUCCESS';
    case 'fail': return 'FAILURE';
    case 'fumble': return 'FUMBLE';
  }
}

/** Multi-line, tabular-ish body for an Alert. */
export function formatTestResult(r: RollResult): string {
  const targetLine =
    r.modifier === 0
      ? `Roll  ${r.roll}  vs  ${r.baseTarget}`
      : `Roll  ${r.roll}  vs  ${r.effectiveTarget}   (${r.baseTarget} ${r.modifier >= 0 ? '+' : '−'} ${Math.abs(r.modifier)} mod)`;
  if (!r.hasSl) return targetLine;
  const slStr = (r.sl >= 0 ? `+${r.sl}` : `${r.sl}`) + ' SL';
  return `${targetLine}\n${slStr}`;
}
