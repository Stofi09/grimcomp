// Per-character XP economy.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useXpRule } from './useSettings';
import { XP_LOG_SEED, type XpKind, type Character } from '@/data/character';
import type { NativeDurabilityResult } from '@/storage/nativeStore';

export interface XpEntry {
  date: string;
  reason: string;
  amount: number;
  kind: XpKind;
}

interface State {
  current: number;
  spent: number;
  log: XpEntry[];
}

const seedFor = (id: string, tpl: Character | null): State => ({
  current: tpl?.xpCurrent ?? 0,
  spent: tpl?.xpSpent ?? 0,
  log: [...(XP_LOG_SEED[id] ?? [])],
});

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

export interface XpResult {
  ok: boolean;
  message: string;
  /** Present when the request reached the durable storage transaction. */
  completion?: Promise<NativeDurabilityResult>;
}

export function useXp() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const [state, setState] = useStoredState<State>(characterKey(id, 'xp'), seedFor(id, tpl));
  const [xpRule] = useXpRule();

  const spend = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Cost must be positive.' };
    let result: XpResult = { ok: false, message: '' };
    const completion = setState(prev => {
      // Strict mode (default): refuse overdraft. Flexible mode: allow it,
      // taking spendable into the negative — the alert tells the user that
      // they're now in debt with the GM.
      if (prev.current < amount && xpRule === 'strict') {
        result = { ok: false, message: `Need ${amount} XP, you only have ${prev.current}.` };
        return prev;
      }
      const entry: XpEntry = { date: today(), reason, amount: -amount, kind };
      const remaining = prev.current - amount;
      result = {
        ok: true,
        message:
          remaining < 0
            ? `Spent ${amount} XP on "${reason}". Now ${remaining} XP (overspent — GM trust mode).`
            : `Spent ${amount} XP on "${reason}". ${remaining} XP remaining.`,
      };
      return { current: remaining, spent: prev.spent + amount, log: [entry, ...prev.log] };
    });
    return { ...result, completion };
  }, [setState, xpRule]);

  const gain = useCallback((amount: number, reason: string, kind: XpKind = 'gain'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    const completion = setState(prev => {
      const entry: XpEntry = { date: today(), reason, amount: +amount, kind };
      return { current: prev.current + amount, spent: prev.spent, log: [entry, ...prev.log] };
    });
    return { ok: true, message: `Gained ${amount} XP — ${reason}.`, completion };
  }, [setState]);

  const refund = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    let result: XpResult = { ok: false, message: '' };
    const completion = setState(prev => {
      const idx = prev.log.findIndex(e => e.kind === kind && e.amount === -amount && e.reason === reason);
      // A template-granted advance has no matching XP-log purchase. Refusing
      // that reversal prevents the refund control from minting XP or selling a
      // rank that the character never bought.
      if (idx < 0) {
        result = { ok: false, message: 'No matching purchase to refund.' };
        return prev;
      }
      const log = [...prev.log.slice(0, idx), ...prev.log.slice(idx + 1)];
      result = { ok: true, message: `Refunded ${amount} XP.` };
      return { current: prev.current + amount, spent: Math.max(0, prev.spent - amount), log };
    });
    return { ...result, completion };
  }, [setState]);

  return { ...state, total: state.current + state.spent, spend, gain, refund };
}
