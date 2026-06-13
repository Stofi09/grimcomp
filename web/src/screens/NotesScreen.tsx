import { useMemo, useState } from 'react';
import { useStoredState } from '@/hooks/useStoredState';
import { useNoteSeeds } from '@/content/useContent';
import type { NoteSeed, NoteOption } from '@/content/types';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { TextField, PickerField } from '@/components/Fields';
import { colors } from '@/theme';
import './NotesScreen.css';

// A persisted note. Improvement over the RN original: every note carries a
// stable `id` so edit/delete are keyed by id rather than object reference —
// reference equality breaks after a localStorage round-trip, id never does.
interface Note extends NoteSeed {
  id: string;
}

// Fallbacks used only if a content pack ships no noteSeeds section, so the
// screen is never empty. Mirror the RN constants exactly.
const FALLBACK_SEED: NoteSeed[] = [
  { cat: 'Sin',     title: 'Sin thresholds and penalties', src: 'official', body: 'Sin 1 → −10 Faith. Sin 3 → harder spellcasting. Sin 5 → punitive event.' },
  { cat: 'Miscast', title: 'Minor Miscast table',          src: 'official', body: 'Roll d100, apply the listed effect. The GM may flavour it.' },
  { cat: 'Miscast', title: 'Major Miscast table',          src: 'official', body: 'Corruption point and additional consequences.' },
  { cat: 'Fear',    title: 'Fear & Terror thresholds',     src: 'official', body: 'WP test; on failure the Broken condition.' },
  { cat: 'House',   title: 'Our group: 1 Fate per scene',  src: 'local',    body: 'A Fate refreshes at the start of every scene to keep things moving.' },
  { cat: 'GM',      title: 'Eberfeld road encounters',     src: 'local',    body: 'Encounter table for the Eberfeld–Ubersreik road.' },
  { cat: 'Sin',     title: "Sigmund's personal Sin list",  src: 'local',    body: 'Specific deeds that count as Sin for a Sigmar follower.' },
];

const FALLBACK_CATEGORIES: NoteOption[] = [
  { value: 'Sin',         label: 'Sin' },
  { value: 'Miscast',     label: 'Miscast' },
  { value: 'Channelling', label: 'Channelling' },
  { value: 'Fear',        label: 'Fear' },
  { value: 'Corruption',  label: 'Corruption' },
  { value: 'Mutation',    label: 'Mutation' },
  { value: 'House',       label: 'House rule' },
  { value: 'GM',          label: 'GM' },
];

const FALLBACK_SRC: NoteOption[] = [
  { value: 'local',    label: 'House' },
  { value: 'official', label: 'Official' },
];

let _newNoteCounter = 0;
const freshId = (): string => `note-${Date.now().toString(36)}-${(_newNoteCounter++).toString(36)}`;

const blankNote = (defaultCat: string): Note => ({
  id: freshId(),
  cat: defaultCat || 'House',
  title: '',
  src: 'local',
  body: '',
});

export const NotesScreen: React.FC = () => {
  const seeds = useNoteSeeds();
  const seedNotes = seeds?.notes ?? FALLBACK_SEED;
  const categoryOptions = seeds?.categories ?? FALLBACK_CATEGORIES;
  const srcOptions = seeds?.srcOptions ?? FALLBACK_SRC;

  // Build the persisted seed once per registry-seeds identity, assigning each
  // seed a deterministic id so edits to a seed note key by id and survive
  // reloads.
  const persistedSeed = useMemo<Note[]>(
    () => seedNotes.map((n, i) => ({ id: `seed-${i}`, ...n })),
    [seedNotes],
  );

  const [filter, setFilter] = useStoredState('gc.notes.filter', 'All');
  const [notes, setNotes] = useStoredState<Note[]>('gc.notes', persistedSeed);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Note } | null>(null);

  const defaultCat = categoryOptions[categoryOptions.length - 1]?.value ?? 'House';

  // Filter chips show every category present in the live notes, even if the
  // user added a brand-new category like "Daemons". Fully content-driven: the
  // seeded notes (or the user's own) decide which chips exist.
  const filters = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) set.add(n.cat);
    return ['All', ...Array.from(set).sort()];
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

  const openNew = () => setEditing({ id: null, draft: blankNote(defaultCat) });
  const openEdit = (n: Note) => setEditing({ id: n.id, draft: { ...n } });

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.title.trim() || !d.body.trim()) {
      // Quick guard — don't accept empty notes.
      setEditing(s => s && { ...s });
      return;
    }
    if (editing.id == null) setNotes(prev => [d, ...prev]);
    else setNotes(prev => prev.map(n => (n.id === editing.id ? d : n)));
    setEditing(null);
  };

  const remove = () => {
    if (!editing || editing.id == null) return;
    const id = editing.id;
    setNotes(prev => prev.filter(n => n.id !== id));
    setEditing(null);
  };

  const catOpts = categoryOptions.map(o => ({ value: o.value, label: o.label }));
  const srcOpts = srcOptions.map(o => ({ value: o.value, label: o.label }));

  return (
    <ScreenContainer>
      <Hero
        title="Notes"
        subRow={<span className="notes-sub">Rulebook references and your own notes side-by-side.</span>}
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
        <div className="notes-search-row">
          <TextField
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="title, body, or category"
            autoCapitalize="none"
            style={{ flex: 1 }}
          />
        </div>
      ) : null}

      <Section title="Categories" aside={`${notes.length} notes`} />
      <div className="notes-chips">
        {filters.map(c => {
          const on = c === filter;
          return (
            <button
              key={c}
              type="button"
              className={`btn-reset notes-chip${on ? ' notes-chip--on' : ''}`}
              onClick={() => setFilter(c)}
            >
              <span className="notes-chip-text">{c}</span>
            </button>
          );
        })}
      </div>

      <div className="notes-grid">
        {visible.map((n) => (
          <button
            key={n.id}
            type="button"
            className="btn-reset notes-card-btn notes-cell-wrap"
            onClick={() => openEdit(n)}
          >
            <Card tight style={{ flex: 1 }}>
              <div className="notes-head">
                <span className="notes-cat">{n.cat.toUpperCase()}</span>
                <Pill variant={n.src === 'official' ? 'empire' : 'brass'} size={9}>
                  {n.src === 'official' ? 'OFFICIAL' : 'HOUSE'}
                </Pill>
              </div>
              <span className="notes-title">{n.title}</span>
              <span className="notes-body">{n.body}</span>
            </Card>
          </button>
        ))}
        {visible.length === 0 ? (
          <div className="notes-empty">
            <span className="notes-empty-text">
              No notes match. {query ? `Try a different query.` : `Tap "New note" to add one.`}
            </span>
          </div>
        ) : null}
      </div>

      <EditSheet
        visible={!!editing}
        title={editing?.id == null ? 'New note' : 'Edit note'}
        subtitle={editing?.id == null ? 'Add a rule reference or house note.' : 'Tap Save to commit, or Delete to remove.'}
        onClose={() => setEditing(null)}
        onSave={save}
        saveDisabled={!editing?.draft.title.trim() || !editing?.draft.body.trim()}
        destructive={editing?.id != null ? { label: 'Delete', onPress: remove } : undefined}
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
              value={editing.draft.cat}
              onChange={(v) => setEditing(s => s && ({ ...s, draft: { ...s.draft, cat: v } }))}
              options={catOpts}
            />
            <PickerField
              label="Source"
              value={editing.draft.src}
              onChange={(v) => setEditing(s => s && ({ ...s, draft: { ...s.draft, src: v as Note['src'] } }))}
              options={srcOpts}
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
