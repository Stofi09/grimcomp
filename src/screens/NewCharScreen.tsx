import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, TextInput } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { Pill } from '@/components/Pill';
import { useStoredState } from '@/hooks/useStoredState';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import { CHARACTER_TEMPLATES, type Character, type CharacteristicKey } from '@/data/character';
import type { ScreenId } from '@/data/nav';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles, tabular } from '@/components/primitives';

interface Props {
  onNav: (id: ScreenId) => void;
}

const STEPS = ['Name', 'Archetype', 'Stats', 'Review'];

interface Archetype {
  key: string;
  /** Template id to clone from. */
  source: string;
  label: string;
  blurb: string;
  icon: IconName;
}

// Archetypes mirror our four built-in templates. Cloning preserves the
// template's class, career, careerRanks, skills, weapons, etc.
const ARCHETYPES: Archetype[] = [
  { key: 'warrior', source: 'c1', label: 'Warrior',  blurb: 'Roadwarden / soldier. Strong, tough, melee-leaning.', icon: 'sword' },
  { key: 'wizard',  source: 'c2', label: 'Wizard',   blurb: 'Bright Order pyromancer. Casts spells, channels Aqshy.', icon: 'sparkle' },
  { key: 'priest',  source: 'c4', label: 'Priest',   blurb: 'Anointed of Shallya. Heals, blesses, intercedes.', icon: 'flame' },
  { key: 'crafter', source: 'c3', label: 'Crafter',  blurb: 'Dwarf runesmith. Steady, runebound, wound-pool tank.', icon: 'shield' },
];

const SPECIES = ['Human', 'Dwarf', 'Halfling', 'High Elf', 'Wood Elf'];

interface Draft {
  name: string;
  species: string;
  archetypeKey: string;
  /** Per-characteristic initial value override (replaces template's `init`). */
  inits: Partial<Record<CharacteristicKey, number>>;
}

const emptyDraft: Draft = {
  name: '',
  species: 'Human',
  archetypeKey: 'warrior',
  inits: {},
};

// 2d10 + 20 = WFRP 4e starting characteristic generation.
const roll2d10p20 = () => Math.ceil(Math.random() * 10) + Math.ceil(Math.random() * 10) + 20;

const rerollInits = (): Draft['inits'] => {
  const keys: CharacteristicKey[] = ['ws','bs','s','t','i','ag','dex','int','wp','fel'];
  const out: Draft['inits'] = {};
  for (const k of keys) out[k] = roll2d10p20();
  return out;
};

/** Take an archetype's source template and apply the draft (name, species, inits). */
const buildCharacter = (draft: Draft, newId: string): Character => {
  const arch = ARCHETYPES.find(a => a.key === draft.archetypeKey) ?? ARCHETYPES[0];
  const src = CHARACTER_TEMPLATES[arch.source];

  const characteristics = src.characteristics.map(c => ({
    ...c,
    init: draft.inits[c.key] ?? c.init,
    adv: 0,
  }));

  const initials = draft.name.split(/\s+/).filter(Boolean).map(s => s[0]?.toUpperCase()).join('').slice(0, 2) || 'XX';

  // Fresh wounds = SB + 2×TB + WPB
  const tens = (k: CharacteristicKey) => {
    const c = characteristics.find(x => x.key === k)!;
    return Math.floor(c.init / 10);
  };
  const wMax = tens('s') + 2 * tens('t') + tens('wp');

  return {
    ...src,
    id: newId,
    name: draft.name.trim() || `New ${arch.label}`,
    species: draft.species,
    initials,
    characteristics,
    // Fresh-character defaults — clear out the source character's history.
    xpCurrent: 0,
    xpSpent: 0,
    wounds: { current: wMax, max: wMax },
    corruption: 0,
    sin: 0,
    careerLevel: 1,
    careerLevelName: src.careerRanks[0]?.name ?? src.careerLevelName,
    status: src.careerRanks[0]?.status ?? src.status,
    conditions: [],
    criticals: [],
    talents: src.talents.map(t => ({ ...t, times: Math.max(1, t.times) })),
  };
};

