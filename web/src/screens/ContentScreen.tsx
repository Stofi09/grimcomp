// In-app content editor. Browse any id-keyed content section (careers, talents,
// spells, …) and create / edit / delete / restore entries. Edits persist on this
// device as an overlay pack (useContentEdits) that the registry merges last, so
// changes apply live to every screen. Deletes are tombstones (reversible).

import { useMemo, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { Table, TableRow, Cell } from '@/components/Table';
import { Alert } from '@/ui/alert';
import { useContent } from '@/content/useContent';
import { useContentEdits } from '@/content/useContentEdits';
import { validatePack } from '@/content/validate';
import { CONTENT_SCHEMA, type EditableSection } from '@/content/types';
import { SECTION_META } from '@/content/editable';
import { colors } from '@/theme';
import './ContentScreen.css';

interface Entry { id: string; name?: string }

type SheetState = { mode: 'new' | 'edit'; id: string; text: string };

export const ContentScreen: React.FC = () => {
  const reg = useContent();
  const { pack: edits, upsertEntry, deleteEntry, revertEntry } = useContentEdits();
  const [sectionKey, setSectionKey] = useState<EditableSection>('careers');
  const [sheet, setSheet] = useState<SheetState | null>(null);

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

  const customIds = useMemo(
    () => new Set(((edits[sectionKey] as Entry[] | undefined) ?? []).map(e => e.id)),
    [edits, sectionKey],
  );
  const deletedIds = (edits.deletions?.[sectionKey] ?? []);

  const openNew = () => setSheet({ mode: 'new', id: '', text: JSON.stringify(meta.template, null, 2) });
  const openEdit = (entry: Entry) => setSheet({ mode: 'edit', id: entry.id, text: JSON.stringify(entry, null, 2) });

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
    upsertEntry(sectionKey, parsed as Entry);
    // A changed id on an edit is a rename: drop the entry under the old id so it
    // doesn't linger as a duplicate (tombstones a core original; clears a custom one).
    if (sheet.mode === 'edit' && newId !== sheet.id) deleteEntry(sectionKey, sheet.id);
    setSheet(null);
  };

  const confirmDelete = (entry: Entry) => {
    Alert.alert(
      'Delete entry',
      `Delete "${entry.name ?? entry.id}"? It is hidden until you restore it — your other data is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteEntry(sectionKey, entry.id) },
      ],
    );
  };

  const confirmRevert = (entry: Entry) => {
    Alert.alert(
      'Discard your changes',
      `Discard your edits to "${entry.name ?? entry.id}"? If it overrides a built-in entry the original returns; a brand-new entry is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => revertEntry(sectionKey, entry.id) },
      ],
    );
  };

  const sheetIsCustom = sheet ? customIds.has(sheet.id) : false;

  return (
    <ScreenContainer>
      <Hero
        title="Content"
        subRow={<span className="cnt-sub">Create, edit, and delete rulebook content. Saved on this device and applied live across the app.</span>}
        actions={
          <Button iconLeft={<Icon name="plus" size={13} color={colors.ink} />} onPress={openNew}>
            New {meta.singular}
          </Button>
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
          {entries.map((e, i) => (
            <TableRow key={e.id} last={i === entries.length - 1 && deletedIds.length === 0}>
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{e.name ?? e.id}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{e.id}</Cell>
              <Cell flex={1}>
                <Pill variant={customIds.has(e.id) ? 'brass' : 'ghost'} size={10}>
                  {customIds.has(e.id) ? 'Custom' : 'Core'}
                </Pill>
              </Cell>
              <Cell flex={1.4} align="right">
                <div className="cnt-row-actions">
                  <Button variant="ghost" onPress={() => openEdit(e)}>Edit</Button>
                  {customIds.has(e.id)
                    ? <Button variant="ghost" onPress={() => confirmRevert(e)}>Revert</Button>
                    : <Button variant="ghost" onPress={() => confirmDelete(e)}>Delete</Button>}
                </div>
              </Cell>
            </TableRow>
          ))}
          {deletedIds.map((id, i) => (
            <TableRow key={`del-${id}`} last={i === deletedIds.length - 1}>
              <Cell flex={2} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>{id}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>deleted</Cell>
              <Cell flex={1}><Pill variant="warn" size={10}>Deleted</Pill></Cell>
              <Cell flex={1.4} align="right">
                <div className="cnt-row-actions">
                  <Button variant="ghost" onPress={() => revertEntry(sectionKey, id)}>Restore</Button>
                </div>
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>

      <EditSheet
        visible={!!sheet}
        title={sheet?.mode === 'new' ? `New ${meta.singular}` : `Edit ${sheet?.id ?? ''}`}
        subtitle={`${meta.label} · raw JSON`}
        onClose={() => setSheet(null)}
        onSave={save}
        saveLabel="Save"
        destructive={sheet && sheet.mode === 'edit'
          ? {
              label: sheetIsCustom ? 'Revert to core' : 'Delete',
              onPress: () => {
                if (!sheet) return;
                if (sheetIsCustom) revertEntry(sectionKey, sheet.id);
                else deleteEntry(sectionKey, sheet.id);
                setSheet(null);
              },
            }
          : undefined}
      >
        {sheet ? (
          <textarea
            className="cnt-editor"
            value={sheet.text}
            onChange={(e) => setSheet(s => (s ? { ...s, text: e.target.value } : s))}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};
