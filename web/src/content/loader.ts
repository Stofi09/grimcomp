// Fetches the bundled core content packs at runtime. The manifest lists pack
// filenames; each is fetched, parsed, and validated. A network/parse/validation
// failure for one file is collected as an error and skipped — the rest still
// load, so a single bad pack never blanks the whole app.

import { MANIFEST_SCHEMA, type ContentPack } from './types';
import { validatePack } from './validate';

const base = (): string => import.meta.env.BASE_URL ?? '/';

/** Extract the ordered pack filename list from a parsed manifest value. */
function readManifestFiles(raw: unknown): string[] | null {
  // Tolerate a bare array of filenames.
  if (Array.isArray(raw)) {
    return raw.every(f => typeof f === 'string') ? (raw as string[]) : null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.$schema !== MANIFEST_SCHEMA) return null;
  if (!Array.isArray(obj.packs) || !obj.packs.every(f => typeof f === 'string')) return null;
  return obj.packs as string[];
}

export async function loadBundledPacks(): Promise<{ packs: ContentPack[]; errors: string[] }> {
  const errors: string[] = [];
  const packs: ContentPack[] = [];

  let files: string[];
  try {
    const res = await fetch(`${base()}content/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifestRaw: unknown = await res.json();
    const list = readManifestFiles(manifestRaw);
    if (!list) {
      errors.push('manifest.json: invalid manifest (expected $schema and a string[] "packs").');
      return { packs, errors };
    }
    files = list;
  } catch (err) {
    errors.push(`manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    return { packs, errors };
  }

  // Fetch every pack at once (one round trip instead of one per pack) but
  // keep manifest order in the result — registry folding is order-sensitive.
  const results = await Promise.all(files.map(async (file): Promise<{ pack?: ContentPack; error?: string }> => {
    try {
      const res = await fetch(`${base()}content/${file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw: unknown = await res.json();
      const { pack, errors: packErrors, warnings } = validatePack(raw);
      // Non-fatal warnings (e.g. a typo'd enabledWhen var that silently hides a
      // screen) aren't surfaced in the UI for bundled packs, so log them — these
      // are the project's own packs, caught at dev time.
      for (const w of warnings) console.warn(`[content] ${file}: ${w}`);
      return pack ? { pack } : { error: `${file}: ${packErrors.join('; ')}` };
    } catch (err) {
      return { error: `${file}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }));
  for (const result of results) {
    if (result.pack) packs.push(result.pack);
    if (result.error) errors.push(result.error);
  }

  return { packs, errors };
}
