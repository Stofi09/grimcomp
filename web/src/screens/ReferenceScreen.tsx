import { ScreenContainer } from './ScreenContainer';
import { useContent } from '@/content/useContent';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Alert } from '@/ui/alert';
import { colors } from '@/theme';
import './ReferenceScreen.css';

interface CategoryDef { icon: IconName; title: string; count: number; sub?: string; }

const RECENT: Array<[string, string, string]> = [
  ['Fear & Terror', 'Condition', 'Core 190'],
  ['Bow (group)', 'Weapon', 'Core 295'],
  ['Apothecary', 'Career', 'Core 62'],
  ['Minor Miscast', 'Table', 'Core 238'],
];

export const ReferenceScreen: React.FC = () => {
  const reg = useContent();
  const loreCount = new Set(reg.allSpells.map(s => s.lore)).size;
  const deityCount = new Set(reg.allPrayers.map(p => p.deity)).size;

  // Counts come straight from the loaded content registry, so importing a
  // content pack updates this screen automatically. Critical Wounds reads the
  // registry's criticals when present (falling back to the original 72
  // placeholder); Chaos & Mutation is not modelled as content yet — left as a
  // placeholder.
  const critCount = reg.criticals.length > 0 ? reg.criticals.length : 72;
  const cats: CategoryDef[] = [
    { icon: 'crown', title: 'Careers', count: reg.allCareers.length, sub: 'all 4 ranks' },
    { icon: 'scroll', title: 'Skills', count: reg.allSkillDefs.length, sub: 'basic + advanced' },
    { icon: 'star', title: 'Talents', count: reg.allTalentDefs.length },
    { icon: 'sparkle', title: 'Spells', count: reg.allSpells.length, sub: `${loreCount} lores` },
    { icon: 'flame', title: 'Prayers', count: reg.allPrayers.length, sub: `${deityCount} deities` },
    { icon: 'heart', title: 'Conditions', count: reg.conditions.length },
    { icon: 'sword', title: 'Critical Wounds', count: critCount, sub: '6 locations' },
    { icon: 'mask', title: 'Chaos & Mutation', count: 28 },
  ];

  return (
    <ScreenContainer>
      <Hero
        title="Reference"
        subRow={<span className="ref-sub">WFRP 4e core book · version 2026.04.01 · offline</span>}
        actions={
          <Button
            iconLeft={<Icon name="search" size={13} color={colors.ink} />}
            onPress={() => Alert.alert('Search', 'Reference search not wired up.')}
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
            onClick={() => Alert.alert(c.title, `${c.count} ${c.title.toLowerCase()} in this category.`)}
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
            <Cell header flex={1.4}>Source</Cell>
            <Cell header flex={0.4}> </Cell>
          </TableRow>
          {RECENT.map((r, i) => (
            <TableRow
              key={i}
              last={i === RECENT.length - 1}
              onPress={() => Alert.alert(r[0], `${r[1]} — ${r[2]}`)}
            >
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r[0]}</Cell>
              <Cell flex={1.2} textStyle={{ color: colors.ink3 }}>{r[1]}</Cell>
              <Cell flex={1.4} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{r[2]}</Cell>
              <Cell flex={0.4} align="right">
                <Icon name="chev" size={12} color={colors.ink3} />
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};
