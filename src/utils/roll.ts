// WFRP 4e d100 test resolution.
//
// Rules implemented (from the core rulebook):
// - Roll 1d100 against a target.
// - Base SL (Success Levels) = (target tens) − (roll tens). A positive delta
//   on an auto-failure is displayed as negative so it cannot contradict FUMBLE.
// - Doubles (11, 22, 33, …, 99): if the roll succeeds → critical success;
//   if it fails → fumble.
// - 01–05 always succeeds; 96–100 always fails (regardless of target).
// - SL = 0 is a marginal success when the roll succeeds (a tie counts as
//   success because roll ≤ target).
//
// Skipped intentionally for the prototype:
// - Spell-specific rules (channelling, miscast tables)
// - Group tests, opposed tests, advantage stacks
// - Specialised crit tables (we just label the outcome)

export type Outcome =
  | 'crit-success' // critical or auto success (01–05 / passing double)
  | 'success'      // ordinary success
  | 'fail'         // ordinary failure
  | 'fumble';      // critical failure (96–100 / failing double)

export interface RollInput {
  /** Target characteristic + skill advance */
  target: number;
  /** Optional modifier (positive = boon, negative = condition penalty). */
  modifier?: number;
  /** Force a specific d100 roll — handy for tests. */
  forceRoll?: number;
  /** Human-readable label, shown in the formatted result. */
  label?: string;
}

export interface RollResult {
  label?: string;
  /** The raw d100 (1..100). */
  roll: number;
  /** Base target before modifiers. */
  baseTarget: number;
  /** Effective target after modifiers (clamped to 0..100 for outcome but the
      original modifier value is preserved separately for display). */
  effectiveTarget: number;
  modifier: number;
  success: boolean;
  /** Signed SL. Auto-failure never reports a positive value; 0 is possible. */
  sl: number;
  outcome: Outcome;
}

const tens = (n: number) => Math.floor(n / 10);

const isPassingDouble = (roll: number, target: number) => {
  const t = tens(roll);
  const u = roll % 10;
  return t === u && roll <= target && roll !== 100;
};

const isFailingDouble = (roll: number, target: number) => {
  const t = tens(roll);
  const u = roll % 10;
  return t === u && roll > target && roll !== 0;
};

export function resolveTest(input: RollInput): RollResult {
  const baseTarget = input.target;
  const modifier = input.modifier ?? 0;
  const effective = Math.max(0, Math.min(100, baseTarget + modifier));
  const roll = input.forceRoll ?? Math.floor(Math.random() * 100) + 1;

  // Outcome resolution. Auto-success/fail bands first, then doubles, then
  // the plain pass/fail check.
  let outcome: Outcome;
  let success: boolean;
  if (roll <= 5) {
    outcome = 'crit-success';
    success = true;
  } else if (roll >= 96) {
    outcome = 'fumble';
    success = false;
  } else if (isPassingDouble(roll, effective)) {
    outcome = 'crit-success';
    success = true;
  } else if (isFailingDouble(roll, effective)) {
    outcome = 'fumble';
    success = false;
  } else if (roll <= effective) {
    outcome = 'success';
    success = true;
  } else {
    outcome = 'fail';
    success = false;
  }

  // SL per WFRP 4e core p.151: (target tens − roll tens). Zero can occur on
  // either outcome; the auto-failure normalization below prevents a positive
  // fumble result when a high target would otherwise pass.
  let sl = tens(effective) - tens(roll);
  // Auto-failure can override an otherwise passing high target (for example,
  // 96 against 100). Keep the displayed SL's sign consistent with the outcome
  // instead of reporting a positive success level for a fumble.
  if (!success && sl > 0) sl = -sl;

  return {
    label: input.label,
    roll,
    baseTarget,
    effectiveTarget: effective,
    modifier,
    success,
    sl,
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
  const slStr = (r.sl >= 0 ? `+${r.sl}` : `${r.sl}`) + ' SL';
  const targetLine =
    r.modifier === 0
      ? `Roll  ${r.roll}  vs  ${r.baseTarget}`
      : `Roll  ${r.roll}  vs  ${r.effectiveTarget}   (${r.baseTarget} ${r.modifier >= 0 ? '+' : '−'} ${Math.abs(r.modifier)} mod)`;
  return `${targetLine}\n${slStr}`;
}
