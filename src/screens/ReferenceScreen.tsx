import React from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable } from 'react-native';
// Relative imports keep this screen renderable by the native regression tests,
// whose '@/' alias points at the web tree.
import { ScreenContainer } from './ScreenContainer';
import { useContent } from '../content/useContent';
import { Hero } from '../components/Hero';
import { Section } from '../components/Section';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EditSheet } from '../components/EditSheet';
import { Icon, type IconName } from '../components/Icon';
import { colors, fontFamilies } from '../theme';
import { layoutStyles } from '../components/primitives';
import {
  buildNativeReferenceItems,
  nativeReferenceCategoryCounts,
  searchNativeReferenceItems,
  type NativeReferenceItem,
} from '../utils/nativeReferenceSearch';

const CATEGORY_ICONS: Record<string, IconName> = {
  Careers: 'crown', Skills: 'scroll', Talents: 'star', Spells: 'sparkle',
  Prayers: 'flame', Rules: 'tome', Conditions: 'heart', 'Critical Wounds': 'sword',
  'Chaos & Mutation': 'mask', Tables: 'dice', Species: 'users', Weapons: 'sword',
  Armour: 'shield', Trappings: 'pack',
};
const PAGE_SIZE = 50;

export const ReferenceScreen: React.FC = () => {
  const reg = useContent();
  const items = React.useMemo(() => buildNativeReferenceItems(reg), [reg]);
  const categories = React.useMemo(() => nativeReferenceCategoryCounts(items), [items]);
  const [visible, setVisible] = React.useState(false);
  const [category, setCategory] = React.useState<string | null>(null);
  const filterCategories = React.useMemo(() => nativeReferenceCategoryCounts(items, category), [items, category]);
  const [query, setQuery] = React.useState('');
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [recentIds, setRecentIds] = React.useState<string[]>([]);
  const selected = items.find(entry => entry.id === selectedId);
  const recent = recentIds.map(id => items.find(entry => entry.id === id))
    .filter((entry): entry is NativeReferenceItem => entry !== undefined);
  const results = React.useMemo(
    () => searchNativeReferenceItems(items, query, category), [items, query, category],
  );

  const openCategory = (next: string | null) => {
    setCategory(next);
    setQuery('');
    setShown(PAGE_SIZE);
    setSelectedId(null);
    setVisible(true);
  };
  const openItem = (entry: NativeReferenceItem) => {
    setSelectedId(entry.id);
    setRecentIds(previous => [entry.id, ...previous.filter(id => id !== entry.id)].slice(0, 4));
    setVisible(true);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Reference"
        subRow={<Text style={styles.sub}>WFRP 4e &amp; Winds of Magic · {items.length} loaded entries · offline</Text>}
        actions={
          <Button
            iconLeft={<Icon name="search" size={13} color={colors.ink} />}
            onPress={() => openCategory(null)}
          >
            Search rules
          </Button>
        }
      />
      <Text style={styles.coverage}>
        Counts show loaded entries, including page references and approximate summaries.
        Consult the listed sources for the full rules.
      </Text>

      <Section title="Categories" />
      <View style={styles.grid}>
        {categories.map(entry => (
          <Pressable
            key={entry.title}
            accessibilityRole="button"
            accessibilityLabel={`Browse ${entry.title}, ${entry.count} loaded entries`}
            style={({ pressed }) => [styles.cellWrap, pressed && styles.pressed]}
            onPress={() => openCategory(entry.title)}
          >
            <Card tight style={{ flex: 1 }}>
              <View style={layoutStyles.rowBetween}>
                <Icon name={CATEGORY_ICONS[entry.title] ?? 'tome'} size={18} color={colors.ink2} />
                <Text style={styles.count}>{entry.count}</Text>
              </View>
              <Text style={styles.cTitle}>{entry.title}</Text>
              <Text style={styles.small}>{entry.count === 0 ? 'No loaded entries' : 'Browse entries'}</Text>
            </Card>
          </Pressable>
        ))}
      </View>

      <Section title="Recently viewed this session" />
      <Card flush>
        {recent.length === 0 ? (
          <Text style={styles.empty}>Open a reference entry and it will appear here.</Text>
        ) : recent.map(entry => (
          <ReferenceRow key={entry.id} entry={entry} onPress={() => openItem(entry)} />
        ))}
      </Card>

      <EditSheet
        contentKey={selected ? `detail:${selected.id}` : 'browse'}
        visible={visible}
        title={selected?.name ?? 'Browse reference'}
        subtitle={selected ? selected.category : `${category ?? 'All categories'} · ${results.length} matching entries`}
        onClose={() => setVisible(false)}
      >
        {selected ? (
          <View style={styles.detail}>
            <Button variant="ghost" onPress={() => setSelectedId(null)}>Back to results</Button>
            <Text selectable style={styles.source}>{selected.source}</Text>
            <Text style={styles.status}>{selected.status}</Text>
            {selected.notice ? <Text style={styles.notice}>{selected.notice}</Text> : null}
            {selected.meta ? <Text selectable style={styles.meta}>{selected.meta}</Text> : null}
            <Text selectable style={styles.body}>{selected.detail}</Text>
          </View>
        ) : (
          <View style={styles.detail}>
            <TextInput
              accessibilityLabel="Search reference entries"
              style={styles.search}
              value={query}
              onChangeText={next => { setQuery(next); setShown(PAGE_SIZE); }}
              placeholder="Search name, rules, book or page…"
              placeholderTextColor={colors.ink4}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="handled"
              style={styles.filters}
            >
              {[null, ...filterCategories.map(entry => entry.title)].map(candidate => (
                <Pressable
                  key={candidate === null ? 'all' : `category:${candidate}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === candidate }}
                  accessibilityLabel={`Filter ${candidate ?? 'All categories'}`}
                  onPress={() => { setCategory(candidate); setShown(PAGE_SIZE); }}
                  style={[styles.filter, category === candidate && styles.filterOn]}
                >
                  <Text style={[styles.filterText, category === candidate && styles.filterTextOn]}>
                    {candidate ?? 'All categories'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text accessibilityLiveRegion="polite" style={styles.small}>
              {results.length} matching {results.length === 1 ? 'entry' : 'entries'}
              {results.length > shown ? ` · showing ${shown}` : ''}
            </Text>
            <Card flush>
              {results.slice(0, shown).map(entry => (
                <ReferenceRow key={entry.id} entry={entry} onPress={() => openItem(entry)} />
              ))}
              {results.length === 0 ? (
                <Text style={styles.empty}>No matching entries. Try another search or category.</Text>
              ) : null}
            </Card>
            {results.length > shown ? (
              <Button onPress={() => setShown(previous => previous + PAGE_SIZE)}>
                Show more ({results.length - shown} remaining)
              </Button>
            ) : null}
          </View>
        )}
      </EditSheet>
    </ScreenContainer>
  );
};

const ReferenceRow: React.FC<{ entry: NativeReferenceItem; onPress: () => void }> = ({ entry, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${entry.name}, ${entry.category}, ${entry.status}, ${entry.source}`}
    onPress={onPress}
    style={({ pressed }) => [styles.result, pressed && styles.pressed]}
  >
    <View style={styles.resultText}>
      <Text style={styles.resultTitle}>{entry.name}</Text>
      <Text style={styles.small}>{entry.category}{entry.meta ? ` · ${entry.meta}` : ''}</Text>
      <Text style={styles.small}>{entry.source} · {entry.status}</Text>
    </View>
    <Icon name="chev" size={13} color={colors.ink3} />
  </Pressable>
);

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  coverage: { fontSize: 12, lineHeight: 18, color: colors.ink3, fontFamily: fontFamilies.body, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cellWrap: { flexBasis: '23%', flexGrow: 1, minWidth: 160 },
  pressed: { opacity: 0.65 },
  count: { fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 },
  cTitle: { fontFamily: fontFamilies.display, fontSize: 17, color: colors.ink, marginTop: 10 },
  small: { fontSize: 11, lineHeight: 16, color: colors.ink3, fontFamily: fontFamilies.body },
  empty: { padding: 16, fontFamily: fontFamilies.body, fontSize: 13, color: colors.ink3 },
  detail: { gap: 12, paddingBottom: 20 },
  source: { fontFamily: fontFamilies.mono, fontSize: 12, color: colors.ink2 },
  status: { fontFamily: fontFamilies.bodyBold, fontSize: 12, color: colors.brass },
  notice: { fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19, color: colors.empire },
  meta: { fontFamily: fontFamilies.bodySemibold, fontSize: 13, lineHeight: 20, color: colors.ink2 },
  body: { fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 22, color: colors.ink },
  search: {
    fontFamily: fontFamilies.body, fontSize: 14, color: colors.ink,
    borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 10,
  },
  filters: { paddingVertical: 4 },
  filter: { paddingHorizontal: 12, paddingVertical: 10, marginRight: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
  filterOn: { backgroundColor: colors.empire },
  filterText: { fontFamily: fontFamilies.bodyMedium, fontSize: 12, color: colors.ink2 },
  filterTextOn: { color: colors.bone },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  resultText: { flex: 1, gap: 3 },
  resultTitle: { fontFamily: fontFamilies.bodySemibold, fontSize: 14, color: colors.ink },
});
