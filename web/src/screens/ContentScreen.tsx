// In-app content editor. Browse any id-keyed content section (careers, talents,
// spells, …) and create / edit / delete / restore entries. Edits persist on this
// device as an overlay pack (useContentEdits) that the registry merges last, so
// changes apply live to every screen. Deletes are tombstones (reversible).

import { useMemo, useRef, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { Table, TableRow, Cell } from '@/components/Table';
import { Alert } from '@/ui/alertStore';
import { useContent } from '@/content/useContent';
import { useContentEdits } from '@/content/useContentEdits';
import { validatePack } from '@/content/validate';
import { CONTENT_SCHEMA, EDITABLE_SECTIONS, USER_EDITS_PACK_ID, type EditableSection } from '@/content/types';
import { SECTION_META } from '@/content/editable';
import { talentDefForName } from '@/utils/talents';
import { colors } from '@/theme';
import './ContentScreen.css';

interface Entry { id: string; name?: string; sourceBook?: string }

type SheetState = { mode: 'new' | 'edit'; id: string; text: string };

/** Non-fatal dangling-reference checks for the sections that point at other
    content (careers → races + skill names; races → skill/talent ids). Returns a
    list of human-readable warnings; empty means everything resolves. */
function refWarnings(section: EditableSection, entry: Record<string, unknown>, reg: ReturnType<typeof useContent>): string[] {
  const w: string[] = [];
  if (section === 'careers') {
    const raceIds = new Set(reg.allRaces.map(r => r.id));
    for (const sp of (entry.species as unknown[] | undefined) ?? []) {
      if (typeof sp === 'string' && !raceIds.has(sp)) w.push(`• species "${sp}" — no race with that id`);
    }
    const skillNames = new Set(reg.allSkillDefs.map(s => s.name));
    const resolvesSkill = (name: string) =>
      skillNames.has(name) || [...skillNames].some(base => name.startsWith(`${base} (`));
    const scheme = entry.advanceScheme as { skills?: unknown[]; talents?: unknown[] } | undefined;
    for (const skill of scheme?.skills ?? []) {
      if (typeof skill === 'string' && !resolvesSkill(skill)) {
        w.push(`• career skill "${skill}" — no matching skill definition`);
      }
    }
    for (const rk of (entry.ranks as Array<{ requirements?: Array<{ skill?: unknown }> }> | undefined) ?? []) {
      for (const req of rk?.requirements ?? []) {
        if (typeof req?.skill === 'string' && !resolvesSkill(req.skill)) {
          w.push(`• requirement skill "${req.skill}" — no matching skill definition`);
        }
      }
    }
    for (const talent of scheme?.talents ?? []) {
      if (typeof talent === 'string' && !talentDefForName(reg.allTalentDefs, talent)) {
        w.push(`• career talent "${talent}" — no talent with that name`);
      }
    }
  } else if (section === 'races') {
    const skillIds = new Set(reg.allSkillDefs.map(s => s.id));
    const talentIds = new Set(reg.allTalentDefs.map(t => t.id));
    for (const s of (entry.skills as unknown[] | undefined) ?? []) {
      if (typeof s === 'string' && !skillIds.has(s)) w.push(`• skill "${s}" — no skill with that id`);
    }
    for (const t of (entry.talents as unknown[] | undefined) ?? []) {
      if (typeof t === 'string' && !talentIds.has(t)) w.push(`• talent "${t}" — no talent with that id`);
    }
  }
  return w;
}

export const ContentScreen: React.FC = () => {
  const reg = useContent();
  const { pack: edits, upsertEntry, renameEntry, deleteEntry, revertEntry } = useContentEdits();
  const [sectionKey, setSectionKey] = useState<EditableSection>('careers');
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [shareText, setShareText] = useState<string | null>(null);
  const contentActionRef = useRef(false);
  const [contentAction, setContentAction] = useState<'save' | 'remove' | null>(null);

  const meta = SECTION_META.find(m => m.key === sectionKey) ?? SECTION_META[0];

  const lists: Record<EditableSection, Entry[]> = {
    careers: reg.allCareers,
    talents: reg.allTalentDefs,
    skills: reg.allSkillDefs,
    spells: reg.allSpells,
    prayers: reg.allPrayers,
    races: reg.allRaces,
    deities: reg.allDeities,
    weapons: reg.allWeapons,
    armour: reg.allArmour,
    trappings: reg.allTrappings,
  };
  const entries = lists[sectionKey];

  // Remember id → name as you browse, so the Deleted list can show friendly
  // names for tombstoned entries (which are gone from the registry).
  const nameCache = useRef<Record<string, string>>({});
  for (const e of entries) if (e.name) nameCache.current[e.id] = e.name;

  const customIds = useMemo(
    () => new Set(((edits[sectionKey] as Entry[] | undefined) ?? []).map(e => e.id)),
    [edits, sectionKey],
  );
  const deletedIds = (edits.deletions?.[sectionKey] ?? []);

  const openNew = () => setSheet({ mode: 'new', id: '', text: JSON.stringify(meta.template, null, 2) });
  const openEdit = (entry: Entry) => setSheet({ mode: 'edit', id: entry.id, text: JSON.stringify(entry, null, 2) });

  const commit = async (parsed: Entry, newId: string) => {
    if (!sheet || contentActionRef.current) return;
    const edit = sheet;
    contentActionRef.current = true;
    setContentAction('save');
    const durability = await (async () => {
      try {
        // A changed id on an edit is a rename. Both the new entry and old-id
        // tombstone belong to one storage update so neither can commit alone.
        const ticket = edit.mode === 'edit' && newId !== edit.id
          ? renameEntry(sectionKey, edit.id, parsed)
          : upsertEntry(sectionKey, parsed);
        return await ticket.completion;
      } finally {
        contentActionRef.current = false;
        setContentAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not save entry', durability.error.message);
      return;
    }
    setSheet(null);
  };

  const removeEntry = async (
    section: EditableSection,
    id: string,
    mode: 'delete' | 'revert',
    closeSheet = false,
  ) => {
    if (contentActionRef.current) return;
    contentActionRef.current = true;
    setContentAction('remove');
    const durability = await (async () => {
      try {
        const ticket = mode === 'delete' ? deleteEntry(section, id) : revertEntry(section, id);
        return await ticket.completion;
      } finally {
        contentActionRef.current = false;
        setContentAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert(
        mode === 'delete' ? 'Could not delete entry' : 'Could not restore entry',
        durability.error.message,
      );
      return;
    }
    if (closeSheet) setSheet(null);
  };

  const save = () => {
    if (!sheet) return;
    let parsed: unknown;
    try { parsed = JSON.parse(sheet.text); }
    catch (e) { Alert.alert('Invalid JSON', e instanceof Error ? e.message : 'Could not parse JSON.'); return; }
    const rawId = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof (parsed as { id?: unknown }).id === 'string' ? (parsed as { id: string }).id.trim() : '';
    if (!rawId) {
      Alert.alert('Missing id', 'Each entry needs a unique, non-blank string "id".');
      return;
    }
    (parsed as { id: string }).id = rawId; // normalise away stray whitespace
    const newId = rawId;
    // Guard id collisions: creating — or renaming an edit to — an id that already
    // exists would silently clobber another entry. (Editing in place, same id, is
    // fine: that's an intended override of the entry you opened.)
    if (newId !== sheet.id && entries.some(e => e.id === newId)) {
      Alert.alert(
        'ID already in use',
        `An entry with id "${newId}" already exists in ${meta.label}. Pick a different id, or edit that entry directly.`,
      );
      return;
    }
    // Validate the single entry by running it through the full pack validator.
    const probe = { $schema: CONTENT_SCHEMA, id: 'probe', name: 'probe', version: '1', [sectionKey]: [parsed] };
    const { errors } = validatePack(probe);
    if (errors.length > 0) { Alert.alert('Invalid entry', errors.join('\n').slice(0, 800)); return; }
    // Non-fatal: warn on dangling references (a career citing a missing race, a
    // race granting an unknown skill) but let the author save anyway — the target
    // may be added next.
    const warns = refWarnings(sectionKey, parsed as Record<string, unknown>, reg);
    if (warns.length > 0) {
      Alert.alert(
        'Unresolved references',
        `This entry points at content that doesn't exist:\n\n${warns.join('\n')}\n\nSave anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => { void commit(parsed as Entry, newId); } },
        ],
      );
      return;
    }
    void commit(parsed as Entry, newId);
  };

  const confirmDelete = (entry: Entry) => {
    Alert.alert(
      'Delete entry',
      `Delete "${entry.name ?? entry.id}"? It is hidden until you restore it — your other data is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void removeEntry(sectionKey, entry.id, 'delete'); },
        },
      ],
    );
  };

  const confirmRevert = (entry: Entry) => {
    Alert.alert(
      'Discard your changes',
      `Discard your edits to "${entry.name ?? entry.id}"? If it overrides a built-in entry the original returns; a brand-new entry is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => { void removeEntry(sectionKey, entry.id, 'revert'); },
        },
      ],
    );
  };

  // --- Share edits as a content pack ----------------------------------------
  // Everything created/edited here already lives in one overlay ContentPack, so
  // sharing is: rebrand a copy (stable id + friendly name), validate, download.
  // A friend imports the file in Settings → Content packs; same-id re-imports
  // replace the older version instead of stacking.

  const openShare = () => {
    const raw = edits as unknown as Record<string, unknown>;
    const hasEdits = EDITABLE_SECTIONS.some(k => Array.isArray(raw[k]) && (raw[k] as unknown[]).length > 0)
      || Object.keys(edits.deletions ?? {}).length > 0;
    if (!hasEdits) {
      Alert.alert('Nothing to share yet', 'Create or edit some content first — then export it here as a pack for your group.');
      return;
    }
    setShareText(JSON.stringify({ ...edits, id: 'pack.my-edits', name: 'My edits', version: '1' }, null, 2));
  };

  const downloadShare = () => {
    if (shareText == null) return;
    let raw: unknown;
    try { raw = JSON.parse(shareText); }
    catch (e) { Alert.alert('Invalid JSON', e instanceof Error ? e.message : 'Could not parse JSON.'); return; }
    const { pack, errors } = validatePack(raw);
    if (errors.length > 0 || !pack) {
      Alert.alert('Invalid content pack', errors.join('\n').slice(0, 800) || 'Unknown validation error.');
      return;
    }
    if (pack.id === USER_EDITS_PACK_ID) {
      Alert.alert('Pick a different id', `"${USER_EDITS_PACK_ID}" is reserved for this device's live edits. Give the pack its own id, e.g. "pack.my-edits".`);
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pack.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
      return;
    }
    setShareText(null);
    Alert.alert(
      'Pack downloaded',
      `Send ${pack.id}.json to your group — they import it in Settings → Content packs. Keep the same id when you re-export so imports replace the old version.`,
    );
  };

  const sheetIsCustom = sheet ? customIds.has(sheet.id) : false;
  // Title reflects the id currently in the editor (so a mid-rename shows the new
  // id), falling back to the original when the JSON is incomplete.
  const sheetEditId = (() => {
    if (!sheet || sheet.mode === 'new') return '';
    try {
      const p = JSON.parse(sheet.text);
      if (p && typeof p.id === 'string' && p.id.trim()) return p.id.trim();
    } catch { /* incomplete JSON — fall back to the original id */ }
    return sheet.id;
  })();

  return (
    <ScreenContainer>
      <Hero
        title="Content"
        subRow={<span className="cnt-sub">Create, edit, and delete rulebook content. Saved on this device and applied live across the app.</span>}
        actions={
          <>
            <Button variant="ghost" iconLeft={<Icon name="pack" size={13} color={colors.ink} />} onPress={openShare}>
              Share edits
            </Button>
            <Button iconLeft={<Icon name="plus" size={13} color={colors.ink} />} onPress={openNew}>
              New {meta.singular}
            </Button>
          </>
        }
      />

      <Section title="Section" />
      <div className="cnt-chips">
        {SECTION_META.map(m => (
          <button
            key={m.key}
            type="button"
            className={m.key === sectionKey ? 'btn-reset cnt-chip cnt-chip--on' : 'btn-reset cnt-chip'}
            onClick={() => setSectionKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Section title={`${meta.label} (${entries.length})`} aside={customIds.size > 0 ? `${customIds.size} custom` : undefined} />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={2}>ID</Cell>
            <Cell header flex={1}>Source</Cell>
            <Cell header flex={1.4} align="right"> </Cell>
          </TableRow>
          {entries.map((e, i) => {
            const isCustom = customIds.has(e.id);
            const source = isCustom
              ? 'Custom'
              : e.sourceBook?.trim()
                ? e.sourceBook.trim()
                : 'Bundled';
            return (
              <TableRow key={e.id} last={i === entries.length - 1 && deletedIds.length === 0}>
                <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{e.name ?? e.id}</Cell>
                <Cell flex={2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{e.id}</Cell>
                <Cell flex={1}>
                  <Pill variant={isCustom ? 'brass' : 'ghost'} size={10}>{source}</Pill>
                </Cell>
                <Cell flex={1.4} align="right">
                  <div className="cnt-row-actions">
                    <Button variant="ghost" onPress={() => openEdit(e)}>Edit</Button>
                    {isCustom
                      ? <Button variant="ghost" onPress={() => confirmRevert(e)}>Revert</Button>
                      : <Button variant="ghost" onPress={() => confirmDelete(e)}>Delete</Button>}
                  </div>
                </Cell>
              </TableRow>
            );
          })}
          {deletedIds.map((id, i) => (
            <TableRow key={`del-${id}`} last={i === deletedIds.length - 1}>
              <Cell flex={2} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>{nameCache.current[id] ?? id}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{id}</Cell>
              <Cell flex={1}><Pill variant="warn" size={10}>Deleted</Pill></Cell>
              <Cell flex={1.4} align="right">
                <div className="cnt-row-actions">
                  <Button variant="ghost" onPress={() => { void removeEntry(sectionKey, id, 'revert'); }}>Restore</Button>
                </div>
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>

      <EditSheet
        visible={!!sheet}
        title={sheet?.mode === 'new' ? `New ${meta.singular}` : `Edit ${sheetEditId}`}
        subtitle={`${meta.label} · raw JSON`}
        onClose={() => { if (!contentActionRef.current) setSheet(null); }}
        onSave={save}
        saveLabel={contentAction === 'remove' ? 'Removing…' : contentAction === 'save' ? 'Saving…' : 'Save'}
        saveDisabled={contentAction !== null}
        destructive={sheet && sheet.mode === 'edit' && contentAction === null
          ? {
              label: sheetIsCustom ? 'Revert to core' : 'Delete',
              onPress: () => {
                if (!sheet) return;
                void removeEntry(
                  sectionKey,
                  sheet.id,
                  sheetIsCustom ? 'revert' : 'delete',
                  true,
                );
              },
            }
          : undefined}
      >
        {sheet ? (
          <>
            {meta.editorHint ? <p className="cnt-editor-hint">{meta.editorHint}</p> : null}
            <textarea
              className="cnt-editor"
              aria-label={`${sheet.mode === 'new' ? 'New' : 'Edit'} ${meta.singular} JSON`}
              value={sheet.text}
              onChange={(e) => setSheet(s => (s ? { ...s, text: e.target.value } : s))}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </>
        ) : null}
      </EditSheet>

      <EditSheet
        visible={shareText != null}
        title="Share your edits"
        subtitle="Content pack · raw JSON — set a stable id and name, then download"
        onClose={() => setShareText(null)}
        onSave={downloadShare}
        saveLabel="Download"
      >
        {shareText != null ? (
          <textarea
            className="cnt-editor"
            aria-label="Shared content pack JSON"
            value={shareText}
            onChange={(e) => setShareText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};
