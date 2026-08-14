export type ExportScope = 'character' | 'roster';

/** Read every Grim Companion key from browser storage. */
export function grimCompanionStorageKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith('gc.')) out.push(key);
    }
  } catch { /* privacy mode — nothing to export */ }
  return out;
}

/** Build the portable payload used by the Settings export actions. */
export function buildSettingsExport(
  scope: ExportScope,
  id: string,
  characterName: string,
  custom: Record<string, unknown>,
): string {
  const keys = grimCompanionStorageKeys();
  const wanted = scope === 'character'
    ? keys.filter(key => key.startsWith(`gc.${id}.`) || key === 'gc.activeCharId')
    : keys;
  const dump: Record<string, unknown> = {
    $schema: 'grimcomp.v1',
    exportedAt: new Date().toISOString(),
    scope,
    character: scope === 'character' ? characterName : undefined,
  };
  for (const key of wanted) {
    const value = window.localStorage.getItem(key);
    if (value == null) continue;
    try { dump[key] = JSON.parse(value); }
    catch { dump[key] = value; }
  }
  // A custom character's definition is roster-wide rather than character-keyed.
  // Include only this character's entry so the export remains self-contained
  // without disclosing the rest of the roster.
  if (scope === 'character' && custom[id]) {
    dump['gc.customChars'] = { [id]: custom[id] };
  }
  // Global stores (notes, filters, reference history, settings, and content
  // packs) deliberately stay out of a single-character export. They cannot be
  // attributed safely to one character; the full-roster export still carries
  // them.
  return JSON.stringify(dump, null, 2);
}
