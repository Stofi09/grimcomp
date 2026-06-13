import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useTalents } from '@/hooks/useTalents';
import { useXp } from '@/hooks/useXp';
import { useXpRules } from '@/content/useContent';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { Alert } from '@/ui/alert';
import { colors } from '@/theme';
import './TalentsScreen.css';

export const TalentsScreen: React.FC = () => {
  const { list, buyAnother, refundRank } = useTalents();
  const xp = useXp();
  const rules = useXpRules();

  // "Buy another rank" cost: talentCostPerRank × the new rank number
  // (WFRP 4e core p.49). Sourced from the content registry (xpRules).
  const talentCost = (currentTimes: number) => rules.talentCostPerRank * (currentTimes + 1);

  const buy = (name: string, currentTimes: number) => {
    const cost = talentCost(currentTimes);
    const reason = `${name} ×${currentTimes + 1}`;
    const r = xp.spend(cost, reason, 'talent');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    buyAnother(name);
    Alert.alert('Bought talent', r.message);
  };

  // Undo the most recent rank: refund the XP the matching purchase cost, then
  // step the rank down. The refund only succeeds if there's a real purchase in
  // the log, so template-granted ranks can't be sold back for free XP.
  const undo = (name: string, currentTimes: number) => {
    const cost = talentCost(currentTimes - 1);
    const r = xp.refund(cost, `${name} ×${currentTimes}`, 'talent');
    if (!r.ok) {
      Alert.alert('Cannot refund', `${r.message} Only ranks you bought this session can be refunded.`);
      return;
    }
    refundRank(name);
  };

  const onTimesChange = (name: string, currentTimes: number, next: number) => {
    if (next > currentTimes) buy(name, currentTimes);
    else if (next < currentTimes) undo(name, currentTimes);
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 4 — Talents"
        title="Talents"
        subRow={
          <>
            <span className="tal-sub">{list.length} acquired</span>
            <span className="tal-sep">·</span>
            <span className="tal-sub">passive effects and unlocks</span>
            <span className="tal-sep">·</span>
            <span className="tal-sub">{xp.current} XP available</span>
          </>
        }
      />

      <Section title="Active talents" />

      <div className="tal-grid">
        {list.map((t, i) => {
          const cost = talentCost(t.times);
          return (
            <Card key={i} style={{ flexBasis: '48%', flexGrow: 1, minWidth: 280 }}>
              <div className="tal-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div className="tal-title-row">
                    <span className="tal-name">{t.name}</span>
                    {t.career ? <Pill variant="empire" size={9.5}>career</Pill> : null}
                  </div>
                  <span className="tal-desc">{t.desc}</span>
                </div>
                <div className="tal-times-col">
                  <span className="tal-mini-label">TIMES</span>
                  <span className="tal-times">×{t.times}</span>
                </div>
              </div>
              <div className="tal-divider" />
              <div className="tal-row-between">
                <span className="tal-next">NEXT {cost} XP</span>
                <Stepper
                  value={t.times}
                  min={1}
                  step={1}
                  onChange={(next) => onTimesChange(t.name, t.times, next)}
                />
              </div>
            </Card>
          );
        })}

        <button
          type="button"
          className="btn-reset tal-cell tal-add"
          onClick={() => Alert.alert('New talent', '5 talents available in your career path. Picker not wired up.')}
        >
          <Card dashed style={{ flex: 1, width: '100%' }}>
            <div className="tal-empty">
              <Icon name="plus" size={20} color={colors.ink3} />
              <span className="tal-empty-title">New talent</span>
              <span className="tal-empty-sub">5 available in career</span>
            </div>
          </Card>
        </button>
      </div>
    </ScreenContainer>
  );
};
