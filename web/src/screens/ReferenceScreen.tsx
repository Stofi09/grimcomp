import * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useContent } from '@/content/useContent';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/iconNames';
import { Table, TableRow, Cell } from '@/components/Table';
import { ReferenceSearchSheet } from '@/components/ReferenceSearchSheet';
import { useStoredState } from '@/hooks/useStoredState';
import { buildReferenceItems, getReferenceCategories, type ReferenceCategory, type ReferenceItem } from '@/utils/referenceSearch';
import { colors } from '@/theme';
import './ReferenceScreen.css';

interface CategoryDef {
  icon: IconName;
  title: string;
  count: number;
  sub?: string;
  category: ReferenceCategory;
}

export const ReferenceScreen: React.FC = () => {
  const reg = useContent();
  const [recent, setRecent] = useStoredState<ReferenceItem[]>('gc.reference.recent', []);
  const [search, setSearch] = React.useState<{
    category: ReferenceCategory | null;
    query: string;
  } | null>(null);
  const items = React.useMemo(() => buildReferenceItems(reg), [reg]);
  const categoryCounts = new Map<ReferenceCategory, number>();
  for (const item of items) {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
  }
  const loreCount = new Set(reg.allSpells.map(s => s.lore)).size;
  // Count declared deities from the roster, not distinct prayer deities — the
  // latter includes the generic "Any" blessing bucket (creation.anyDeity).
  const deityCount = reg.allDeities.length;
  const careerReferenceCount = reg.allReferences.filter(entry => entry.category === 'Careers').length;
  const layerLabel = `${reg.packs.length} content layer${reg.packs.length === 1 ? '' : 's'}`;
  const categoryDetails: Record<string, { icon: IconName; sub?: string }> = {
    Careers: {
      icon: 'crown',
      sub: careerReferenceCount
        ? `${reg.allCareers.length} paths + ${careerReferenceCount} special refs`
        : 'all 4 ranks',
    },
    Skills: { icon: 'scroll', sub: 'basic + advanced' },
    Talents: { icon: 'star' },
    Spells: { icon: 'sparkle', sub: `${loreCount} lores` },
    Prayers: { icon: 'flame', sub: `${deityCount} deities` },
    Conditions: { icon: 'heart' },
    'Critical Wounds': { icon: 'sword', sub: 'loaded wounds' },
    'Chaos & Mutation': { icon: 'mask' },
    'Roll Tables': { icon: 'dice', sub: 'outcomes + dice' },
  };
  const cats: CategoryDef[] = getReferenceCategories(items).map(category => ({
    title: category,
    category,
    count: categoryCounts.get(category) ?? 0,
    ...(Object.prototype.hasOwnProperty.call(categoryDetails, category)
      ? categoryDetails[category]
      : { icon: 'book' as const }),
  }));
  const recordViewed = (item: ReferenceItem) => {
    setRecent(previous => [item, ...previous.filter(entry => entry.id !== item.id)].slice(0, 4));
  };

  return (
    <ScreenContainer>
      <Hero
        title="Reference"
        subRow={<span className="ref-sub">WFRP 4e rules library · {layerLabel} · offline</span>}
        actions={
          <Button
            iconLeft={<Icon name="search" size={13} color={colors.ink} />}
            onPress={() => setSearch({ category: null, query: '' })}
          >
            Search rules
          </Button>
        }
      />

      <Section title="Categories" />
      <div className="ref-grid">
        {cats.map(c => (
          <button
            key={c.title}
            type="button"
            className="btn-reset ref-card-btn ref-cell-wrap"
            aria-label={`Open ${c.title} reference`}
            onClick={() => setSearch({ category: c.category, query: '' })}
          >
            <Card tight style={{ flex: 1 }}>
              <div className="ref-row-between">
                <Icon name={c.icon} size={18} color={colors.ink2} />
                <span className="ref-count">{c.count}</span>
              </div>
              <span className="ref-ctitle">{c.title}</span>
              {c.sub ? <span className="ref-csub">{c.sub}</span> : null}
            </Card>
          </button>
        ))}
      </div>

      <Section title="Recently viewed" />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={1.2}>Category</Cell>
            <Cell header flex={1.4}>Summary</Cell>
            <Cell header flex={0.4}> </Cell>
          </TableRow>
          {recent.map((item, i) => (
            <TableRow
              key={item.id}
              last={i === recent.length - 1}
              onPress={() => setSearch({ category: item.category, query: item.name })}
            >
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{item.name}</Cell>
              <Cell flex={1.2} textStyle={{ color: colors.ink3 }}>{item.category}</Cell>
              <Cell flex={1.4} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{item.meta}</Cell>
              <Cell flex={0.4} align="right">
                <Icon name="chev" size={12} color={colors.ink3} />
              </Cell>
            </TableRow>
          ))}
          {recent.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                Open a reference entry and it will appear here.
              </Cell>
            </TableRow>
          ) : null}
        </Table>
      </Card>

      <ReferenceSearchSheet
        visible={search !== null}
        onClose={() => setSearch(null)}
        initialCategory={search?.category ?? null}
        initialQuery={search?.query ?? ''}
        onViewed={recordViewed}
      />
    </ScreenContainer>
  );
};
