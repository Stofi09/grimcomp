import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useStoredState } from '@/hooks/useStoredState';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { TextField, PickerField } from '@/components/Fields';
import { colors, fontFamilies } from '@/theme';

interface Note {
  cat: string;
  title: string;
  src: 'official' | 'local';
  body: string;
}

// Built-in seed — copied into AsyncStorage on first run. Edits + additions
// from there on out live in `gc.notes`.
const NOTES_SEED: Note[] = [
  { cat: 'Sin',     title: 'Sin thresholds and penalties', src: 'official', body: 'Sin 1 → −10 Faith. Sin 3 → harder spellcasting. Sin 5 → punitive event.' },
  { cat: 'Miscast', title: 'Minor Miscast table',          src: 'official', body: 'Roll d100, apply the listed effect. The GM may flavour it.' },
  { cat: 'Miscast', title: 'Major Miscast table',          src: 'official', body: 'Corruption point and additional consequences.' },
  { cat: 'Fear',    title: 'Fear & Terror thresholds',     src: 'official', body: 'WP test; on failure the Broken condition.' },
  { cat: 'House',   title: 'Our group: 1 Fate per scene',  src: 'local',    body: 'A Fate refreshes at the start of every scene to keep things moving.' },
  { cat: 'GM',      title: 'Eberfeld road encounters',     src: 'local',    body: 'Encounter table for the Eberfeld–Ubersreik road.' },
  { cat: 'Sin',     title: "Sigmund's personal Sin list",  src: 'local',    body: 'Specific deeds that count as Sin for a Sigmar follower.' },
];

const FILTER_BASE = ['All', 'Sin', 'Miscast', 'Channelling', 'Fear', 'Corruption', 'Mutation', 'House', 'GM'];

const CATEGORY_OPTIONS = [
  { value: 'Sin',         label: 'Sin' },
  { value: 'Miscast',     label: 'Miscast' },
  { value: 'Channelling', label: 'Channelling' },
  { value: 'Fear',        label: 'Fear' },
  { value: 'Corruption',  label: 'Corruption' },
  { value: 'Mutation',    label: 'Mutation' },
  { value: 'House',       label: 'House rule' },
  { value: 'GM',          label: 'GM' },
] as const;

const SRC_OPTIONS = [
  { value: 'local',    label: 'House' },
  { value: 'official', label: 'Official' },
] as const;

const blankNote = (): Note => ({ cat: 'House', title: '', src: 'local', body: '' });

