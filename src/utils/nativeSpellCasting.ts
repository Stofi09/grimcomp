import type { Spell } from '../content/types';

export function nativeSpellSourceLabel(spell: Spell): string {
  return [spell.sourceBook, spell.sourcePage !== undefined ? `p. ${spell.sourcePage}` : '']
    .filter(Boolean).join(' · ') || 'Source not recorded';
}

/** Guard the whole attempt so an unknown CN cannot roll dice, spend a pool,
 * trigger a miscast, or update UI/storage state. Numeric CNs, including 99,
 * remain valid authored values. */
export function runNativeSpellCast<T>(
  spell: Spell,
  execute: (castingNumber: number) => T,
  reportUnknown: (message: string) => void,
): T | undefined {
  if (spell.cn === null) {
    reportUnknown(`The Casting Number for ${spell.name} is unknown. Consult ${nativeSpellSourceLabel(spell)} and supply the verified value before casting.`);
    return;
  }
  return execute(spell.cn);
}
