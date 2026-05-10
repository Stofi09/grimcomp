// Single source of truth for the XP economy. Every "Buy" path in the app
// goes through `spend()` so the spendable / spent totals + the log update
// once and propagate to every screen that displays them (Overview vitals,
// rail vitals card, XP screen counters & log table).

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { CHARACTER, XP_LOG, type XpKind } from '@/data/character';

export interface XpEntry {
  date: string;            // ISO yyyy.mm.dd to match the seed style
  reason: string;
  amount: number;          // negative = spend, positive = gain
  kind: XpKind;
}

interface State {
  current: number;         // spendable
  spent: number;           // lifetime total spent
  log: XpEntry[];          // newest first
}

const KEY = 'gc.xp';

const seed: State = {
  current: CHARACTER.xpCurrent,
  spent: CHARACTER.xpSpent,
  log: [...XP_LOG],
};

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

/** Wraps the user-visible alert message after a spend/gain. */
export interface XpResult {
  ok: boolean;
  message: string;
}

export function useXp() {
  const [state, setState] = useStoredState<State>(KEY, seed);

  /** Deducts `amount` from spendable. Fails (returns ok:false) if insufficient. */
  const spend = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Cost must be positive.' };
    let result: XpResult = { ok: false, message: '' };
    setState(prev => {
      if (prev.current < amount) {
        result = {
          ok: false,
          message: `Need ${amount} XP, you only have ${prev.current}.`,
        };
        return prev;
      }
      const entry: XpEntry = { date: today(), reason, amount: -amount, kind };
      result = {
        ok: true,
        message: `Spent ${amount} XP on “${reason}”. ${prev.current - amount} XP remaining.`,
      };
      return {
        current: prev.current - amount,
        spent: prev.spent + amount,
        log: [entry, ...prev.log],
      };
    });
    return result;
  }, [setState]);

  /** Adds `amount` to spendable. Used for session rewards or refunds. */
  const gain = useCallback((amount: number, reason: string, kind: XpKind = 'gain'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    setState(prev => {
      const entry: XpEntry = { date: today(), reason, amount: +amount, kind };
      return {
        current: prev.current + amount,
        spent: prev.spent,
        log: [entry, ...prev.log],
      };
    });
    return { ok: true, message: `Gained ${amount} XP — ${reason}.` };
  }, [setState]);

  /**
   * Refund a previously-spent amount. Decrements `spent` (does NOT add a "gain"
   * row — instead removes the most recent matching spend, since this is meant
   * for "I tapped − after tapping +" undos.
   */
  const refund = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    setState(prev => {
      // Remove the most recent matching spend entry if present, otherwise just
      // adjust the totals. Either way, don't double-account.
      const idx = prev.log.findIndex(e => e.kind === kind && e.amount === -amount && e.reason === reason);
      const log = idx >= 0 ? [...prev.log.slice(0, idx), ...prev.log.slice(idx + 1)] : prev.log;
      return {
        current: prev.current + amount,
        spent: Math.max(0, prev.spent - amount),
        log,
      };
    });
    return { ok: true, message: `Refunded ${amount} XP.` };
  }, [setState]);

  const total = state.current + state.spent;

  return { ...state, total, spend, gain, refund };
}
