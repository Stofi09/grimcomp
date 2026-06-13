import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type CharacteristicKey } from '@/data/character';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useXp } from '@/hooks/useXp';
import { useConditions } from '@/hooks/useConditions';
import { useXpRules, useSystemRules } from '@/content/useContent';
import type { XpCostBand } from '@/content/types';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Stat } from '@/components/Stat';
import { Stepper } from '@/components/Stepper';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors } from '@/theme';
import { Alert } from '@/ui/alert';
import './CharacteristicsScreen.css';

// Display label for a cost band ("0–5", or "46+" for the open-ended top band).
const bandRange = (b: XpCostBand) => (b.max >= 999 ? `${b.min}+` : `${b.min}–${b.max}`);

export const CharacteristicsScreen: React.FC = () => {
  const { list, get, adjust } = useCharacteristics();
  const xp = useXp();
  const { modifier: condMod } = useConditions();
  const xpRules = useXpRules();
  const system = useSystemRules();
  const bands = xpRules.characteristicAdvances;
  const buyStep = xpRules.buyStep;

  // Per-advance (+1) XP cost from the registry ladder, keyed by how many
  // advances have already been bought: the band whose [min, max] covers adv.
  const bandIndexFor = (adv: number) => {
    const i = bands.findIndex(b => adv >= b.min && adv <= b.max);
    return i >= 0 ? i : bands.length - 1;
  };
  const perAdvance = (adv: number) => bands[bandIndexFor(adv)]?.cost ?? 0;
  // A purchase raises the characteristic by +buyStep — five advances, all within
  // the same band — so it costs buyStep times the per-advance rate.
  const stepCost = (adv: number) => buyStep * perAdvance(adv);

  const test = (key: CharacteristicKey) => {
    const c = list.find(x => x.key === key)!;
    const r = resolveTest({ target: c.current, modifier: condMod.total, label: c.name }, system.test);
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    Alert.alert(
      `${c.name} — ${outcomeLabel(r.outcome)}`,
      formatTestResult(r) + condLine,
    );
  };

  // The "suggested" focus is the roster's first characteristic — pack-defined
  // roster order decides, so non-WFRP stat sets work unchanged.
  const suggest = list[0];
  const advNow = get(suggest.key);
  const cost = stepCost(advNow);
  const highlightIdx = bandIndexFor(advNow);

  const buy = (key: CharacteristicKey) => {
    const c = list.find(x => x.key === key)!;
    const cur = get(key);
    const next = cur + buyStep;
    const cost = stepCost(cur);
    const reason = `${c.name} +${cur} → +${next}`;
    const r = xp.spend(cost, reason, 'char');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    adjust(key, +buyStep);
    Alert.alert('Bought advance', r.message);
  };

  // Per-characteristic stepper: +buyStep buys the next advance, −buyStep
  // refunds the last one. Refund only credits XP when a matching purchase
  // exists in the log, so template-granted advances can't be sold for free XP
  // (and stay put when there's nothing to reverse).
  const onAdvChange = (key: CharacteristicKey, current: number, next: number) => {
    const cmeta = list.find(x => x.key === key)!;
    if (next > current) {
      buy(key);
    } else if (next < current) {
      const cost = stepCost(next);
      const r = xp.refund(cost, `${cmeta.name} +${next} → +${current}`, 'char');
      if (!r.ok) {
        Alert.alert('Cannot refund', `${r.message} Only advances bought this session can be refunded.`);
        return;
      }
      adjust(key, -buyStep);
    }
  };

  const pickOther = () => {
    // Quick "buy any characteristic +buyStep" picker. Lists each one with
    // current adv + bracket cost; tapping a button fires the buy.
    const buttons = list
      .filter(c => c.key !== suggest.key)
      .map(c => ({
        text: `${c.name} (+${c.adv} → +${c.adv + buyStep}) · ${stepCost(c.adv)} XP`,
        onPress: () => buy(c.key),
      }));
    Alert.alert(
      'Buy another characteristic',
      `Pick one to advance by +${buyStep}.`,
      [...buttons, { text: 'Cancel', style: 'cancel' }],
    );
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 2 — Characteristics"
        title="Characteristics"
        subRow={
          <>
            <span className="chr-sub">Initial + advances = current.</span>
            <span className="chr-sep">·</span>
            <span className="chr-sub">Bonus = {system.formulas.bonus}.</span>
            <span className="chr-sep">·</span>
            <span className="chr-sub">{xp.current} XP available</span>
          </>
        }
      />

      <Section title="Profile" />

      <div className="chr-stats-grid">
        {list.map(x => (
          <div key={x.key} className="chr-stat-cell">
            <button
              type="button"
              className="btn-reset chr-stat-test"
              onClick={() => test(x.key)}
            >
              <Stat c={x} suggested={x.key === suggest.key} />
            </button>
            <div className="chr-stat-buy">
              <Stepper
                value={x.adv}
                step={buyStep}
                min={0}
                max={40}
                onChange={(next) => onAdvChange(x.key, x.adv, next)}
              />
              <span className="chr-stat-cost">{stepCost(x.adv)} XP</span>
            </div>
          </div>
        ))}
      </div>

      <Section title="Buy advances" aside={`per advance · one purchase = +${buyStep}`} />

      <div className="chr-purchase-row">
        <Card flush style={{ flex: 1, minWidth: 320 }}>
          <CardHead title="Cost bands" meta="per advance · xp" />
          <Table>
            <TableRow header>
              <Cell header flex={1}>Advance</Cell>
              <Cell header num flex={0.6}>XP</Cell>
              <Cell header flex={1.4}>Note</Cell>
            </TableRow>
            {bands.map((b, i) => {
              const highlight = i === highlightIdx;
              return (
                <TableRow key={bandRange(b)} last={i === bands.length - 1} style={highlight ? { backgroundColor: colors.brassHighlight } : null}>
                  <Cell flex={1}>{bandRange(b)}</Cell>
                  <Cell num flex={0.6} textStyle={highlight ? { color: colors.brass, fontFamily: 'var(--font-body)', fontWeight: 600 } : null}>
                    {b.cost}
                  </Cell>
                  <Cell flex={1.4} textStyle={{ color: colors.ink3, fontSize: 11 }}>
                    {highlight ? `← ${suggest.name} is here` : ''}
                  </Cell>
                </TableRow>
              );
            })}
          </Table>
        </Card>

        <Card bordered style={{ flex: 1.1, minWidth: 320 }}>
          <div className="chr-suggest-eyebrow-wrap">
            <span className="chr-eyebrow">Suggested purchase</span>
          </div>
          <div className="chr-row-between chr-suggest-title-row">
            <span className="chr-suggest-title">
              {suggest.name} <span className="chr-suggest-plus">+{buyStep}</span>
            </span>
            <Pill variant="success" iconLeft={<Icon name="check" size={11} color={colors.success} />}>
              in career path
            </Pill>
          </div>
          <p className="chr-muted chr-muted-blurb">
            Career ranks can require skill and characteristic advances. You're at +{suggest.adv}; another +{buyStep} builds a buffer.
          </p>
          <div className="chr-divider" />
          <div className="chr-suggest-row">
            <div className="chr-suggest-col">
              <span className="chr-mini-label">NOW</span>
              <span className="chr-big-num tabular">{suggest.current}</span>
            </div>
            <span className="chr-arrow">→</span>
            <div className="chr-suggest-col">
              <span className="chr-mini-label">AFTER +{buyStep}</span>
              <span className="chr-big-num chr-big-num--brass tabular">{suggest.current + buyStep}</span>
            </div>
            <div className="chr-suggest-col">
              <span className="chr-mini-label">COST</span>
              <span className="chr-big-num tabular">{cost}<span className="chr-cost-unit"> xp</span></span>
            </div>
          </div>
          <div className="chr-buy-row">
            <Button
              variant="primary"
              large
              style={{ flex: 1, justifyContent: 'center' }}
              onPress={() => buy(suggest.key)}
            >
              Buy · {cost} XP
            </Button>
            <Button variant="ghost" onPress={pickOther}>
              Other…
            </Button>
          </div>
        </Card>
      </div>
    </ScreenContainer>
  );
};