export const NewCharScreen: React.FC<Props> = ({ onNav }) => {
  const { add, nextId } = useRoster();
  const { setActive } = useCharacter();

  // Wizard step + draft are persisted so the user can come back to their
  // half-finished character.
  const [step, setStep] = useStoredState('gc.newchar.step', 0);
  const [draft, setDraft] = useStoredState<Draft>('gc.newchar.draft', emptyDraft);

  const arch = ARCHETYPES.find(a => a.key === draft.archetypeKey) ?? ARCHETYPES[0];
  const srcTpl = CHARACTER_TEMPLATES[arch.source];

  // Preview the would-be character so the Review step shows live values.
  const preview = buildCharacter(draft, 'preview');

  const canProceed = (() => {
    if (step === 0) return draft.name.trim().length > 0;
    if (step === 2) return Object.keys(draft.inits).length === 10;
    return true;
  })();

  const finish = () => {
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Please give your character a name first.');
      return;
    }
    if (Object.keys(draft.inits).length !== 10) {
      Alert.alert('Roll your stats', 'Tap "Reroll" on the Stats step before finishing.');
      return;
    }
    const id = nextId();
    const c = buildCharacter(draft, id);
    add(c);
    setActive(id);
    // Reset draft so the wizard is fresh next time.
    setDraft(emptyDraft);
    setStep(0);
    Alert.alert(
      'Character created',
      `${c.name} is ready. Switched to them as the active character.`,
      [{ text: 'Open Overview', onPress: () => onNav('overview') }],
    );
  };

  return (
    <ScreenContainer>
      <Hero
        title="New character"
        subRow={<Text style={styles.sub}>Step by step — you can go back at any point.</Text>}
      />

      <View style={styles.steps}>
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <Pressable
              key={s}
              style={styles.stepCell}
              onPress={() => setStep(i)}
              hitSlop={4}
            >
              <View
                style={[
                  styles.line,
                  {
                    backgroundColor: done ? colors.brass : colors.divider,
                    left: i === 0 ? '50%' : 0,
                    right: i === STEPS.length - 1 ? '50%' : 0,
                  },
                ]}
              />
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? colors.brass : current ? colors.empire : colors.surface,
                    borderColor: done ? colors.brass : current ? colors.empireDeep : colors.border,
                    borderWidth: current ? 2 : 1,
                  },
                ]}
              >
                <Text style={[styles.dotText, { color: done || current ? '#fff' : colors.ink3 }]}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[styles.stepLabel, current ? styles.stepLabelCurrent : null]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>

      {step === 0 ? (
        <Card>
          <Text style={styles.label}>Step 1</Text>
          <Text style={styles.heading}>Name & species</Text>
          <Text style={styles.body}>What does your character call themselves, and what people are they?</Text>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(t) => setDraft(d => ({ ...d, name: t }))}
            placeholder="e.g. Magnus Brenner"
            placeholderTextColor={colors.ink4}
            autoCorrect={false}
            autoCapitalize="words"
          />

          <Text style={styles.fieldLabel}>Species</Text>
          <View style={styles.optionsRow}>
            {SPECIES.map(sp => {
              const on = draft.species === sp;
              return (
                <Pressable
                  key={sp}
                  onPress={() => setDraft(d => ({ ...d, species: sp }))}
                  style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.7 }]}
                  hitSlop={4}
                >
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{sp}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <Text style={styles.label}>Step 2</Text>
          <Text style={styles.heading}>Archetype</Text>
          <Text style={styles.body}>
            Pick the kind of adventurer they are. Skills, weapons, and starting talents come from this choice.
          </Text>

          <View style={styles.archGrid}>
            {ARCHETYPES.map(a => {
              const on = draft.archetypeKey === a.key;
              return (
                <Pressable
                  key={a.key}
                  style={({ pressed }) => [styles.archCellWrap, pressed && { opacity: 0.7 }]}
                  onPress={() => setDraft(d => ({ ...d, archetypeKey: a.key }))}
                  hitSlop={4}
                >
                  <Card tight style={[styles.archCell, on ? { borderColor: colors.brass } : null]}>
                    <View style={layoutStyles.rowBetween}>
                      <Icon name={a.icon} size={20} color={on ? colors.brass : colors.ink2} />
                      {on ? <Pill variant="brass" size={10}>PICKED</Pill> : null}
                    </View>
                    <Text style={styles.archTitle}>{a.label}</Text>
                    <Text style={styles.archSub}>{a.blurb}</Text>
                    <Text style={styles.archMeta}>Starts as {CHARACTER_TEMPLATES[a.source].career}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <Text style={styles.label}>Step 3</Text>
          <Text style={styles.heading}>Roll characteristics</Text>
          <Text style={styles.body}>
            WFRP 4e starting stats are 2d10 + 20 per characteristic. Tap reroll until you get something you can
            live with — or stick with what the dice gave you the first time.
          </Text>

          <View style={[layoutStyles.row, { marginTop: 14, gap: 8 }]}>
            <Button variant="primary" iconLeft={<Icon name="dice" size={13} color={colors.ivory} />} onPress={() => setDraft(d => ({ ...d, inits: rerollInits() }))}>
              {Object.keys(draft.inits).length === 0 ? 'Roll stats' : 'Reroll'}
            </Button>
            {Object.keys(draft.inits).length > 0 ? (
              <Text style={styles.totalLine}>
                Total: <Text style={[styles.totalNum, tabular]}>{Object.values(draft.inits).reduce((a, b) => a + (b ?? 0), 0)}</Text>
              </Text>
            ) : null}
          </View>

          {Object.keys(draft.inits).length > 0 ? (
            <View style={styles.statsGrid}>
              {srcTpl.characteristics.map(c => (
                <View key={c.key} style={styles.statCell}>
                  <Text style={styles.statKey}>{c.short}</Text>
                  <Text style={[styles.statNum, tabular]}>{draft.inits[c.key]}</Text>
                  <Text style={styles.statName}>{c.name}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.body, { marginTop: 14, fontStyle: 'italic' }]}>
              Press "Roll stats" to generate your character's profile.
            </Text>
          )}
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <Text style={styles.label}>Step 4</Text>
          <Text style={styles.heading}>Review</Text>

          <View style={[layoutStyles.row, { gap: 14, marginTop: 14, alignItems: 'flex-start' }]}>
            <Avatar
              initials={preview.initials}
              accent={arch.key === 'wizard' ? '#9a7d1f' : arch.key === 'priest' ? '#3d6b3d' : arch.key === 'crafter' ? '#6a5612' : '#8b2d2d'}
              size={64}
              fontSize={24}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.previewName}>{preview.name}</Text>
              <Text style={styles.previewMeta}>
                {preview.species} · {preview.career} · rank {preview.careerLevel} · {preview.status}
              </Text>
              <Text style={styles.previewMeta}>
                Wounds {preview.wounds.max} · {preview.skills.filter(s => s.career).length} career skills · {preview.talents.length} talents
              </Text>
              {arch.key === 'wizard' || arch.key === 'priest' ? (
                <Text style={[styles.previewMeta, { marginTop: 4, color: colors.brass }]}>
                  {arch.key === 'wizard' ? 'Spellcaster — Magic screen will activate' : 'Anointed — Faith screen will activate'}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.statsGrid}>
            {preview.characteristics.map(c => (
              <View key={c.key} style={styles.statCell}>
                <Text style={styles.statKey}>{c.short}</Text>
                <Text style={[styles.statNum, tabular]}>{c.init}</Text>
                <Text style={styles.statName}>{c.name}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Section title=" " />
      <View style={[layoutStyles.rowBetween, { marginTop: 4 }]}>
        <Button
          variant="ghost"
          onPress={() => setStep(a => Math.max(0, a - 1))}
          disabled={step === 0}
        >
          ← {STEPS[Math.max(0, step - 1)]}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            disabled={!canProceed}
            onPress={() => setStep(a => a + 1)}
          >
            {STEPS[step + 1]} →
          </Button>
        ) : (
          <Button
            variant="primary"
            onPress={finish}
            iconLeft={<Icon name="check" size={13} color={colors.ivory} />}
          >
            Finish & switch
          </Button>
        )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  steps: {
    flexDirection: 'row',
    gap: 0,
    marginVertical: 24,
  },
  stepCell: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  line: {
    height: 2,
    position: 'absolute',
    top: 14,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  dotText: {
    fontFamily: fontFamilies.display,
    fontSize: 13,
  },
  stepLabel: {
    marginTop: 6,
    fontSize: 11,
    color: colors.ink3,
    fontFamily: fontFamilies.body,
    textAlign: 'center',
  },
  stepLabelCurrent: {
    color: colors.ink,
    fontFamily: fontFamilies.bodySemibold,
  },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  heading: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 4,
  },
  body: {
    color: colors.ink3,
    fontSize: 13,
    marginTop: 4,
    fontFamily: fontFamilies.body,
    lineHeight: 19,
  },
  fieldLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
  },
  optionOn: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  optionText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    color: colors.ink2,
  },
  optionTextOn: { color: colors.bone },
  archGrid: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 16,
  },
  archCellWrap: { flex: 1, minWidth: 200 },
  archCell: { flex: 1 },
  archTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 8,
  },
  archSub: {
    fontSize: 12,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
    lineHeight: 17,
  },
  archMeta: {
    fontSize: 10,
    fontFamily: fontFamilies.mono,
    color: colors.brass,
    marginTop: 8,
    letterSpacing: 0.6,
  },
  totalLine: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
    color: colors.ink3,
    alignSelf: 'center',
  },
  totalNum: {
    fontFamily: fontFamilies.monoMedium,
    color: colors.ink,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    marginTop: 16,
  },
  statCell: {
    width: '20%',
    paddingHorizontal: 6,
    paddingBottom: 12,
    alignItems: 'center',
  },
  statKey: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 9,
    color: colors.ink3,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  statNum: {
    fontFamily: fontFamilies.display,
    fontSize: 28,
    color: colors.ink,
    lineHeight: 28,
    marginTop: 4,
  },
  statName: {
    fontFamily: fontFamilies.body,
    fontSize: 10,
    color: colors.ink3,
    marginTop: 2,
    textAlign: 'center',
  },
  previewName: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 22,
    color: colors.ink,
  },
  previewMeta: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    marginTop: 2,
  },
});
