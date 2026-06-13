import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter } from '@/hooks/useCharacter';
import { useStoredState } from '@/hooks/useStoredState';
import { characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { useResolveSpells, useTable } from '@/content/useContent';
import { rollOnTable } from '@/content/tables';
import type { Spell } from '@/content/types';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Counter } from '@/components/Counter';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles, tabular } from '@/components/primitives';

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const MagicScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const { modifier: condMod } = useConditions();

  // Channelling pool — SL accumulated from successful Channelling tests.
  // Each casting attempt may add the pool's SL to the cast SL. Cleared on
  // cast or miscast.
  const [pool, setPool] = useStoredState(characterKey(id, 'magic.pool'), 0);

  // Content hooks must run before the early return below.
  const spells = useResolveSpells(c.knownSpells ?? []);
  const miscastMinor = useTable('miscast-minor');
  const miscastMajor = useTable('miscast-major');

  if (!c.isCaster) {
    return (
      <ScreenContainer>
        <Hero
          title="Magic"
          subRow={<Text style={styles.sub}>{c.name} is not a spellcaster — this screen is for reference only.</Text>}
        />
        <Card style={styles.empty}>
          <Icon name="sparkle" size={28} color={colors.ink3} />
          <Text style={styles.emptyTitle}>No spells</Text>
          <Text style={styles.emptyBody}>
            The Magic page activates when the character has spellcasting (e.g. Apprentice Wizard or Wizard career).
            Use the Reference page to browse magic rules, or create a Wizard archetype on the New Character screen.
          </Text>
        </Card>
      </ScreenContainer>
    );
  }

  const wp = chars.find(x => x.key === 'wp')!;
  const intCh = chars.find(x => x.key === 'int')!;
  const wpb = wp.bonus;

  // Test targets for the active character. We treat "Channelling (<Lore>)" as
  // matching any "Channelling " skill name; "Language (Magick)" is the cast
  // skill.
  const channelSkill = c.skills.find(s => s.name.startsWith('Channelling'));
  const langSkill = c.skills.find(s => s.name === 'Language (Magick)');
  const channelTarget = wp.current + (channelSkill?.adv ?? 0);
  const castTarget = intCh.current + (langSkill?.adv ?? 0);

  const channel = () => {
    const r = resolveTest({ target: channelTarget, modifier: condMod.total, label: 'Channelling' });
    const isDouble = r.roll >= 11 && r.roll <= 99 && Math.floor(r.roll / 10) === (r.roll % 10);

    if (isDouble) {
      // A double while channelling is a Miscast. A successful (Critical) channel
      // is a Minor Miscast that still banks its SL; a failed double is a fumble →
      // Major Miscast and the pool is lost.
      const mRoll = rollD100();
      if (r.success) {
        const slGain = Math.max(0, r.sl);
        const newPool = pool + slGain;
        setPool(newPool);
        Alert.alert(
          'Channelling — Minor Miscast',
          `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}\n\nPool still gained ${slGain} SL → ${newPool} total.`,
        );
      } else {
        setPool(0);
        Alert.alert(
          'Channelling — Major Miscast',
          `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMajor, mRoll)}\n\nChannelling pool lost.`,
        );
      }
      return;
    }

    const slGain = Math.max(0, r.sl);
    const newPool = pool + slGain;
    if (r.success) setPool(newPool);
    Alert.alert(
      `Channelling — ${outcomeLabel(r.outcome)}`,
      `${formatTestResult(r)}\n\n${
        r.success
          ? `Pool gained ${slGain} SL → ${newPool} total. Spend on your next cast.`
          : 'No SL added. The Aethyr resists.'
      }`,
    );
  };

  const cast = (spell: Spell) => {
    const r = resolveTest({ target: castTarget, modifier: condMod.total, label: `Cast ${spell.name}` });
    // Total SL = test SL + channelling pool.
    const totalSl = r.sl + pool;
    const reachedCN = totalSl >= spell.cn;
    const usedPool = pool;
    setPool(0); // Pool spends regardless of success.

    // A double on the casting roll is a Miscast (WFRP 4e), whether or not the
    // spell goes off — not merely a fumble (96–00).
    const isDouble = r.roll >= 11 && r.roll <= 99 && Math.floor(r.roll / 10) === (r.roll % 10);

    let body = `${formatTestResult(r)}\n\nChannelling pool used: +${usedPool} SL\nTotal SL: ${totalSl}\nNeeded: ${spell.cn}\n\n`;

    if (isDouble) {
      const mRoll = rollD100();
      body += `MISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}`;
      if (reachedCN) {
        body += `\n\n…the spell still resolves: ${spell.description}${spell.damage ? `\nDamage: ${spell.damage}` : ''}`;
      }
    } else if (reachedCN) {
      body += `→ ${spell.name} resolves!\n${spell.description}${spell.damage ? `\nDamage: ${spell.damage}` : ''}`;
    } else {
      body += `→ Not enough SL — spell fizzles. The energy disperses harmlessly.`;
    }

    Alert.alert(`${spell.name} — ${outcomeLabel(r.outcome)}`, body);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Magic"
        subRow={
          <>
            <Text style={styles.sub}>{c.name} · {c.spellLore ?? 'Wizard'}</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{spells.length} spells known</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>Language (Magick) {langSkill ? `+${langSkill.adv}` : '—'}</Text>
          </>
        }
      />

      <View style={styles.poolRow}>
        <Counter
          label="Channelling pool"
          sub="banked SL for next cast"
          value={pool}
          variant="fate"
          style={{ flex: 1 }}
        />
        <Card style={{ flex: 1 }}>
          <Text style={styles.cardLabel}>Channel the Aethyr</Text>
          <Text style={styles.body}>
            Test Channelling (target {channelTarget}). Successful SL stack into the pool until you cast or miscast.
          </Text>
          <View style={[layoutStyles.row, { marginTop: 12, gap: 8 }]}>
            <Button
              variant="brass"
              iconLeft={<Icon name="dice" size={13} color="#2a2010" />}
              onPress={channel}
            >
              Channel
            </Button>
            <Button
              variant="ghost"
              onPress={() => setPool(0)}
              disabled={pool === 0}
            >
              Release pool
            </Button>
          </View>
        </Card>
      </View>

      <Section title="Known spells" aside={`WP ${wp.current} · WPB ${wpb}`} />
      <Card flush>
        <CardHead title="Spells" meta={c.spellLore?.toLowerCase() ?? 'lore'} />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={1}>Lore</Cell>
            <Cell header num flex={0.6}>CN</Cell>
            <Cell header flex={1.2}>Range</Cell>
            <Cell header flex={1.1}>Duration</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {spells.map((s, i) => (
            <TableRow key={s.id} last={i === spells.length - 1}>
              <Cell flex={2}>
                <View>
                  <Text style={styles.spellName}>{s.name}</Text>
                  <Text style={styles.spellDesc} numberOfLines={2}>{s.description}</Text>
                </View>
              </Cell>
              <Cell flex={1}>
                <Pill variant={s.lore === 'Petty' ? 'ghost' : 'empire'} size={10}>{s.lore}</Pill>
              </Cell>
              <Cell num flex={0.6} textStyle={[{ fontFamily: fontFamilies.monoMedium, color: s.cn >= 8 ? colors.empire : colors.ink }, tabular]}>{s.cn}</Cell>
              <Cell flex={1.2} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>{s.range}</Cell>
              <Cell flex={1.1} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>{s.duration}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => cast(s)}
                >{''}</Button>
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
    marginTop: 24,
  },
  emptyTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 20,
    color: colors.ink,
    marginTop: 10,
  },
  emptyBody: {
    color: colors.ink3,
    fontSize: 13,
    marginTop: 6,
    maxWidth: 460,
    textAlign: 'center',
    lineHeight: 19,
    fontFamily: fontFamilies.body,
  },
  poolRow: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  cardLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  body: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    fontFamily: fontFamilies.body,
    lineHeight: 18,
  },
  spellName: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  spellDesc: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
    lineHeight: 15,
  },
});
