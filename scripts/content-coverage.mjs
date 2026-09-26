import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENTITY_SECTIONS = [
  'skills', 'talents', 'spells', 'prayers', 'careers', 'races', 'deities',
  'references', 'tables', 'weapons', 'armour', 'trappings',
];
const RULE_SECTIONS = ['conditions', 'criticals', 'criticalTables'];
const STATUSES = ['bibliographic', 'approximate', 'unreviewed'];
const PLACEHOLDER = /\b(?:see source|consult (?:the )?(?:source|book)|placeholder|TBD)\b/i;
const sourceFields = ['description', 'range', 'target', 'duration', 'effect'];

function summarize(entries) {
  const summary = {
    total: entries.length,
    bibliographic: 0,
    approximate: 0,
    unreviewed: 0,
    withSource: 0,
    withPlaceholders: 0,
    unknownCastingNumbers: 0,
  };
  for (const entry of entries) {
    summary[entry.status]++;
    if (entry.sourceBook && Number.isInteger(entry.sourcePage)) summary.withSource++;
    if (entry.placeholderFields.length) summary.withPlaceholders++;
    if (entry.placeholderFields.includes('cn')) summary.unknownCastingNumbers++;
  }
  return summary;
}

function inspectEntry(section, entry, pack) {
  const status = entry.rulesStatus === 'bibliographic'
    ? 'bibliographic'
    : entry.rulesStatus === 'approximate' || entry.approximate === true
      ? 'approximate'
      : 'unreviewed';
  return {
    section,
    id: entry.id,
    name: entry.name,
    packId: pack.id,
    status,
    sourceBook: entry.sourceBook ?? null,
    sourcePage: entry.sourcePage ?? null,
    placeholderFields: [
      ...sourceFields.filter(field => typeof entry[field] === 'string' && PLACEHOLDER.test(entry[field])),
      ...(section === 'spells' && entry.cn === null ? ['cn'] : []),
    ],
  };
}

/** Inventory authored data; it cannot establish fidelity or completeness of a book. */
export function auditContentPacks(packs) {
  const merged = new Map(ENTITY_SECTIONS.map(section => [section, new Map()]));
  const singletons = new Map();
  const deletions = new Map();
  const packIds = new Set();
  const errors = [];
  const overrides = [];
  const inventories = [];

  for (const pack of packs) {
    if (packIds.has(pack.id)) errors.push(`Duplicate pack id: ${pack.id}`);
    packIds.add(pack.id);
    const inventory = { id: pack.id, name: pack.name, version: pack.version, sections: {} };
    for (const section of ENTITY_SECTIONS) {
      if (pack[section] === undefined) continue;
      if (!Array.isArray(pack[section])) {
        errors.push(`${pack.id}.${section} must be an array.`);
        continue;
      }
      const entries = [];
      const seen = new Set();
      for (const entry of pack[section]) {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
          errors.push(`${pack.id}.${section} has an entry without a nonblank id.`);
          continue;
        }
        if (seen.has(entry.id)) errors.push(`${pack.id}.${section} repeats id ${entry.id}.`);
        seen.add(entry.id);
        const row = inspectEntry(section, entry, pack);
        entries.push(row);
        const previous = merged.get(section).get(entry.id);
        if (previous && previous.packId !== pack.id) {
          overrides.push({ section, id: entry.id, from: previous.packId, to: pack.id });
        }
        merged.get(section).set(entry.id, row);
      }
      inventory.sections[section] = summarize(entries);
    }
    for (const section of RULE_SECTIONS) {
      if (Array.isArray(pack[section])) {
        singletons.set(section, { section, packId: pack.id, total: pack[section].length });
      }
    }
    for (const [section, ids] of Object.entries(pack.deletions ?? {})) {
      if (!merged.has(section)) continue;
      if (!Array.isArray(ids)) {
        errors.push(`${pack.id}.deletions.${section} must be an array.`);
        continue;
      }
      const queued = deletions.get(section) ?? new Set();
      ids.forEach(id => queued.add(id));
      deletions.set(section, queued);
    }
    inventories.push(inventory);
  }

  // Match the registry: tombstones apply after all layers, including later additions.
  for (const [section, ids] of deletions) {
    for (const id of ids) merged.get(section).delete(id);
  }
  const entries = [...merged.values()].flatMap(map => [...map.values()]);
  const sections = Object.fromEntries(ENTITY_SECTIONS.map(section => [
    section, summarize([...merged.get(section).values()]),
  ]));
  return {
    $schema: 'grimcomp.coverage.v1',
    sourcebookCompleteness: 'not-verified',
    notes: [
      'Counts measure bundled records, not a complete sourcebook inventory.',
      'Source/page metadata is a citation, not evidence that the rules were verified.',
      'Unreviewed means no explicit rules-status marker; it does not mean complete or accurate.',
      'Approximate and bibliographic labels are read from authored data. Core career fallback enrichment is runtime-only and is not counted as authored text.',
      'Rules totals cover selected array sections only; presence of a table or reference does not establish complete chapter coverage.',
    ],
    packs: inventories,
    sections,
    ruleSections: [...singletons.values()],
    overrides,
    errors,
    entries,
  };
}

export function formatContentCoverage(report) {
  const lines = [
    'Sourcebook completeness: NOT VERIFIED',
    'Bundled records after ID overrides and deletions; not a count of verified book entries.',
    '',
    '| Category | Records | Index only | Approximate | Unreviewed | Source + page | Placeholders |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [section, counts] of Object.entries(report.sections)) {
    lines.push(`| ${section} | ${counts.total} | ${STATUSES.map(s => counts[s]).join(' | ')} | ${counts.withSource} | ${counts.withPlaceholders} |`);
  }
  lines.push('', `Unknown spell casting numbers: ${report.sections.spells.unknownCastingNumbers}`);
  lines.push('', 'Selected rules arrays (last defining pack wins):');
  for (const item of report.ruleSections) lines.push(`- ${item.section}: ${item.total} (${item.packId})`);
  lines.push('', ...report.notes.map(note => `- ${note}`));
  if (report.errors.length) lines.push('', 'Inventory errors:', ...report.errors.map(error => `- ${error}`));
  return `${lines.join('\n')}\n`;
}

export function readBundledPacks(directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const files = Array.isArray(manifest) ? manifest : manifest.packs;
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) {
    throw new Error('The content manifest must contain an array of pack filenames.');
  }
  return files.map(file => JSON.parse(readFileSync(resolve(directory, file), 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--json')) {
    console.error('Usage: node scripts/content-coverage.mjs [--json]');
    process.exitCode = 1;
  } else {
    try {
      const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../web/public/content');
      const report = auditContentPacks(readBundledPacks(directory));
      process.stdout.write(args.includes('--json')
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatContentCoverage(report));
      if (report.errors.length) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
