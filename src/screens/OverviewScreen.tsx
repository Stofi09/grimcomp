import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER, CONDITIONS } from '@/data/character';
import { useConditions } from '@/hooks/useConditions';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useCareer } from '@/hooks/useCareer';
import { useStoredState } from '@/hooks/useStoredState';
import { Hero } from '@/components/Hero';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Bar, SegBar } from '@/components/Bar';
import { Chip } from '@/components/Chip';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const OverviewScreen: React.FC = () => {
  const c = CHARACTER;
  const xp = useXp();
  const career = useCareer();
  const { get: getChar } = useCharacteristics();
  const { conds, cycle } = useConditions();
  // Live wounds (for the segmented bar) — same key WoundsScreen writes to.
  const [wounds] = useStoredState('gc.wounds', c.wounds.current);

  const tb = Math.floor((c.characteristics.find(x => x.key === 't')!.init + getChar('t')) / 10);
  const sb = Math.floor((c.characteristics.find(x => x.key === 's')!.init + getChar('s')) / 10);
  const wpb = Math.floor((c.characteristics.find(x => x.key === 'wp')!.init + getChar('wp')) / 10);
  const xpTotal = xp.total;
  const corrThresh = Math.max(1, tb + wpb);

  return (
    <ScreenContainer>
      <Hero
        eyebrow={`The Eberfeld Road Wardens · Career ${career.level}/4`}
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
              <Text style={styles.sub}>SB {sb} + 2×TB {tb*2} + WPB {wpb} = {c.wounds.max}</Text>
            </View>
            <Text style={[styles.bigEmpire, tabular]}>
              {wounds}
              <Text style={styles.bigFrac}>/{c.wounds.max}</Text>
            </Text>
          </View>
          <SegBar total={c.wounds.max} filled={wounds} />
          <View style={[layoutStyles.rowBetween, { marginTop: 8 }]}>
            <Text style={styles.metaMono}>0 · CRITICAL</Text>
            <Text style={styles.metaMono}>{c.wounds.max} · FULL</Text>
          </View>
        </Card>

        <Card style={[styles.vitalCol, { flexBasis: '28%' }]}>
          <Text style={[styles.label, { color: colors.brass }]}>Fate & Fortune</Text>
          <View style={[layoutStyles.row, { marginTop: 8, alignItems: 'baseline', gap: 14 }]}>
            <View>
              <Text style={styles.subUpper}>Fate</Text>
              <Text style={[styles.bigBrass, tabular]}>{c.fate}</Text>
            </View>
            <View style={[layoutStyles.vr, { height: 50 }]} />
            <View>
              <Text style={styles.subUpper}>Fortune</Text>
              <Text style={[styles.bigBrass, tabular, { opacity: 0.75 }]}>{c.fortune}</Text>
            </View>
          </View>
          <View style={styles.dividerLine} />
          <Text style={[styles.subText, { fontStyle: 'italic', fontSize: 10.5, color: colors.ink3 }]}>
            Fortune refreshes at the start of each scene.
          </Text>
        </Card>

        <Card style={[styles.vitalCol, { flexBasis: '28%' }]}>
          <Text style={styles.label}>Soul</Text>
          <View style={styles.soulGrid}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subUpper}>Res. / Det.</Text>
              <Text style={[styles.medium, tabular]}>
                {c.resilience}
                <Text style={{ color: colors.ink3 }}>·{c.resolve}</Text>
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.subUpper, { color: colors.corruption }]}>Corruption</Text>
              <Text style={[styles.medium, tabular, { color: colors.corruption }]}>
                {c.corruption}<Text style={{ color: colors.ink3, fontSize: 14 }}>/{corrThresh}</Text>
              </Text>
            </View>
          </View>
          <Bar value={c.corruption / corrThresh} variant="corr" style={{ marginTop: 10 }} />
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
        {CONDITIONS.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
        })}
      </View>

      <Section title="Party" aside={c.party.name} />
      <Card>
        <Text style={styles.party}>
          <Text style={styles.partyDrop}>{c.party.short[0]}</Text>
          {c.party.short.slice(1)} The thaw makes the pass icy, but caravans still set out — Sigmund's company is hired for six days, gold paid in advance.
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
