import { useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Trapping, type Weapon, type Armour } from '@/data/character';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useDerived } from '@/hooks/useDerived';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { useStoredState } from '@/hooks/useStoredState';
import { useSystemRules } from '@/content/useContent';
import { Alert } from '@/ui/alertStore';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Counter } from '@/components/Counter';
import { Bar } from '@/components/Bar';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { EditSheet } from '@/components/EditSheet';
import { TextField, NumberField } from '@/components/Fields';
import { colors } from '@/theme';
import './TrappingsScreen.css';

const blankTrapping = (): Trapping => ({ name: '', enc: 0 });

export const TrappingsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const maxEnc = useDerived().maxEncumbrance;
  const { currency } = useSystemRules();
  const [wealth, setWealth] = useStoredState<Record<string, number>>(
    characterKey(id, 'wealth'),
    c.wealth,
  );
  const [wealthDraft, setWealthDraft] = useState<Record<string, number> | null>(null);
  // Total wealth in base units (brass pennies for WFRP), from the configured
  // denominations.
  const wealthBase = currency.units.reduce(
    (a, u) => a + (wealth[u.key] ?? 0) * u.factor, 0,
  );

  // Live collections — weapons + armour share their storage keys with
  // CombatScreen, so they must seed with the *same* full shape. Seeding a
  // trimmed `{ enc }` object here would let whichever screen mounts first
  // cache a shape the other can't read (CombatScreen reads .qual / .locs).
  const trappings = useCharacterCollection<Trapping>('trappings', c.trappings);
  const weapons = useCharacterCollection<Weapon>('weapons', c.weapons);
  const armour = useCharacterCollection<Armour>('armour', c.armour);

  const encItems = trappings.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const encW = weapons.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const encA = armour.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const enc = encItems + encW + encA;

  const [editing, setEditing] = useState<{ index: number | null; draft: Trapping } | null>(null);
  const openNew = () => setEditing({ index: null, draft: blankTrapping() });
  const openEdit = (i: number) => setEditing({ index: i, draft: { ...trappings.items[i] } });

  const save = () => {
    if (!editing) return;
    if (!editing.draft.name.trim()) {
      Alert.alert('Name required', 'Give the item a name.');
      return;
    }
    if (editing.index == null) trappings.add(editing.draft);
    else trappings.update(editing.index, editing.draft);
    setEditing(null);
  };
  const drop = () => {
    if (!editing || editing.index == null) return;
    const name = editing.draft.name;
    trappings.remove(editing.index);
    setEditing(null);
    Alert.alert('Dropped', `${name} removed from inventory.`);
  };
  const saveWealth = () => {
    if (!wealthDraft) return;
    setWealth(wealthDraft);
    setWealthDraft(null);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Trappings"
        subRow={<span className="trp-sub">Inventory, encumbrance, and coin.</span>}
        actions={
          <>
            <Button
              iconLeft={<Icon name="quill" size={13} color={colors.ink} />}
              onPress={() => setWealthDraft({ ...wealth })}
            >
              Edit wealth
            </Button>
            <Button
              iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
              onPress={openNew}
            >
              New item
            </Button>
          </>
        }
      />

      <div className="trp-row">
        <Counter
          label="Encumbrance"
          sub={`max ${maxEnc}`}
          value={
            <span
              className="trp-enc-value tabular"
              style={{ color: enc > maxEnc ? colors.empire : colors.ink }}
            >
              {enc}
              <span className="trp-enc-frac">/{maxEnc}</span>
            </span>
          }
          style={{ flex: 1 }}
        />
        <Counter
          label="Wealth"
          sub={`${wealthBase} ${currency.baseLabel} ≈`}
          variant="fate"
          value={
            <span className="trp-wealth-value tabular">
              {currency.units.map(u => (
                <span key={u.key}>
                  {wealth[u.key] ?? 0}<span className="trp-frac"> {u.label} </span>
                </span>
              ))}
            </span>
          }
          style={{ flex: 1 }}
        />
        <Card style={{ flex: 1 }}>
          <span className="trp-label">Encumbrance breakdown</span>
          <div className="trp-breakdown">
            <div className="trp-row-between"><span className="trp-muted">Weapons</span><span className="trp-mono">{encW}</span></div>
            <div className="trp-row-between"><span className="trp-muted">Armour</span><span className="trp-mono">{encA}</span></div>
            <div className="trp-row-between"><span className="trp-muted">Other</span><span className="trp-mono">{encItems}</span></div>
          </div>
          <Bar
            value={maxEnc > 0 ? enc / maxEnc : 0}
            variant="brass"
            fillColorOverride={enc > maxEnc ? colors.empire : colors.brassSoft}
            style={{ marginTop: 10 }}
          />
        </Card>
      </div>

      <Section title="Items" aside={`${trappings.items.length} pieces`} />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={3}>Item</Cell>
            <Cell header num flex={0.7}>Enc.</Cell>
            <Cell header flex={0.7}> </Cell>
          </TableRow>
          {trappings.items.map((t, i) => (
            <TableRow key={`${t.name}-${i}`} last={i === trappings.items.length - 1} onPress={() => openEdit(i)}>
              <Cell flex={3} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 500 }}>{t.name}</Cell>
              <Cell num flex={0.7}>{t.enc}</Cell>
              <Cell flex={0.7} align="right">
                <Icon name="chev" size={14} color={colors.ink3} />
              </Cell>
            </TableRow>
          ))}
          {trappings.items.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                No items. Tap "New item" to add one.
              </Cell>
            </TableRow>
          ) : null}
        </Table>
      </Card>

      <EditSheet
        visible={!!editing}
        title={editing?.index == null ? 'New item' : 'Edit item'}
        subtitle={editing?.index == null ? 'Add a trapping to this character\'s pack.' : 'Tap Save to commit, or Drop to remove from inventory.'}
        onClose={() => setEditing(null)}
        onSave={save}
        destructive={editing?.index != null ? { label: 'Drop', onPress: drop } : undefined}
      >
        {editing ? (
          <>
            <TextField
              label="Name"
              value={editing.draft.name}
              onChangeText={t => setEditing(s => s && ({ ...s, draft: { ...s.draft, name: t } }))}
              placeholder="e.g. Lantern oil flask"
            />
            <NumberField
              label="Encumbrance"
              value={editing.draft.enc}
              onChangeNumber={n => setEditing(s => s && ({ ...s, draft: { ...s.draft, enc: n } }))}
              min={0}
              max={20}
              hint="0 for small items, 1 for typical gear, 2+ for bulky."
            />
          </>
        ) : null}
      </EditSheet>

      <EditSheet
        visible={wealthDraft !== null}
        title="Edit wealth"
        subtitle={`Coin is stored per character. Totals are shown in ${currency.baseLabel}.`}
        onClose={() => setWealthDraft(null)}
        onSave={saveWealth}
      >
        {wealthDraft ? currency.units.map(unit => (
          <NumberField
            key={unit.key}
            label={unit.label}
            value={wealthDraft[unit.key] ?? 0}
            onChangeNumber={next => setWealthDraft(previous => previous && ({
              ...previous,
              [unit.key]: next,
            }))}
            min={0}
            max={9999999}
            hint={`1 ${unit.label} = ${unit.factor} ${currency.baseLabel}.`}
          />
        )) : null}
      </EditSheet>
    </ScreenContainer>
  );
};
