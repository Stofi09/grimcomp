// WFRP 4e d100 test resolution.
//
// Rules implemented (from the core rulebook):
// - Roll 1d100 against a target.
// - Base SL (Success Levels) = (target tens) − (roll tens). A positive delta
//   on an automatic failure is displayed as negative so it cannot contradict
//   the failure.
// - 01–05 always succeeds; 96–100 always fails (regardless of target). These
//   automatic results are ordinary successes/failures, not criticals: only a
//   double is a critical or fumble (so 99 is both automatic and a fumble).
// - Doubles (11, 22, 33, …, 99): if the roll succeeds → critical success;
//   if it fails → fumble.
// - SL = 0 is a marginal success when the roll succeeds (a tie counts as
//   success because roll ≤ target); a failed 0 SL is written −0.
//
// Skipped intentionally for the prototype:
// - Spell-specific rules (channelling, miscast tables)
// - Group tests, opposed tests, advantage stacks
// - Specialised crit tables (we just label the outcome)

export type Outcome =
  | 'crit-success' // critical success (a passing double)
  | 'success'      // ordinary or automatic success
  | 'fail'         // ordinary or automatic failure
  | 'fumble';      // critical failure (a failing double)

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
  /** Signed SL. Automatic failure never reports a positive value; 0 is possible. */
  sl: number;
  outcome: Outcome;
  /** The roll fell in an automatic band (01–05 or 96–00). Absent on results
      from builds before this flag existed. */
  automatic?: boolean;
}

const AUTO_SUCCESS_MAX = 5;
const AUTO_FAILURE_MIN = 96;

const tens = (n: number) => Math.floor(n / 10);

/** True for d100 doubles (11, 22, … 99). 100 and one-digit rolls are not doubles. */
export const isDouble = (roll: number): boolean =>
  roll >= 11 && roll <= 99 && tens(roll) === roll % 10;

export function resolveTest(input: RollInput): RollResult {
  const baseTarget = input.target;
  const modifier = input.modifier ?? 0;
  const effective = Math.max(0, Math.min(100, baseTarget + modifier));
  const roll = input.forceRoll ?? Math.floor(Math.random() * 100) + 1;

  // Success comes from the automatic bands first, then the plain pass/fail
  // check. A double then upgrades the result to a critical or a fumble; an
  // automatic band on its own never does.
  const autoSuccess = roll <= AUTO_SUCCESS_MAX;
  const autoFailure = !autoSuccess && roll >= AUTO_FAILURE_MIN;
  const success = autoSuccess || (!autoFailure && roll <= effective);
  const outcome: Outcome = isDouble(roll)
    ? (success ? 'crit-success' : 'fumble')
    : (success ? 'success' : 'fail');

  // SL per WFRP 4e core p.151: (target tens − roll tens). Zero can occur on
  // either outcome; the automatic-failure normalization below prevents a
  // positive SL when a high target would otherwise pass (96 against 100).
  let sl = tens(effective) - tens(roll);
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
    automatic: autoSuccess || autoFailure,
  };
}

/** Label for an Outcome value alone. Prefer resultLabel for a resolved test. */
export function outcomeLabel(o: Outcome): string {
  switch (o) {
    case 'crit-success': return 'CRITICAL SUCCESS';
    case 'success': return 'SUCCESS';
    case 'fail': return 'FAILURE';
    case 'fumble': return 'FUMBLE';
  }
}

/**
 * Header label for a resolved test. Automatic results say so. Results from
 * builds before the `automatic` flag labelled the 01–05/96–00 bands as
 * critical/fumble; those are recognised by a non-double roll.
 */
export function resultLabel(r: Pick<RollResult, 'outcome' | 'roll' | 'automatic'>): string {
  const legacyAutomatic = (r.outcome === 'crit-success' || r.outcome === 'fumble')
    && r.automatic === undefined && !isDouble(r.roll);
  if (legacyAutomatic) return r.outcome === 'crit-success' ? 'AUTOMATIC SUCCESS' : 'AUTOMATIC FAILURE';
  if (r.automatic && r.outcome === 'success') return 'AUTOMATIC SUCCESS';
  if (r.automatic && r.outcome === 'fail') return 'AUTOMATIC FAILURE';
  return outcomeLabel(r.outcome);
}

/** Signed SL text. A failed test with 0 SL is written −0, as in WFRP. */
export function slText(r: Pick<RollResult, 'sl' | 'success'>): string {
  if (r.sl === 0) return r.success ? '+0' : '−0';
  return r.sl > 0 ? `+${r.sl}` : `${r.sl}`;
}

/** Multi-line, tabular-ish body for an Alert. */
export function formatTestResult(r: RollResult): string {
  const targetLine =
    r.modifier === 0
      ? `Roll  ${r.roll}  vs  ${r.baseTarget}`
      : `Roll  ${r.roll}  vs  ${r.effectiveTarget}   (${r.baseTarget} ${r.modifier >= 0 ? '+' : '−'} ${Math.abs(r.modifier)} mod)`;
  return `${targetLine}\n${slText(r)} SL`;
}
