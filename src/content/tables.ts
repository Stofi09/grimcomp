// Rules logic for d100 roll tables. The tables themselves are content (JSON);
// this is the lookup that turns a roll into its effect text.

import type { RollTable } from './types';

/** Resolve a d100 roll against a table — returns the matching row's effect. */
export function rollOnTable(table: RollTable | undefined, roll: number): string {
  if (!table) return '';
  const row = table.rows.find(r => roll >= r.min && roll <= r.max);
  return row?.effect ?? '';
}
