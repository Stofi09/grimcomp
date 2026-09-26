import type { Spell } from '@/content/types';

/** Unknown bibliographic values are displayed explicitly, never as a numeric target. */
export function formatSpellCn(spell: Pick<Spell, 'cn'>): string {
  return spell.cn === null ? 'Unknown' : String(spell.cn);
}

/** Compact provenance label shared by Magic and the global reference search. */
export function spellSourceLabel(
  spell: Pick<Spell, 'sourceBook' | 'sourcePage'>,
): string {
  const book = spell.sourceBook?.trim();
  const page = spell.sourcePage !== undefined ? `p. ${spell.sourcePage}` : '';
  return [book, page].filter(Boolean).join(' · ');
}

/** User-facing disclosure for how much rules authority a spell entry carries. */
export function spellRulesStatusLabel(
  spell: Pick<Spell, 'rulesStatus'>,
): string {
  if (spell.rulesStatus === 'bibliographic') return 'Index only — resolve from source';
  if (spell.rulesStatus === 'approximate') return 'Approximate companion summary — verify in source';
  return '';
}

/** Short form used in dense reference metadata; full wording stays in detail. */
export function spellRulesStatusMeta(
  spell: Pick<Spell, 'rulesStatus'>,
): string {
  if (spell.rulesStatus === 'bibliographic') return 'Index only';
  if (spell.rulesStatus === 'approximate') return 'Approximate summary';
  return '';
}
