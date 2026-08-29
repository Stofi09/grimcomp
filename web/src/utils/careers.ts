import type { Career } from '@/content/types';

/** The stable id plus display-name snapshot stored on a character sheet. */
export interface StoredCareerRef {
  careerId?: string;
  career: string;
}

/**
 * Resolve a character's loaded Career by stable id first. The name lookup keeps
 * legacy sheets usable and also provides a fallback while an old/unknown id is
 * present, without making a display-name snapshot authoritative.
 */
export function careerDefForCharacter(
  careers: readonly Career[],
  character: StoredCareerRef,
): Career | undefined {
  const id = character.careerId?.trim();
  if (id) {
    const byId = careers.find(candidate => candidate.id === id);
    if (byId) return byId;
  }

  const name = character.career.trim();
  if (!name) return undefined;
  return careers.find(candidate => candidate.name === name);
}

/** Compact printed-source label shared by Career displays and reference search. */
export function careerSourceLabel(
  career: Pick<Career, 'sourceBook' | 'sourcePage'>,
): string {
  const book = career.sourceBook?.trim();
  const page = career.sourcePage !== undefined ? `p. ${career.sourcePage}` : '';
  return [book, page].filter(Boolean).join(' · ');
}

/** User-facing disclosure for how much rules authority a Career entry carries. */
export function careerRulesStatusLabel(
  career: Pick<Career, 'rulesStatus'>,
): string {
  if (career.rulesStatus === 'bibliographic') {
    return 'Index only — resolve this Career\'s full advance scheme from the source';
  }
  if (career.rulesStatus === 'approximate') {
    return 'Approximate companion summary — verify in source';
  }
  return '';
}

/** Short rules-status disclosure for dense Career metadata. */
export function careerRulesStatusMeta(
  career: Pick<Career, 'rulesStatus'>,
): string {
  if (career.rulesStatus === 'bibliographic') return 'Index only';
  if (career.rulesStatus === 'approximate') return 'Approximate summary';
  return '';
}

/** Full disclosure of when a Career grants access to magic. */
export function careerMagicAccessLabel(
  career: Pick<Career, 'magicAccess'>,
): string {
  if (career.magicAccess === 'none') return 'This Career does not grant magic access.';
  if (career.magicAccess === 'starting') return 'Magic access begins at the first Career rank.';
  if (career.magicAccess === 'later') return 'Magic access begins at a later Career rank.';
  return '';
}

/** Short magic-access disclosure for dense Career metadata. */
export function careerMagicAccessMeta(
  career: Pick<Career, 'magicAccess'>,
): string {
  if (career.magicAccess === 'none') return 'No magic access';
  if (career.magicAccess === 'starting') return 'Starting magic access';
  if (career.magicAccess === 'later') return 'Later magic access';
  return '';
}
