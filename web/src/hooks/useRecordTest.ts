import { useRollHistory } from './useRollHistory';
import { useSystemRules } from '@/content/useContent';
import { diceLabel, type RollResult } from '@/utils/roll';
import { Alert } from '@/ui/alertStore';
import type { AttackHistory } from '@/utils/rollHistory';

/** Record existing in-screen tests without changing their gameplay effects. */
export function useRecordTest() {
  const { recordRoll } = useRollHistory();
  const { test } = useSystemRules();
  return (result: RollResult, detail = '', title = result.label ?? 'Test', attack?: AttackHistory) => {
    try {
      const ticket = recordRoll({ title, result, detail, dice: diceLabel(test.dice), ...(attack ? { attack } : {}) });
      void ticket.completion.then(durability => {
        if (!durability.ok) Alert.alert('Roll history not saved', 'The roll was resolved, but could not be added to history.');
      });
    } catch {
      Alert.alert('Roll history not saved', 'The roll was resolved, but could not be added to history.');
    }
  };
}

export function useReportTest() {
  const record = useRecordTest();
  return (result: RollResult, title: string, detail: string) => {
    record(result, detail, title);
    Alert.alert(title, detail);
  };
}
