// Per-character XP economy.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useXpRule } from './useSettings';
import { useContent } from '@/content/useContent';
import { type XpKind, type Character } from '@/data/character';

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

const seedFor = (tpl: Character | null, seedLog: XpEntry[]): State => ({
  current: tpl?.xpCurrent ?? 0,
  spent: tpl?.xpSpent ?? 0,
  log: [...seedLog],
});

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

export interface XpResult {
  ok: boolean;
  message: string;
}

export function useXp() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const registry = useContent();
  const tpl = get(id);
  // The per-character log seed comes from the content registry (the
  // core-characters pack), not from code.
  const seedLog: XpEntry[] = registry.xpLogSeeds?.[id] ?? [];
  const [state, setState] = useStoredState<State>(characterKey(id, 'xp'), seedFor(tpl, seedLog));
  const [xpRule] = useXpRule();

  const spend = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Cost must be positive.' };
    let result: XpResult = { ok: false, message: '' };
    setState(prev => {
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
    return result;
  }, [setState, xpRule]);

  const gain = useCallback((amount: number, reason: string, kind: XpKind = 'gain'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    setState(prev => {
      const entry: XpEntry = { date: today(), reason, amount: +amount, kind };
      return { current: prev.current + amount, spent: prev.spent, log: [entry, ...prev.log] };
    });
    return { ok: true, message: `Gained ${amount} XP — ${reason}.` };
  }, [setState]);

  const refund = useCallback((amount: number, reason: string, kind: XpKind = 'skill'): XpResult => {
    if (amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    let result: XpResult = { ok: false, message: '' };
    setState(prev => {
      const idx = prev.log.findIndex(e => e.kind === kind && e.amount === -amount && e.reason === reason);
      // Only credit XP back when there is a real matching purchase to reverse.
      // Without this guard, stepping an advance below its template-granted level
      // (which was never bought, so has no log entry) would mint free XP.
      if (idx < 0) {
        result = { ok: false, message: 'No matching purchase to refund.' };
        return prev;
      }
      const log = [...prev.log.slice(0, idx), ...prev.log.slice(idx + 1)];
      result = { ok: true, message: `Refunded ${amount} XP.` };
      return { current: prev.current + amount, spent: Math.max(0, prev.spent - amount), log };
    });
    return result;
  }, [setState]);

  return { ...state, total: state.current + state.spent, spend, gain, refund };
}
