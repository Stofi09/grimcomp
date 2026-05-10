import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

const STEPS = ['Species', 'Class', 'Career', 'Characteristics', 'Skills', 'Trappings', 'Review'];

interface Method { name: string; sub: string; icon: IconName; }

const METHODS: Method[] = [
  { name: 'Roll', sub: '2d10 + 20 · the lucky and the doomed', icon: 'dice' },
  { name: 'Point Buy', sub: '100 points across 10 chars.', icon: 'grid' },
  { name: 'Template', sub: 'Roadwarden — recommended starter', icon: 'scroll' },
];

export const NewCharScreen: React.FC = () => {
  const [active, setActive] = useState(3);
  const [method, setMethod] = useState('Point Buy');

  return (
    <ScreenContainer>
      <Hero
        title="New character"
        subRow={<Text style={styles.sub}>Step by step — you can go back at any point.</Text>}
      />

      <View style={styles.steps}>
        {STEPS.map((s, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <Pressable
              key={s}
              style={styles.stepCell}
              onPress={() => setActive(i)}
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

      <Card>
        <Text style={styles.label}>Step {active + 1}</Text>
        <Text style={styles.heading}>{STEPS[active]}</Text>
        <Text style={styles.body}>
          Pick a method: roll (2d10+20 for ten characteristics), point buy, or use a template.
        </Text>

        <View style={styles.methods}>
          {METHODS.map(m => {
            const on = method === m.name;
            return (
              <Pressable
                key={m.name}
                style={styles.methodCellWrap}
                onPress={() => setMethod(m.name)}
                hitSlop={4}
              >
                <Card
                  tight
                  style={[
                    styles.methodCell,
                    on ? { borderColor: colors.brass } : null,
                  ]}
                >
                  <Icon name={m.icon} size={18} color={colors.ink} />
                  <Text style={styles.methodTitle}>{m.name}</Text>
                  <Text style={styles.methodSub}>{m.sub}</Text>
                </Card>
              </Pressable>
            );
          })}
        </View>

        <View style={[layoutStyles.rowBetween, { marginTop: 20 }]}>
          <Button
            variant="ghost"
            onPress={() => setActive(a => Math.max(0, a - 1))}
            disabled={active === 0}
          >
            ← {STEPS[Math.max(0, active - 1)]}
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              if (active < STEPS.length - 1) setActive(a => a + 1);
              else Alert.alert('Done', 'New character created (mock).');
            }}
          >
            {active < STEPS.length - 1 ? `${STEPS[active + 1]} →` : 'Finish'}
          </Button>
        </View>
      </Card>
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
  methods: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 16,
  },
  methodCellWrap: {
    flex: 1,
    minWidth: 180,
  },
  methodCell: {
    flex: 1,
  },
  methodTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 8,
  },
  methodSub: {
    fontSize: 12,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
  },
});
