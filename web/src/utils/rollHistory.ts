import type { RollResult } from './roll';

export const ROLL_HISTORY_LIMIT = 100;

export interface AttackHistory {
  landed: boolean;
  damage?: number;
  defender?: { target: number; roll: number; sl: number };
}

export interface RollHistoryEntry {
  id: string;
  at: number;
  title: string;
  dice: string;
  result: RollResult;
  detail: string;
  attack?: AttackHistory;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

export function isRollHistoryEntry(value: unknown): value is RollHistoryEntry {
  if (!record(value) || !record(value.result)) return false;
  const r = value.result;
  if (value.attack !== undefined) {
    const attack = value.attack;
    if (!record(attack) || typeof attack.landed !== 'boolean') return false;
    if (attack.damage !== undefined && (typeof attack.damage !== 'number' || !Number.isFinite(attack.damage) || attack.damage < 0)) return false;
    const defender = attack.defender;
    if (defender !== undefined && (!record(defender) || !['target', 'roll', 'sl'].every(key =>
      typeof defender[key] === 'number' && Number.isFinite(defender[key])))) return false;
  }
  return boundedText(value.id, 100) && value.id.length > 0
    && typeof value.at === 'number' && Number.isSafeInteger(value.at) && value.at >= 0 && value.at <= 8.64e15
    && boundedText(value.title, 240) && boundedText(value.dice, 40) && boundedText(value.detail, 6000)
    && (r.label === undefined || boundedText(r.label, 240))
    && ['roll', 'baseTarget', 'effectiveTarget', 'modifier', 'sl'].every(key =>
      typeof r[key] === 'number' && Number.isFinite(r[key]))
    && typeof r.success === 'boolean' && typeof r.hasSl === 'boolean'
    && ['success', 'crit-success', 'fail', 'fumble'].includes(String(r.outcome));
}

/** Bound imported or older local data before any screen consumes it. */
export function readRollHistory(value: unknown): RollHistoryEntry[] {
  return Array.isArray(value) ? value.filter(isRollHistoryEntry).slice(0, ROLL_HISTORY_LIMIT) : [];
}