export const NotesScreen: React.FC = () => {
  const [filter, setFilter] = useStoredState('gc.notes.filter', 'All');
  const [notes, setNotes] = useStoredState<Note[]>('gc.notes', NOTES_SEED);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; draft: Note } | null>(null);

  // Filter chips show every category present in the live notes, even if the
  // user added a brand-new category like "Daemons".
  const filters = useMemo(() => {
    const set = new Set<string>(FILTER_BASE);
    for (const n of notes) set.add(n.cat);
    set.delete('Channelling');
    set.delete('Corruption');
    set.delete('Mutation');
    return ['All', ...Array.from(set).filter(x => x !== 'All').sort()];
  }, [notes]);

  const visible = useMemo(() => {
    let list = filter === 'All' ? notes : notes.filter(n => n.cat === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.cat.toLowerCase().includes(q),
      );
    }
    return list;
  }, [notes, filter, query]);

  const openNew = () => setEditing({ index: null, draft: blankNote() });
  const openEdit = (n: Note) => {
    const realIdx = notes.findIndex(x => x === n);
    if (realIdx < 0) return;
    setEditing({ index: realIdx, draft: { ...n } });
  };

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.title.trim() || !d.body.trim()) {
      // Quick guard — don't accept empty notes.
      setEditing(s => s && { ...s });
      return;
    }
    if (editing.index == null) setNotes(prev => [d, ...prev]);
    else setNotes(prev => prev.map((n, i) => (i === editing.index ? d : n)));
    setEditing(null);
  };

  const remove = () => {
    if (!editing || editing.index == null) return;
    setNotes(prev => prev.filter((_, i) => i !== editing.index));
    setEditing(null);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Notes"
        subRow={<Text style={styles.sub}>Rulebook references and your own notes side-by-side.</Text>}
        actions={
          <>
            <Button
              variant="ghost"
              iconLeft={<Icon name="search" size={13} color={colors.ink2} />}
              onPress={() => setSearchOpen(o => !o)}
            >
              {searchOpen ? 'Close search' : 'Search'}
            </Button>
            <Button
              iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
              onPress={openNew}
            >
              New note
            </Button>
          </>
        }
      />

      {searchOpen ? (
        <View style={styles.searchRow}>
          <TextField
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="title, body, or category"
            autoCapitalize="none"
            style={{ flex: 1 }}
          />
        </View>
      ) : null}

      <Section title="Categories" aside={`${notes.length} notes`} />
      <View style={styles.chips}>
        {filters.map(c => {
          const on = c === filter;
          return (
            <Pressable
              key={c}
              onPress={() => setFilter(c)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                on && styles.chipOn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid}>
        {visible.map((n) => (
          <Pressable
            key={`${n.title}-${n.cat}`}
            style={styles.cellWrap}
            onPress={() => openEdit(n)}
          >
            <Card tight style={{ flex: 1 }}>
              <View style={styles.head}>
                <Text style={styles.cat}>{n.cat.toUpperCase()}</Text>
                <Pill variant={n.src === 'official' ? 'empire' : 'brass'} size={9}>
                  {n.src === 'official' ? 'OFFICIAL' : 'HOUSE'}
                </Pill>
              </View>
              <Text style={styles.title}>{n.title}</Text>
              <Text style={styles.body} numberOfLines={4}>{n.body}</Text>
            </Card>
          </Pressable>
        ))}
        {visible.length === 0 ? (
          <View style={[styles.cellWrap, { minHeight: 80, justifyContent: 'center' }]}>
            <Text style={{ color: colors.ink3, fontStyle: 'italic', fontFamily: fontFamilies.body }}>
              No notes match. {query ? `Try a different query.` : `Tap "New note" to add one.`}
            </Text>
          </View>
        ) : null}
      </View>

      <EditSheet
        visible={!!editing}
        title={editing?.index == null ? 'New note' : 'Edit note'}
        subtitle={editing?.index == null ? 'Add a rule reference or house note.' : 'Tap Save to commit, or Delete to remove.'}
        onClose={() => setEditing(null)}
        onSave={save}
        saveDisabled={!editing?.draft.title.trim() || !editing?.draft.body.trim()}
        destructive={editing?.index != null ? { label: 'Delete', onPress: remove } : undefined}
      >
        {editing ? (
          <>
            <TextField
              label="Title"
              value={editing.draft.title}
              onChangeText={t => setEditing(s => s && ({ ...s, draft: { ...s.draft, title: t } }))}
              placeholder="e.g. Fast healing house rule"
            />
            <PickerField
              label="Category"
              value={editing.draft.cat as (typeof CATEGORY_OPTIONS)[number]['value']}
              onChange={(v) => setEditing(s => s && ({ ...s, draft: { ...s.draft, cat: v } }))}
              options={[...CATEGORY_OPTIONS]}
            />
            <PickerField
              label="Source"
              value={editing.draft.src}
              onChange={(v) => setEditing(s => s && ({ ...s, draft: { ...s.draft, src: v } }))}
              options={[...SRC_OPTIONS]}
              hint="Official = pulled from the core book. House = your own."
            />
            <TextField
              label="Body"
              value={editing.draft.body}
              onChangeText={t => setEditing(s => s && ({ ...s, draft: { ...s.draft, body: t } }))}
              placeholder="The full rule or note."
              multiline
              numberOfLines={6}
            />
          </>
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  searchRow: { flexDirection: 'row', marginBottom: 8, marginTop: -8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
  },
  chipOn: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  chipText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 11.5,
    color: colors.ink2,
  },
  chipTextOn: { color: colors.bone },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  cellWrap: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cat: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink3,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 6,
  },
  body: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
    fontFamily: fontFamilies.body,
  },
});
