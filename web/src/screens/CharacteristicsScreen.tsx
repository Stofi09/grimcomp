import { useRecordTest } from '@/hooks/useRecordTest';
import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type CharacteristicKey } from '@/data/character';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useCharacter } from '@/hooks/useCharacter';
import { useXp } from '@/hooks/useXp';
import { runStoredTransaction } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useXpRules, useSystemRules, useCareers } from '@/content/useContent';
import type { XpCostBand } from '@/content/types';
import { resolveTest, formatTestResult, resultLabel } from '@/utils/roll';
import { isCareerCharacteristic, characteristicAdvanceCost } from '@/utils/advancement';
import { careerDefForCharacter } from '@/utils/careers';
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
import { Alert } from '@/ui/alertStore';
import { useProgressionActionGuard } from './useProgressionActionGuard';
import './CharacteristicsScreen.css';

// Display label for a cost band ("0–5", or "46+" for the open-ended top band).
const bandRange = (b: XpCostBand) => (b.max >= 999 ? `${b.min}+` : `${b.min}–${b.max}`);

export const CharacteristicsScreen: React.FC = () => {
  const { list, get, adjust } = useCharacteristics();
  const { template: char } = useCharacter();
  const xp = useXp();
  const recordTest = useRecordTest();
  const { modifier: condMod } = useConditions();
  const xpRules = useXpRules();
  const system = useSystemRules();
  const careers = useCareers();
  const beginProgressionAction = useProgressionActionGuard();
  const bands = xpRules.characteristicAdvances;
  const buyStep = xpRules.buyStep;

  // The character's current Career (stable id first, legacy name second)
  // supplies the advance scheme: a characteristic outside it is a non-career advance and costs the
  // xpRules.nonCareerCharacteristicMultiplier. No scheme → all in-career.
  const registryCareer = careerDefForCharacter(careers, char);
  const nonCareerMult = xpRules.nonCareerCharacteristicMultiplier;
  const inCareer = (key: CharacteristicKey) => isCareerCharacteristic(registryCareer, key);
  const hasScheme = (registryCareer?.advanceScheme?.characteristics?.length ?? 0) > 0;

  // Per-advance (+1) XP cost from the registry ladder, keyed by how many
  // advances have already been bought: the band whose [min, max] covers adv.
  const bandIndexFor = (adv: number) => {
    const i = bands.findIndex(b => adv >= b.min && adv <= b.max);
    return i >= 0 ? i : bands.length - 1;
  };
  const perAdvance = (adv: number) => bands[bandIndexFor(adv)]?.cost ?? 0;
  // Sum every individual advance because a +buyStep purchase can cross a cost
  // band (for example +5 → +10 starts with one point in 0–5, then four in 6–10).
  const baseStepCost = (adv: number) => {
    let total = 0;
    for (let offset = 0; offset < buyStep; offset += 1) {
      total += perAdvance(adv + offset);
    }
    return total;
  };
  // Non-career pricing applies after the correctly banded total is known.
  const stepCost = (adv: number, key: CharacteristicKey) =>
    characteristicAdvanceCost(baseStepCost(adv), inCareer(key), nonCareerMult);

  const test = (key: CharacteristicKey) => {
    const c = list.find(x => x.key === key)!;
    const r = resolveTest({ target: c.current, modifier: condMod.total, label: c.name }, system.test);
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    recordTest(r, condLine);
    Alert.alert(
      `${c.name} — ${resultLabel(r)}`,
      formatTestResult(r) + condLine,
    );
  };

  // The "suggested" focus is the roster's first characteristic — pack-defined
  // roster order decides, so non-WFRP stat sets work unchanged.
  const suggest = list[0];
  const advNow = get(suggest.key);
  const cost = stepCost(advNow, suggest.key);
  const highlightIdx = bandIndexFor(advNow);

  const buy = (key: CharacteristicKey) => {
    const action = beginProgressionAction(`characteristic:${key}`);
    if (!action) return;

    const cmeta = list.find(x => x.key === key)!;
    const cur = get(key);
    const next = cur + buyStep;
    const cost = stepCost(cur, key);
    const tag = inCareer(key) ? '' : ' [non-career]';
    const reason = `${cmeta.name} +${cur} → +${next}${tag}`;
    const transaction = runStoredTransaction(() => {
      const result = xp.spend(cost, reason, 'char');
      if (result.ok) adjust(key, +buyStep);
      return result;
    });
    if (!transaction.value?.ok) {
      void transaction.completion.then(
        (durability) => {
          action.release();
          if (!durability.ok) Alert.alert('Could not save purchase', durability.error.message);
        },
        () => action.release(),
      );
      if (transaction.value) Alert.alert('Not enough XP', transaction.value.message);
      return;
    }
    void transaction.completion.then(
      (durability) => {
        action.release();
        if (durability.ok) Alert.alert('Bought advance', transaction.value.message);
        else Alert.alert('Could not save purchase', durability.error.message);
      },
      () => action.release(),
    );
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
      const action = beginProgressionAction(`characteristic:${key}`);
      if (!action) return;

      const cost = stepCost(next, key);
      const tag = inCareer(key) ? '' : ' [non-career]';
      const transaction = runStoredTransaction(() => {
        const result = xp.refund(cost, `${cmeta.name} +${next} → +${current}${tag}`, 'char');
        if (result.ok) adjust(key, -buyStep);
        return result;
      });
      void transaction.completion.then(
        (durability) => {
          action.release();
          if (!durability.ok) Alert.alert('Could not save refund', durability.error.message);
        },
        () => action.release(),
      );
      if (!transaction.value?.ok) {
        if (transaction.value) {
          Alert.alert('Cannot refund', `${transaction.value.message} Only advances bought this session can be refunded.`);
        }
        return;
      }
    }
  };

  const pickOther = () => {
    // Quick "buy any characteristic +buyStep" picker. Lists each one with
    // current adv + bracket cost; tapping a button fires the buy.
    const buttons = list
      .filter(cc => cc.key !== suggest.key)
      .map(cc => ({
        text: `${cc.name} (+${cc.adv} → +${cc.adv + buyStep}) · ${stepCost(cc.adv, cc.key)} XP${inCareer(cc.key) ? '' : ' ×2'}`,
        onPress: () => buy(cc.key),
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

      <div className="chr-stats-wrap">
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
                decreaseLabel={`Decrease ${x.name}`}
                increaseLabel={`Increase ${x.name}`}
                onChange={(next) => onAdvChange(x.key, x.adv, next)}
              />
              <span className="chr-stat-cost">
                {stepCost(x.adv, x.key)} XP{hasScheme && !inCareer(x.key) ? ' ·2×' : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
      </div>

      <Section title="Buy advances" aside={`per advance · one purchase = +${buyStep}`} />

      <div className="chr-purchase-row">
        <Card flush style={{ flex: 1, minWidth: 'min(320px, 100%)' }}>
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

        <Card bordered style={{ flex: 1.1, minWidth: 'min(320px, 100%)' }}>
          <div className="chr-suggest-eyebrow-wrap">
            <span className="chr-eyebrow">Suggested purchase</span>
          </div>
          <div className="chr-row-between chr-suggest-title-row">
            <span className="chr-suggest-title">
              {suggest.name} <span className="chr-suggest-plus">+{buyStep}</span>
            </span>
            {inCareer(suggest.key) ? (
              <Pill variant="success" iconLeft={<Icon name="check" size={11} color={colors.success} />}>
                in career scheme
              </Pill>
            ) : (
              <Pill variant="warn">non-career ×{nonCareerMult}</Pill>
            )}
          </div>
          <p className="chr-muted chr-muted-blurb">
            {hasScheme
              ? `Advances inside ${char.career}'s scheme cost the listed rate; those outside it cost ×${nonCareerMult}.`
              : `Career ranks can require skill and characteristic advances. You're at +${suggest.adv}; another +${buyStep} builds a buffer.`}
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
