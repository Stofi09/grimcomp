import React from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useConditions } from '@/hooks/useConditions';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useTalents } from '@/hooks/useTalents';
import { useVitals } from '@/hooks/useVitals';
import { useCareer } from '@/hooks/useCareer';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { computeMaxWounds, SMALL_SPECIES } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Bar, SegBar } from '@/components/Bar';
import { Stepper } from '@/components/Stepper';
import { Chip } from '@/components/Chip';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const OverviewScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const xp = useXp();
  const career = useCareer();
  const { get: getChar } = useCharacteristics();
  const { list: talentList } = useTalents();
  const vitals = useVitals();
  const { conds, cycle, names } = useConditions();
  // Live wounds (for the segmented bar) — same key WoundsScreen writes to.
  const [wounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);

  const tb = Math.floor((c.characteristics.find(x => x.key === 't')!.init + getChar('t')) / 10);
  const sb = Math.floor((c.characteristics.find(x => x.key === 's')!.init + getChar('s')) / 10);
  const wpb = Math.floor((c.characteristics.find(x => x.key === 'wp')!.init + getChar('wp')) / 10);
  const xpTotal = xp.total;
  const corrThresh = Math.max(1, tb + wpb);
  // Max Wounds recomputed live from current bonuses (Halflings omit SB; Hardy
  // adds TB per rank).
  const small = SMALL_SPECIES.includes(c.species);
  const hardyRanks = talentList.find(t => t.name === 'Hardy')?.times ?? 0;
  const woundsMax = computeMaxWounds(sb, tb, wpb, c.species, hardyRanks);

  return (
    <ScreenContainer>
      <Hero
        eyebrow={`${c.party.name} · Career ${career.level}/${career.ranks.length || 4}`}
        italic
        title={c.name}
        trailingTitle={
          <>
            <Pill variant="empire">{career.name}</Pill>
            <Pill variant="brass">{career.status}</Pill>
          </>
        }
        subRow={
          <>
            <Text style={styles.subText}>{c.species}, age {c.age}</Text>
            <Text style={styles.subSep}>·</Text>
            <Text style={styles.subText}>{c.height}</Text>
            <Text style={styles.subSep}>·</Text>
            <Text style={styles.subText}>{c.hair} hair, {c.eyes} eyes</Text>
            <Text style={styles.subSep}>·</Text>
            <Text style={[styles.subText, { fontStyle: 'italic', color: colors.ink3 }]} numberOfLines={2}>
              "{c.motivation}"
            </Text>
          </>
        }
        actions={
          <>
            <Button
              iconLeft={<Icon name="quill" size={13} color={colors.ink2} />}
              onPress={() => Alert.alert('Edit Character', 'Editing is not wired up in this prototype.')}
            >
              Edit
            </Button>
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
              onPress={() => {
                const roll = rollD100();
                Alert.alert('Test Roll', `d100 → ${roll}`);
              }}
            >
              Roll Test
            </Button>
          </>
        }
      />

      <Section title="Vitals" aside="round 4 · scene 2" />

      <View style={styles.vitalsGrid}>
        <Card bordered style={[styles.vitalCol, { flexBasis: '40%' }]}>
          <View style={layoutStyles.rowBetween}>
            <View>
              <Text style={[styles.label, { color: colors.empire }]}>Wounds</Text>
              <Text style={styles.sub}>{small ? null : `SB ${sb} + `}2×TB {tb*2} + WPB {wpb}{hardyRanks > 0 ? ` + Hardy ${hardyRanks * tb}` : ''} = {woundsMax}</Text>
            </View>
            <Text style={[styles.bigEmpire, tabular]}>
              {wounds}
              <Text style={styles.bigFrac}>/{woundsMax}</Text>
            </Text>
          </View>
          <SegBar total={woundsMax} filled={wounds} />
          <View style={[layoutStyles.rowBetween, { marginTop: 8 }]}>
            <Text style={styles.metaMono}>0 · CRITICAL</Text>
            <Text style={styles.metaMono}>{woundsMax} · FULL</Text>
          </View>
        </Card>

        <Card style={[styles.vitalCol, { flexBasis: '28%' }]}>
          <View style={layoutStyles.rowBetween}>
            <Text style={[styles.label, { color: colors.brass }]}>Fate & Fortune</Text>
            <Pressable onPress={vitals.refreshFortune} hitSlop={6}>
              <Text style={styles.refreshLink}>↻ new session</Text>
            </Pressable>
          </View>
          <View style={[layoutStyles.row, { marginTop: 8, gap: 12, alignItems: 'center' }]}>
            <View>
              <Text style={styles.subUpper}>Fortune</Text>
              <Text style={[styles.bigBrass, tabular]}>
                {vitals.fortune}<Text style={styles.bigCap}>/{vitals.fate}</Text>
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Stepper value={vitals.fortune} min={0} max={vitals.fate} onChange={vitals.setFortune} />
          </View>
          <View style={styles.dividerLine} />
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.subUpper}>Fate · burn to cheat death</Text>
            <Stepper value={vitals.fate} min={0} max={20} onChange={vitals.setFate} />
          </View>
        </Card>

        <Card style={[styles.vitalCol, { flexBasis: '28%' }]}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Soul</Text>
            <Pressable onPress={vitals.refreshResolve} hitSlop={6}>
              <Text style={styles.refreshLink}>↻ on motivation</Text>
            </Pressable>
          </View>
          <View style={[layoutStyles.row, { marginTop: 8, gap: 12, alignItems: 'center' }]}>
            <View>
              <Text style={styles.subUpper}>Resolve</Text>
              <Text style={[styles.medium, tabular]}>
                {vitals.resolve}<Text style={styles.bigCap}>/{vitals.resilience}</Text>
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Stepper value={vitals.resolve} min={0} max={vitals.resilience} onChange={vitals.setResolve} />
          </View>
          <View style={[layoutStyles.rowBetween, { marginTop: 10 }]}>
            <Text style={styles.subUpper}>Resilience</Text>
            <Stepper value={vitals.resilience} min={0} max={20} onChange={vitals.setResilience} />
          </View>
          <View style={styles.dividerLine} />
          <View style={layoutStyles.rowBetween}>
            <Text style={[styles.subUpper, { color: colors.corruption }]}>
              Corruption {vitals.corruption}/{corrThresh}
            </Text>
            <Stepper value={vitals.corruption} min={0} max={99} onChange={vitals.setCorruption} />
          </View>
          <Bar value={corrThresh > 0 ? Math.min(1, vitals.corruption / corrThresh) : 0} variant="corr" style={{ marginTop: 10 }} />
        </Card>
      </View>

      <View style={[styles.twoCol, { marginTop: 12 }]}>
        <Card tight style={{ flex: 1 }}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Movement</Text>
            <Text style={[styles.metaMono, { fontSize: 10 }]}>M {c.movement}</Text>
          </View>
          <View style={[layoutStyles.row, { marginTop: 10, gap: 18 }]}>
            <MoveCell label="Walk" v={c.movement * 2} />
            <View style={layoutStyles.vr} />
            <MoveCell label="Run" v={c.movement * 4} />
            <View style={layoutStyles.vr} />
            <MoveCell label="SB" v={sb} />
            <View style={layoutStyles.vr} />
            <MoveCell label="TB" v={tb} />
          </View>
        </Card>

        <Card tight style={{ flex: 1 }}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Experience</Text>
            <Text style={[styles.metaMono, { fontSize: 10 }]}>{xpTotal} TOTAL</Text>
          </View>
          <View style={[layoutStyles.row, { alignItems: 'baseline', gap: 10, marginTop: 8 }]}>
            <Text style={[styles.xpBig, tabular]}>{xp.current}</Text>
            <Text style={styles.muted}>spendable</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.muted}>{xp.spent} spent</Text>
          </View>
          <Bar value={xpTotal === 0 ? 0 : xp.spent / xpTotal} variant="brass" style={{ marginTop: 10 }} />
        </Card>
      </View>

      <Section title="Current Conditions" aside="tap to apply · long-press for rule" />
      <View style={styles.chips}>
        {names.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
        })}
      </View>

      <Section title="Party" aside={c.party.name} />
      <Card>
        <Text style={styles.party}>
          <Text style={styles.partyDrop}>{c.party.short[0]}</Text>
          {c.party.short.slice(1)}
        </Text>
        <View style={styles.partyGrid}>
          {c.party.members.map(m => (
            <View key={m.name} style={styles.partyMember}>
              <Avatar
                initials={m.name.split(' ').map(s => s[0]).join('')}
                size={32}
                fontSize={13}
              />
              <View style={{ minWidth: 0, flex: 1 }}>
                <Text style={styles.partyName}>{m.name}</Text>
                <Text style={styles.partyRole}>{m.role}</Text>
              </View>
            </View>
          ))}
        </View>
      </Card>
    </ScreenContainer>
  );
};

