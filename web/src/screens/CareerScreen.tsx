import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCareer } from '@/hooks/useCareer';
import { useXp } from '@/hooks/useXp';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCareers, useXpRules } from '@/content/useContent';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors } from '@/theme';
import { Alert } from '@/ui/alert';
import './CareerScreen.css';

export const CareerScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const career = useCareer();
  const xp = useXp();
  const careers = useCareers();
  // XP to advance to the next rank of the current career (WFRP 4e core p.49 →
  // 100 by default), sourced from the content registry's XP economy.
  const ADVANCE_COST = useXpRules().careerAdvanceCost;

  // Live skill advances per character.
  const [skillAdv] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );

  // Per-rank requirements come from the content registry: match the active
  // character's career name to a Career, then read the NEXT rank's required
  // skill advances. career.level is the *current* (1-based) rank, so the next
  // rank is at index career.level. Missing requirements leave advancement
  // unblocked and surface a placeholder.
  const registryCareer = careers.find(cr => cr.name === c.career);
  const nextRankReqs = registryCareer?.ranks[career.level]?.requirements ?? [];
  const required = nextRankReqs.map(r => ({ name: r.skill, min: r.min, adv: skillAdv[r.skill] ?? 0 }));
  const ready = required.filter(s => s.adv >= s.min).length;
  // When a character's per-rank requirements aren't modelled, don't hard-block
  // advancement — let them spend the XP rather than be stuck forever.
  const ok = required.length > 0 ? ready === required.length : true;

  // Per-rank picked talents — kept simple: the first N talents in the
  // character template are considered "taken" at the current rank.
  const talents = c.talents.slice(0, 4).map((t, i) => ({
    name: t.name,
    done: i < career.level - 1 || t.times > 1,
  }));

  const tryAdvance = () => {
    if (!ok) return;
    if (!career.canAdvance) {
      Alert.alert('Top of career', `${c.name} is already at the highest rank.`);
      return;
    }
    const nextRank = career.ranks[career.level]; // 0-indexed; career.level is the *current* rank
    const reason = `${nextRank.name} (rank ${career.level + 1})`;
    const r = xp.spend(ADVANCE_COST, reason, 'career');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    career.advance();
    Alert.alert('Advanced!', `You are now a ${nextRank.name} (${nextRank.status}).`);
  };

  const nextRankName = career.ranks[Math.min(career.ranks.length - 1, career.level)]?.name ?? '';

  return (
    <ScreenContainer>
      <Hero
        title="Career"
        subRow={
          <>
            <span className="car-sub">{c.career} · {career.ranks.length}-rank {c.class.toLowerCase()} career</span>
            <span className="car-sep">·</span>
            <span className="car-sub">Currently {career.name} (rank {career.level})</span>
            <span className="car-sep">·</span>
            <span className="car-sub">{xp.current} XP available</span>
          </>
        }
      />

      <Section title="Career path" />

      <div className="car-path">
        {career.ranks.map((rank, i) => {
          const done = rank.level < career.level;
          const current = rank.level === career.level;
          const dotColor = current ? colors.empire : done ? colors.brass : colors.borderStrong;
          const dotBg = current ? colors.empire : done ? colors.brass : colors.surface;
          const lineColor = done || current ? colors.brass : colors.divider;
          const cumulativeXp = i * ADVANCE_COST;
          return (
            <div key={rank.level} className="car-path-cell">
              <div
                className="car-line"
                style={{
                  backgroundColor: lineColor,
                  left: i === 0 ? '50%' : 0,
                  right: i === career.ranks.length - 1 ? '50%' : 0,
                }}
              />
              <div className="car-dot" style={{ borderColor: dotColor, backgroundColor: dotBg }}>
                <span className="car-dot-text" style={{ color: current || done ? '#fff' : colors.ink3 }}>
                  {rank.level}
                </span>
              </div>
              <span className="car-level-name" style={current ? { color: colors.empire } : undefined}>
                {rank.name}
              </span>
              <span className="car-level-meta">{rank.status}</span>
              <span className="car-level-meta">{cumulativeXp} XP earned</span>
            </div>
          );
        })}
      </div>

      <Section
        title={career.canAdvance ? `Advance to rank ${career.level + 1}` : 'Top of career'}
        aside={required.length > 0 ? `${ready}/${required.length} skills ready` : 'requirements not yet modelled'}
      />

      <Card flush>
        <CardHead
          title={`${nextRankName} requirements`}
          right={
            <Pill variant={ok ? 'success' : 'warn'}>
              {ok ? 'Ready to advance' : 'Not yet met'}
            </Pill>
          }
        />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Required skill</Cell>
            <Cell header num flex={1}>Minimum</Cell>
            <Cell header num flex={1}>Current</Cell>
            <Cell header flex={1.2}>Status</Cell>
          </TableRow>
          {required.map((s, i) => {
            const met = s.adv >= s.min;
            return (
              <TableRow key={s.name} last={i === required.length - 1}>
                <Cell flex={2}>{s.name}</Cell>
                <Cell num flex={1} textStyle={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>+{s.min}</Cell>
                <Cell num flex={1} textStyle={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: met ? colors.success : colors.warning }}>+{s.adv}</Cell>
                <Cell flex={1.2}>
                  {met ? (
                    <Pill variant="success" iconLeft={<Icon name="check" size={10} color={colors.success} />}>
                      ready
                    </Pill>
                  ) : (
                    <Pill variant="warn">{s.min - s.adv} more</Pill>
                  )}
                </Cell>
              </TableRow>
            );
          })}
        </Table>
        <div className="car-advance-foot">
          <div className="car-row-between">
            <div>
              <span className="car-label">Advance cost</span>
              <span className="car-cost tabular">{ADVANCE_COST} XP</span>
            </div>
            <Button
              variant="primary"
              disabled={!ok || !career.canAdvance}
              onPress={tryAdvance}
            >
              {career.canAdvance ? `Advance to rank ${career.level + 1}` : 'Maxed'}
            </Button>
          </div>
        </div>
      </Card>

      <Section title="Rank talents (4)" />
      <div className="car-talent-row">
        {talents.map((t) => (
          <button
            key={t.name}
            type="button"
            className="btn-reset car-talent-cell"
            onClick={() =>
              Alert.alert(
                t.name,
                t.done ? 'Already taken at this rank.' : 'Buy this on the Talents screen.'
              )
            }
          >
            <Card tight style={{ flex: 1 }}>
              <div className="car-row-between">
                <span className="car-talent-name">{t.name}</span>
                {t.done ? (
                  <Icon name="check" size={14} color={colors.success} />
                ) : (
                  <Pill variant="brass" size={10}>buyable</Pill>
                )}
              </div>
            </Card>
          </button>
        ))}
      </div>
    </ScreenContainer>
  );
};
