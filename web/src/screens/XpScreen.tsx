import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type XpKind } from '@/data/character';
import { useXp } from '@/hooks/useXp';
import { useXpRules } from '@/content/useContent';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Counter } from '@/components/Counter';
import { Card } from '@/components/Card';
import { Pill, type PillVariant } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Alert } from '@/ui/alert';
import { colors } from '@/theme';
import './XpScreen.css';

const KIND_VARIANT: Record<XpKind, PillVariant> = {
  gain: 'success',
  career: 'empire',
  talent: 'brass',
  skill: 'ghost',
  char: 'ghost',
};

const KIND_LABEL: Record<XpKind, string> = {
  gain: 'Gain',
  skill: 'Skill',
  char: 'Char.',
  talent: 'Talent',
  career: 'Career',
};

export const XpScreen: React.FC = () => {
  const xp = useXp();
  // Quick-award amounts come from the content registry (xpRules.quickAwards).
  const quickGains = useXpRules().quickAwards;

  const award = (amount: number) => {
    const r = xp.gain(amount, 'Session reward');
    Alert.alert('XP awarded', r.message);
  };

  return (
    <ScreenContainer>
      <Hero
        title="XP Log"
        subRow={<span className="xp-sub">Every XP gain and spend is recorded here.</span>}
        actions={
          <Button
            variant="brass"
            iconLeft={<Icon name="plus" size={13} color="#2a2010" />}
            onPress={() => {
              Alert.alert(
                'Award session XP',
                'Pick an amount to add as a session reward.',
                [
                  ...quickGains.map(n => ({ text: `+${n} XP`, onPress: () => award(n) })),
                  { text: 'Cancel', style: 'cancel' as const },
                ],
              );
            }}
          >
            Award XP
          </Button>
        }
      />

      <div className="xp-row">
        <Counter label="Spendable" sub="now" value={xp.current} variant="fate" style={{ flex: 1 }} />
        <Counter label="Spent" sub="lifetime" value={xp.spent} style={{ flex: 1 }} />
        <Counter label="Total earned" sub="play time" value={xp.total} style={{ flex: 1 }} />
      </div>

      <Section title="Log" aside="newest first" />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={1}>Date</Cell>
            <Cell header flex={3}>Reason</Cell>
            <Cell header flex={1.2}>Kind</Cell>
            <Cell header num flex={0.8}>XP</Cell>
          </TableRow>
          {xp.log.map((e, i) => (
            <TableRow key={i} last={i === xp.log.length - 1}>
              <Cell flex={1} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>
                {e.date}
              </Cell>
              <Cell flex={3}>{e.reason}</Cell>
              <Cell flex={1.2}>
                <Pill variant={KIND_VARIANT[e.kind]} size={10}>{KIND_LABEL[e.kind]}</Pill>
              </Cell>
              <Cell
                num
                flex={0.8}
                textStyle={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  color: e.amount > 0 ? colors.success : colors.ink,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {e.amount > 0 ? `+${e.amount}` : `${e.amount}`}
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};