const MoveCell: React.FC<{ label: string; v: number }> = ({ label, v }) => (
  <View>
    <Text style={styles.moveLabel}>{label}</Text>
    <Text style={[styles.moveValue, tabular]}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({
  subText: { fontSize: 13, color: colors.ink2, fontFamily: fontFamilies.body },
  subSep: { color: colors.ink4 },
  vitalsGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  vitalCol: { flexGrow: 1, minWidth: 280 },
  twoCol: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  sub: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
    marginTop: 3,
  },
  subUpper: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  bigEmpire: {
    fontFamily: fontFamilies.display,
    fontSize: 60,
    lineHeight: 56,
    color: colors.empire,
  },
  bigBrass: {
    fontFamily: fontFamilies.display,
    fontSize: 48,
    lineHeight: 42,
    color: colors.brass,
  },
  bigFrac: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 22,
    color: colors.ink3,
  },
  bigCap: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 18,
    color: colors.ink3,
  },
  refreshLink: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 10.5,
    color: colors.brass,
    letterSpacing: 0.4,
  },
  medium: {
    fontFamily: fontFamilies.display,
    fontSize: 30,
    lineHeight: 30,
    color: colors.ink,
  },
  soulGrid: { flexDirection: 'row', gap: 8, marginTop: 10 },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  dividerLine: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: 10,
    marginBottom: 8,
  },
  moveLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  moveValue: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    lineHeight: 24,
    color: colors.ink,
    marginTop: 2,
  },
  xpBig: {
    fontFamily: fontFamilies.display,
    fontSize: 34,
    lineHeight: 30,
    color: colors.brass,
  },
  muted: { color: colors.ink3, fontSize: 12, fontFamily: fontFamilies.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -4 },
  party: {
    fontSize: 13,
    color: colors.ink2,
    lineHeight: 20,
    marginBottom: 14,
    fontFamily: fontFamilies.body,
  },
  partyDrop: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 38,
    color: colors.empire,
    lineHeight: 36,
  },
  partyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  partyMember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 4,
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 200,
  },
  partyName: {
    fontFamily: fontFamilies.display,
    fontSize: 14,
    color: colors.ink,
  },
  partyRole: {
    fontSize: 11,
    color: colors.ink3,
    fontFamily: fontFamilies.body,
  },
});
