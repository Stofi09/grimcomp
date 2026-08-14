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
import type { ReferenceCategory, ReferenceItem } from '@/utils/referenceSearch';
import { colors } from '@/theme';
import './ReferenceScreen.css';

interface CategoryDef {
  icon: IconName;
  title: string;
  count: number;
  sub?: string;
  category?: ReferenceCategory;
}

export const ReferenceScreen: React.FC = () => {
  const reg = useContent();
  const [recent, setRecent] = useStoredState<ReferenceItem[]>('gc.reference.recent', []);
  const [search, setSearch] = React.useState<{
    category: ReferenceCategory | 'All';
    query: string;
  } | null>(null);
  const loreCount = new Set(reg.allSpells.map(s => s.lore)).size;
  // Count declared deities from the roster, not distinct prayer deities — the
  // latter includes the generic "Any" blessing bucket (creation.anyDeity).
  const deityCount = reg.allDeities.length;
  // Core-book version tracks the loaded core-rules pack, so a pack bump updates
  // this line automatically (like the counts below).
  const coreVersion = reg.packs.find(p => p.id === 'core-rules')?.version;

  // Counts come straight from the loaded content registry, so importing a
  // content pack updates this screen automatically. Critical Wounds reads the
  // registry's criticals. Generic reference entries cover rules that do not
  // need their own interactive mechanic, including the companion mutation set.
  const critCount = reg.criticals.length;
  const chaosCount = reg.allReferences.filter(entry => entry.category === 'Chaos & Mutation').length;
  const cats: CategoryDef[] = [
    { icon: 'crown', title: 'Careers', count: reg.allCareers.length, sub: 'all 4 ranks', category: 'Careers' },
    { icon: 'scroll', title: 'Skills', count: reg.allSkillDefs.length, sub: 'basic + advanced', category: 'Skills' },
    { icon: 'star', title: 'Talents', count: reg.allTalentDefs.length, category: 'Talents' },
    { icon: 'sparkle', title: 'Spells', count: reg.allSpells.length, sub: `${loreCount} lores`, category: 'Spells' },
    { icon: 'flame', title: 'Prayers', count: reg.allPrayers.length, sub: `${deityCount} deities`, category: 'Prayers' },
    { icon: 'heart', title: 'Conditions', count: reg.conditions.length, category: 'Conditions' },
    { icon: 'sword', title: 'Critical Wounds', count: critCount, sub: 'loaded wounds', category: 'Critical Wounds' },
    { icon: 'mask', title: 'Chaos & Mutation', count: chaosCount, sub: 'approximate companion set', category: 'Chaos & Mutation' },
  ];
  const recordViewed = (item: ReferenceItem) => {
    setRecent(previous => [item, ...previous.filter(entry => entry.id !== item.id)].slice(0, 4));
  };

  return (
    <ScreenContainer>
      <Hero
        title="Reference"
        subRow={<span className="ref-sub">WFRP 4e core book{coreVersion ? ` · version ${coreVersion}` : ''} · offline</span>}
        actions={
          <Button
            iconLeft={<Icon name="search" size={13} color={colors.ink} />}
            onPress={() => setSearch({ category: 'All', query: '' })}
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
            className={`btn-reset ref-card-btn ref-cell-wrap${c.category ? '' : ' ref-card-btn--disabled'}`}
            aria-label={c.category ? `Open ${c.title} reference` : `${c.title} not available`}
            aria-disabled={!c.category}
            onClick={c.category
              ? () => setSearch({ category: c.category!, query: '' })
              : undefined}
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
        initialCategory={search?.category ?? 'All'}
        initialQuery={search?.query ?? ''}
        onViewed={recordViewed}
      />
    </ScreenContainer>
  );
};
