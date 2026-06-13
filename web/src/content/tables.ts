// Rules logic for roll tables. The tables themselves are content (JSON);
// this is the lookup that turns a roll into its effect text, plus the roll
// generator honouring each table's own dice spec (default 1d100).

import type { RollTable } from './types';
import { rollDice } from '@/utils/roll';

/** Roll the table's dice (1d100 unless the table declares otherwise). */
export function rollForTable(table: RollTable | undefined): number {
  return rollDice(table?.dice ?? { count: 1, sides: 100 });
}

/** Resolve a roll against a table — returns the matching row's effect.
    Always returns a non-empty string so alert bodies never render blank. */
export function rollOnTable(table: RollTable | undefined, roll: number): string {
  if (!table) return 'No table available for this result.';
  const row = table.rows.find(r => roll >= r.min && roll <= r.max);
  return row?.effect ?? `No table entry for a roll of ${roll}.`;
}
